import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  STAGE_ORDER,
  type JobDto,
  type JobStatus,
  type Lane,
  type LogLevel,
  type ProduceEstimate,
  type ProduceRequest,
  type ProductionSummary,
  type QueueState,
  type StageKey,
} from '@hefesto/shared-types';
import { randomUUID } from 'node:crypto';
import { ChannelsRepository } from '../db/repositories';
import { nowIso } from '../db/util';
import { EventsService } from '../events/events.service';
import { ProcessCanceledError, ProcessTimeoutError } from '../media/process';
import type { ProductionEvent } from '../pipeline/production.service';
import { ProviderError } from '../providers';
import { DEFAULT_STAGE_LANE, DEFAULT_STAGE_MS, type SimChain, simulateEta } from './eta';
import { QueueEstimator, type VideoTarget } from './estimator';
import { type JobRow, JobsStore } from './jobs.store';
import { ProductionSummaryReader } from './production-summary';
import type { QueueApi } from './queue.contract';
import {
  DEFAULT_QUEUE_OPTIONS,
  LANE_LIMITS,
  LANE_RESOLVER,
  type JobPayload,
  type LaneResolver,
  QUEUE_OPTIONS,
  type QueueOptions,
  STAGE_RUNNER,
  type StageRunner,
} from './queue.tokens';

const LANES: Lane[] = ['gpu', 'net', 'cpu'];

export const STAGE_LABELS: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Transcripción',
  subtitles: 'Subtítulos',
  visuals: 'Visuales',
  render: 'Render',
  qa: 'QA',
};

const SETTING_PAUSED = 'queue.paused';
const SETTING_CONCURRENCY = 'queue.concurrency';
const SETTING_LOCK = 'queue.lock';
const LOCK_STALE_MS = 60_000;
const CANCEL_WAIT_MS = 10_000;

type AbortIntent = 'cancel' | 'skip' | 'shutdown';

interface ActiveJob {
  job: JobRow;
  controller: AbortController;
  intent?: AbortIntent;
  progress: number;
  startedAt: number;
  lastProgressEvent: number;
  lastProgressWrite: number;
  done: Promise<void>;
}

interface Plan {
  targets: VideoTarget[];
  problems: string[];
}

/**
 * Persistent job queue over the `jobs` table: one job per pipeline stage, lanes gpu/net/cpu
 * with their own concurrency, retries with backoff, pause, cancel, skip and crash recovery.
 *
 * Workers: an in-process scheduler (setImmediate + a wake-up timer for backoffs, no polling)
 * picks the highest-priority, oldest queued job whose lane has a free slot. Only one process
 * runs the queue at a time (a lock with heartbeat in `settings`); another process (e.g. the
 * CLI while the API is up) can still enqueue and `waitFor`, and the lock owner runs the jobs.
 */
@Injectable()
export class QueueService implements QueueApi, OnApplicationBootstrap, OnModuleDestroy {
  private readonly opts: QueueOptions;
  private owner = false;
  private stopped = false;
  private initialized = false;
  private paused = false;
  private concurrency: Record<Lane, number> = { gpu: 1, net: LANE_LIMITS.net.default, cpu: LANE_LIMITS.cpu.default };
  private readonly running = new Map<string, ActiveJob>();
  private tickScheduled = false;
  private wakeTimer?: NodeJS.Timeout;
  private wakeAt = Infinity;
  private queueEventTimer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private readonly waiters = new Map<string, Set<() => void>>();
  private avgCache?: Map<string, number>;
  private laneHint = new Map<StageKey, Lane>();
  private lastSeq = 0;
  private lockWarned = false;

  constructor(
    private readonly store: JobsStore,
    @Inject(STAGE_RUNNER) private readonly runner: StageRunner,
    @Inject(LANE_RESOLVER) private readonly lanes: LaneResolver,
    private readonly events: EventsService,
    private readonly summaries: ProductionSummaryReader,
    private readonly estimator: QueueEstimator,
    private readonly channels: ChannelsRepository,
    @Optional() @Inject(QUEUE_OPTIONS) options?: Partial<QueueOptions>,
  ) {
    this.opts = { ...DEFAULT_QUEUE_OPTIONS, ...options };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  onApplicationBootstrap(): void {
    if (this.opts.autoStart) this.ensureStarted();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const t of [this.wakeTimer, this.queueEventTimer]) if (t) clearTimeout(t);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const w of this.waiters.values()) w.clear();
    if (!this.owner) return;
    // Running jobs go back to the queue; the next start resumes them (stages are idempotent).
    for (const a of this.running.values()) {
      a.intent = 'shutdown';
      a.controller.abort(new Error('La aplicación se está cerrando'));
      this.store.update(a.job.id, { status: 'queued', attempts: Math.max(0, a.job.attempts - 1), progress: 0, startedAt: null });
    }
    this.running.clear();
    this.releaseLock();
    this.owner = false;
  }

  /** True when this process runs the jobs (holds the queue lock). */
  isOwner(): boolean {
    this.ensureStarted();
    return this.owner;
  }

  /**
   * Loads settings, takes the lock and recovers jobs left `running` by a crash. Called on
   * bootstrap (API) or lazily by the first queue call (CLI). Never throws: if another live
   * process holds the lock, this one only enqueues and reads until it can take over.
   */
  private ensureStarted(): void {
    if (this.stopped) return;
    if (!this.initialized) {
      this.initialized = true;
      this.paused = this.store.getSetting<boolean>(SETTING_PAUSED) ?? false;
      const saved = this.store.getSetting<Partial<Record<Lane, number>>>(SETTING_CONCURRENCY) ?? {};
      for (const lane of LANES) {
        const limits = LANE_LIMITS[lane];
        const v = saved[lane];
        this.concurrency[lane] = typeof v === 'number' ? clamp(Math.round(v), limits.min, limits.max) : limits.default;
      }
      this.laneHint = this.store.lastLanes();
      this.heartbeat = setInterval(() => this.beat(), this.opts.lockHeartbeatMs);
      this.heartbeat.unref();
    }
    if (!this.owner) this.tryTakeOver();
  }

  private tryTakeOver(): void {
    const lock = this.store.getSetting<{ pid: number; beatAt: number }>(SETTING_LOCK);
    if (lock && lock.pid !== process.pid && Date.now() - lock.beatAt < LOCK_STALE_MS && isAlive(lock.pid)) {
      if (!this.lockWarned) {
        this.lockWarned = true;
        this.log('warn', `La cola la está procesando otro proceso (pid ${lock.pid}); este solo encola y espera.`);
      }
      return;
    }
    this.store.setSetting(SETTING_LOCK, { pid: process.pid, beatAt: Date.now() });
    this.owner = true;
    const recovered = this.store.requeueRunning();
    if (recovered > 0) this.log('warn', `Se retomaron ${recovered} trabajos que quedaron a medias (cierre inesperado)`);
    this.kick();
    this.scheduleQueueEvent();
  }

  private beat(): void {
    if (this.stopped) return;
    try {
      if (this.owner) {
        this.store.setSetting(SETTING_LOCK, { pid: process.pid, beatAt: Date.now() });
        // Picks up jobs enqueued by another process (e.g. the CLI while the API runs).
        this.kick();
      } else {
        this.tryTakeOver();
      }
    } catch {
      // DB closing: nothing to do.
    }
  }

  private releaseLock(): void {
    try {
      const lock = this.store.getSetting<{ pid: number }>(SETTING_LOCK);
      if (lock?.pid === process.pid) this.store.deleteSetting(SETTING_LOCK);
    } catch {
      // DB already closed.
    }
  }

  // ── QueueApi ────────────────────────────────────────────────────────────

  state(): QueueState {
    this.ensureStarted();
    const running = this.store.running();
    const queued = this.store.queued();
    const recent = this.store.recent(20);
    const toDto = this.dtoMapper([...running, ...queued, ...recent]);
    const lanes = Object.fromEntries(
      LANES.map((lane) => [
        lane,
        { concurrency: this.concurrency[lane], running: running.filter((j) => j.lane === lane).map(toDto) },
      ]),
    ) as QueueState['lanes'];
    return {
      paused: this.paused,
      lanes,
      queued: queued.map(toDto),
      recent: recent.map(toDto),
      etaMs: simulateEta(this.activeChains(running, queued), this.concurrency),
    };
  }

  async estimate(req: ProduceRequest): Promise<ProduceEstimate> {
    this.ensureStarted();
    const plan = await this.plan(req);
    const blockers = [...plan.problems, ...this.estimator.blockers(plan.targets)];
    const targets = plan.targets;
    const priority = req.priority ?? 0;

    const laneCache = new Map<string, Lane>();
    const laneOf = async (stage: StageKey, t: VideoTarget): Promise<Lane> => {
      const key = `${stage}:${t.channelId}:${t.scriptId ? 's' : ''}`;
      if (!laneCache.has(key)) laneCache.set(key, await this.lanes.laneFor(stage, { channelId: t.channelId, scriptId: t.scriptId }));
      return laneCache.get(key) as Lane;
    };

    const newChains: SimChain[] = [];
    let costUsd = 0;
    for (const [i, t] of targets.entries()) {
      const steps = [];
      for (const stage of STAGE_ORDER) {
        const lane = await laneOf(stage, t);
        steps.push({ lane, ms: this.expectedMs(stage, lane) });
        costUsd += this.estimator.stageCost(stage, t);
      }
      newChains.push({ steps, priority, seq: Number.MAX_SAFE_INTEGER - targets.length + i });
    }

    const byStage: ProduceEstimate['byStage'] = [];
    const first = targets[0];
    for (const stage of STAGE_ORDER) {
      const lane = first ? await laneOf(stage, first) : DEFAULT_STAGE_LANE[stage];
      const cost = targets.length
        ? targets.reduce((sum, t) => sum + this.estimator.stageCost(stage, t), 0) / targets.length
        : 0;
      byStage.push({ stage, lane, avgMs: Math.round(this.expectedMs(stage, lane)), costUsd: round6(cost) });
    }

    const existing = this.activeChains(this.store.running(), this.store.queued());
    return {
      videos: targets.length,
      jobs: targets.length * STAGE_ORDER.length,
      etaMs: targets.length ? simulateEta([...existing, ...newChains], this.concurrency) : 0,
      costUsd: round6(costUsd),
      byStage,
      blockers,
    };
  }

  async enqueue(req: ProduceRequest): Promise<ProductionSummary[]> {
    this.ensureStarted();
    const plan = await this.plan(req);
    if (plan.problems.length) throw new BadRequestException(plan.problems.join(' · '));
    const blockers = this.estimator.blockers(plan.targets);
    if (blockers.length) throw new BadRequestException(blockers.join(' · '));

    const priority = req.priority ?? 0;
    const ids: string[] = [];
    for (const t of plan.targets) {
      const productionId = randomUUID();
      if (t.scriptId) await this.runner.createFromScript(t.scriptId, productionId);
      const payload: JobPayload = {
        productionId,
        channelId: t.channelId,
        topic: req.topic,
        scriptId: t.scriptId,
        seq: this.nextSeq(),
      };
      await this.enqueueStage('script', payload, priority);
      ids.push(productionId);
      this.log('info', `En cola: ${t.channelName}${req.topic ? ` · ${req.topic}` : ''}`, { productionId });
    }
    const out = ids.map((id) => this.summaryFor(id) as ProductionSummary);
    for (const s of out) this.events.emit({ type: 'production', production: s });
    return out;
  }

  pause(): QueueState {
    this.ensureStarted();
    if (!this.paused) {
      this.paused = true;
      this.store.setSetting(SETTING_PAUSED, true);
      this.log('info', 'Cola en pausa: los trabajos en curso terminan, no se toman nuevos');
    }
    return this.stateChanged();
  }

  resume(): QueueState {
    this.ensureStarted();
    if (this.paused) {
      this.paused = false;
      this.store.setSetting(SETTING_PAUSED, false);
      this.log('info', 'Cola reanudada');
      this.kick();
    }
    return this.stateChanged();
  }

  skip(jobId: string): Promise<JobDto> {
    return this.stop(jobId, 'skip');
  }

  cancel(jobId: string): Promise<JobDto> {
    return this.stop(jobId, 'cancel');
  }

  async retry(jobId: string): Promise<JobDto> {
    this.ensureStarted();
    const job = this.requireJob(jobId);
    if (!['failed', 'canceled', 'skipped'].includes(job.status)) {
      throw new ConflictException('Solo se reintentan trabajos fallidos, cancelados o saltados');
    }
    const pid = job.payload.productionId;
    if (this.store.activeForProduction(pid).length) {
      throw new ConflictException('La producción ya tiene un trabajo en la cola');
    }
    const lane = await this.lanes.laneFor(job.type, { channelId: job.payload.channelId, scriptId: job.payload.scriptId });
    const payload = basePayload(job.payload);
    const row = this.store.update(jobId, {
      status: 'queued',
      lane,
      attempts: 0,
      error: null,
      progress: 0,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      payload: payload as unknown as Record<string, unknown>,
    }) as JobRow;
    await this.runner.setStatus(pid, 'pending');
    this.log('info', `${STAGE_LABELS[job.type]}: reintento manual`, { productionId: pid, jobId });
    this.jobChanged(row);
    this.productionChanged(pid);
    this.kick();
    return this.toDto(row);
  }

  setPriority(jobId: string, priority: number): JobDto {
    this.ensureStarted();
    if (!Number.isFinite(priority)) throw new BadRequestException('La prioridad debe ser un número');
    this.requireJob(jobId);
    const row = this.store.update(jobId, { priority: Math.round(priority) }) as JobRow;
    this.jobChanged(row);
    this.kick();
    return this.toDto(row);
  }

  setLaneConcurrency(lane: Lane, concurrency: number): QueueState {
    this.ensureStarted();
    const limits = LANE_LIMITS[lane];
    if (!limits) throw new BadRequestException(`Carril desconocido: ${lane}`);
    if (!Number.isInteger(concurrency) || concurrency < limits.min || concurrency > limits.max) {
      throw new BadRequestException(
        lane === 'gpu'
          ? 'El carril GPU siempre corre de a una tarea (regla 2: una sola tarea de GPU a la vez)'
          : `La concurrencia de ${lane} va de ${limits.min} a ${limits.max}`,
      );
    }
    this.concurrency[lane] = concurrency;
    this.store.setSetting(SETTING_CONCURRENCY, { net: this.concurrency.net, cpu: this.concurrency.cpu });
    this.kick();
    return this.stateChanged();
  }

  async retryProduction(productionId: string, fromStage?: StageKey): Promise<ProductionSummary> {
    this.ensureStarted();
    if (fromStage && !STAGE_ORDER.includes(fromStage)) throw new BadRequestException(`Etapa desconocida: ${fromStage}`);
    if (this.store.activeForProduction(productionId).length) {
      throw new ConflictException('La producción ya tiene un trabajo en la cola');
    }
    const row = this.summaries.get(productionId);
    const last = this.store.latestForProduction(productionId);
    if (!row && !last) throw new NotFoundException(`No existe la producción ${productionId}`);
    if (!row && fromStage && fromStage !== 'script') {
      throw new BadRequestException('La producción todavía no tiene guion: se reintenta desde el guion');
    }

    let from: StageKey;
    if (!row) from = 'script';
    else if (fromStage) from = fromStage;
    else if (last && ['failed', 'canceled', 'skipped'].includes(last.status)) from = last.type;
    else from = (await this.firstPendingStage(productionId)) ?? 'qa';

    if (row && fromStage) await this.runner.resetFrom(productionId, fromStage);
    const channelId = row?.channelId ?? (last as JobRow).payload.channelId;
    const payload: JobPayload = {
      productionId,
      channelId,
      topic: last?.payload.topic,
      scriptId: last?.payload.scriptId,
      seq: last?.payload.seq ?? this.nextSeq(),
    };
    await this.runner.setStatus(productionId, 'pending');
    await this.enqueueStage(from, payload, last?.priority ?? 0);
    this.log('info', `Reintento desde ${STAGE_LABELS[from]}`, { productionId });
    this.productionChanged(productionId);
    return this.summaryFor(productionId) as ProductionSummary;
  }

  waitFor(productionId: string): Promise<ProductionSummary> {
    this.ensureStarted();
    return new Promise((resolve, reject) => {
      const check = () => {
        let done: ProductionSummary | null;
        try {
          done = this.terminalSummary(productionId);
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        if (done) {
          cleanup();
          resolve(done);
        }
      };
      const cleanup = () => {
        clearInterval(poll);
        this.waiters.get(productionId)?.delete(check);
      };
      const set = this.waiters.get(productionId) ?? new Set();
      set.add(check);
      this.waiters.set(productionId, set);
      const poll = setInterval(check, this.opts.waitPollMs);
      check();
    });
  }

  // ── Extras for the REST layer ───────────────────────────────────────────

  /** Summary of a production, including one whose script stage hasn't created the row yet. */
  summaryFor(productionId: string): ProductionSummary | null {
    const row = this.summaries.get(productionId);
    if (row) return row;
    const job = this.store.latestForProduction(productionId);
    if (!job) return null;
    const channelName = this.summaries.channelNames().get(job.payload.channelId) ?? '';
    return {
      id: productionId,
      channelId: job.payload.channelId,
      channelName,
      title: job.payload.topic ? `Nuevo guion · ${job.payload.topic}` : 'Nuevo guion',
      currentStep: job.type,
      status: productionStatusFromJob(job.status),
      progress: 0,
      costUsd: 0,
      createdAt: job.createdAt,
      updatedAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
      error: job.error ?? undefined,
    };
  }

  /** Cancels the production's active job and deletes its jobs (call before deleting the production). */
  async forgetProduction(productionId: string): Promise<void> {
    for (const job of this.store.activeForProduction(productionId)) await this.stop(job.id, 'skip');
    this.store.deleteForProduction(productionId);
    this.scheduleQueueEvent();
  }

  // ── Scheduler ───────────────────────────────────────────────────────────

  private kick(): void {
    if (!this.owner || this.stopped || this.tickScheduled) return;
    this.tickScheduled = true;
    setImmediate(() => {
      this.tickScheduled = false;
      try {
        this.tick();
      } catch (err) {
        if (!this.stopped) this.log('error', `Error del planificador: ${errorMessage(err)}`);
      }
    });
  }

  private tick(): void {
    if (this.paused || this.stopped || !this.owner) return;
    const now = Date.now();
    const busy: Record<Lane, number> = { gpu: 0, net: 0, cpu: 0 };
    const busyProductions = new Set<string>();
    for (const a of this.running.values()) {
      busy[a.job.lane]++;
      busyProductions.add(a.job.payload.productionId);
    }

    let wakeAt = Infinity;
    for (const job of this.store.queued()) {
      const lane = job.lane;
      const limit = lane === 'gpu' ? 1 : this.concurrency[lane];
      if (busy[lane] >= limit) continue;
      if (job.payload.notBefore && job.payload.notBefore > now) {
        wakeAt = Math.min(wakeAt, job.payload.notBefore);
        continue;
      }
      if (busyProductions.has(job.payload.productionId)) continue;
      busy[lane]++;
      busyProductions.add(job.payload.productionId);
      this.start(job);
    }
    this.scheduleWake(wakeAt);
  }

  private scheduleWake(at: number): void {
    if (at === Infinity || at >= this.wakeAt) return;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeAt = at;
    this.wakeTimer = setTimeout(
      () => {
        this.wakeTimer = undefined;
        this.wakeAt = Infinity;
        this.kick();
      },
      Math.max(0, at - Date.now()),
    );
  }

  private start(queued: JobRow): void {
    const job = this.store.update(queued.id, {
      status: 'running',
      attempts: queued.attempts + 1,
      startedAt: nowIso(),
      finishedAt: null,
      durationMs: null,
      progress: 0,
      error: null,
    }) as JobRow;
    let finish!: () => void;
    const active: ActiveJob = {
      job,
      controller: new AbortController(),
      progress: 0,
      startedAt: Date.now(),
      lastProgressEvent: 0,
      lastProgressWrite: 0,
      done: new Promise<void>((r) => (finish = r)),
    };
    this.running.set(job.id, active);
    void this.execute(active).finally(() => {
      this.running.delete(job.id);
      finish();
      if (!this.stopped) {
        this.kick();
        this.scheduleQueueEvent();
      }
    });
  }

  private async execute(active: ActiveJob): Promise<void> {
    const { job } = active;
    const pid = job.payload.productionId;
    const label = STAGE_LABELS[job.type];
    const ctx = { productionId: pid, jobId: job.id };
    const attemptNote = job.attempts > 1 ? ` (intento ${job.attempts}/${job.maxAttempts})` : '';
    this.log('debug', `${label}: empieza${attemptNote}`, ctx);
    this.jobChanged(job);
    this.productionChanged(pid);

    try {
      const result = await this.runner.runStage(
        { productionId: pid, channelId: job.payload.channelId, topic: job.payload.topic, scriptId: job.payload.scriptId },
        job.type,
        {
          signal: active.controller.signal,
          onProgress: (v) => this.onProgress(active, v),
          onEvent: (e) => this.onPipelineEvent(active, e),
        },
      );
      if (this.stopped) return;
      if (job.type === 'script') this.store.attachProduction(pid);
      if (active.intent) return await this.finishAborted(active);

      const durationMs = Date.now() - active.startedAt;
      const row = this.store.update(job.id, {
        status: 'done',
        progress: 1,
        finishedAt: nowIso(),
        durationMs,
        payload: { ...job.payload, notBefore: undefined, cached: result.skipped } as unknown as Record<string, unknown>,
      }) as JobRow;
      this.avgCache = undefined;
      this.jobChanged(row);
      this.log(
        'info',
        result.skipped ? `· ${label}: sin cambios, se salta` : `✓ ${label} (${(durationMs / 1000).toFixed(1)} s)`,
        ctx,
      );

      const next = STAGE_ORDER[STAGE_ORDER.indexOf(job.type) + 1];
      if (next) {
        await this.enqueueStage(next, basePayload(job.payload), row.priority);
        this.productionChanged(pid);
      } else {
        const summary = this.summaryFor(pid);
        this.log('info', `✔ Listo: ${summary?.title ?? pid}${result.qaPassed === false ? ' (QA con fallas)' : ''}`, ctx);
        this.productionChanged(pid);
        this.notify(pid);
      }
    } catch (err) {
      if (this.stopped) return;
      if (job.type === 'script' && this.summaries.get(pid)) this.store.attachProduction(pid);
      if (active.intent) return await this.finishAborted(active);

      const message = errorMessage(err);
      const current = this.store.get(job.id) ?? job;
      if (isRetryable(err) && current.attempts < current.maxAttempts) {
        const delay = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 4 ** (current.attempts - 1));
        const row = this.store.update(job.id, {
          status: 'queued',
          error: message,
          progress: 0,
          payload: { ...job.payload, notBefore: Date.now() + delay } as unknown as Record<string, unknown>,
        }) as JobRow;
        await this.runner.setStatus(pid, 'running', `Reintentando ${label}: ${message}`);
        this.log(
          'warn',
          `${label}: falló, reintento ${current.attempts + 1}/${current.maxAttempts} en ${Math.round(delay / 1000)} s: ${message}`,
          ctx,
        );
        this.jobChanged(row);
        this.productionChanged(pid);
        return;
      }

      const row = this.store.update(job.id, {
        status: 'failed',
        error: message,
        finishedAt: nowIso(),
        durationMs: Date.now() - active.startedAt,
      }) as JobRow;
      await this.runner.setStatus(pid, 'failed', `${label}: ${message}`);
      this.log('error', `✖ ${label}: ${message}`, ctx);
      this.jobChanged(row);
      this.productionChanged(pid);
      this.notify(pid);
    }
  }

  private async finishAborted(active: ActiveJob): Promise<void> {
    const { job } = active;
    const pid = job.payload.productionId;
    const label = STAGE_LABELS[job.type];
    const skip = active.intent === 'skip';
    const row = this.store.update(job.id, {
      status: skip ? 'skipped' : 'canceled',
      error: skip ? 'Saltado por el usuario' : 'Cancelado por el usuario',
      finishedAt: nowIso(),
      durationMs: Date.now() - active.startedAt,
    }) as JobRow;
    await this.runner.setStatus(pid, 'canceled', skip ? 'Saltada por el usuario' : 'Cancelada por el usuario');
    this.log('warn', skip ? `${label}: saltado, la producción se descarta` : `${label}: cancelado`, {
      productionId: pid,
      jobId: job.id,
    });
    this.jobChanged(row);
    this.productionChanged(pid);
    this.notify(pid);
  }

  /** Cancel/skip: aborts a running job (killing its subprocess) or drops a queued one. */
  private async stop(jobId: string, intent: 'cancel' | 'skip'): Promise<JobDto> {
    this.ensureStarted();
    const job = this.requireJob(jobId);
    const active = this.running.get(jobId);
    if (active) {
      active.intent = intent;
      active.controller.abort(new Error(intent === 'skip' ? 'Saltado por el usuario' : 'Cancelado por el usuario'));
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([active.done, new Promise<void>((r) => (timer = setTimeout(r, CANCEL_WAIT_MS)))]);
      if (timer) clearTimeout(timer);
      if (this.running.has(jobId)) await this.finishAborted(active);
      return this.toDto(this.requireJob(jobId));
    }
    if (job.status === 'queued' || job.status === 'running') {
      // Queued here, or `running` in another process that owns the queue.
      await this.finishAborted({
        job,
        intent,
        controller: new AbortController(),
        progress: 0,
        startedAt: Date.now(),
        lastProgressEvent: 0,
        lastProgressWrite: 0,
        done: Promise.resolve(),
      });
      return this.toDto(this.requireJob(jobId));
    }
    throw new ConflictException(`El trabajo ya terminó (${job.status})`);
  }

  private async enqueueStage(stage: StageKey, payload: JobPayload, priority: number): Promise<JobRow> {
    const lane = await this.lanes.laneFor(stage, { channelId: payload.channelId, scriptId: payload.scriptId });
    const exists = stage !== 'script' || Boolean(this.summaries.get(payload.productionId));
    const row = this.store.insert({
      productionId: exists ? payload.productionId : null,
      channelId: payload.channelId,
      type: stage,
      lane,
      priority,
      payload,
    });
    this.laneHint.set(stage, lane);
    this.jobChanged(row);
    this.kick();
    return row;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  private onProgress(active: ActiveJob, value: number): void {
    if (this.stopped || active.intent) return;
    const v = clamp(value, 0, 1);
    active.progress = v;
    const now = Date.now();
    if (now - active.lastProgressEvent >= this.opts.progressThrottleMs || v >= 1) {
      active.lastProgressEvent = now;
      this.events.emit({
        type: 'progress',
        jobId: active.job.id,
        productionId: active.job.payload.productionId,
        stage: active.job.type,
        value: v,
      });
    }
    if (now - active.lastProgressWrite >= 1000 || v >= 1) {
      active.lastProgressWrite = now;
      this.store.update(active.job.id, { progress: v });
    }
  }

  private onPipelineEvent(active: ActiveJob, e: ProductionEvent): void {
    if (this.stopped || e.type !== 'info') return;
    this.events.log('info', 'pipeline', e.message, { productionId: e.productionId, jobId: active.job.id });
  }

  private log(level: LogLevel, message: string, ctx: { productionId?: string; jobId?: string } = {}): void {
    this.events.log(level, 'queue', message, ctx);
  }

  private jobChanged(row: JobRow): void {
    this.events.emit({ type: 'job', job: this.toDto(row) });
    this.scheduleQueueEvent();
  }

  private productionChanged(productionId: string): void {
    const summary = this.summaryFor(productionId);
    if (summary) this.events.emit({ type: 'production', production: summary });
  }

  private stateChanged(): QueueState {
    const state = this.state();
    this.events.emit({ type: 'queue', state });
    return state;
  }

  private scheduleQueueEvent(): void {
    if (this.queueEventTimer || this.stopped) return;
    this.queueEventTimer = setTimeout(() => {
      this.queueEventTimer = undefined;
      if (this.stopped) return;
      try {
        this.events.emit({ type: 'queue', state: this.state() });
      } catch {
        // DB closing.
      }
    }, this.opts.queueEventThrottleMs);
    this.queueEventTimer.unref();
  }

  private notify(productionId: string): void {
    for (const check of [...(this.waiters.get(productionId) ?? [])]) check();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async plan(req: ProduceRequest): Promise<Plan> {
    const problems: string[] = [];
    const targets: VideoTarget[] = [];
    const channelOf = (idOrSlug: string) => this.channels.findById(idOrSlug) ?? this.channels.findBySlug(idOrSlug);

    if (req.scriptIds?.length) {
      for (const scriptId of req.scriptIds) {
        const script = await this.runner.loadScript(scriptId);
        if (!script) {
          problems.push(`No existe el guion ${scriptId}`);
          continue;
        }
        if (script.status !== 'approved') problems.push(`El guion "${script.title}" no está aprobado`);
        const channel = this.channels.findById(script.channelId);
        if (!channel) problems.push(`No existe el canal del guion "${script.title}"`);
        else if (!channel.active) problems.push(`El canal "${channel.name}" está inactivo`);
        targets.push({ channelId: script.channelId, channelName: channel?.name ?? '', scriptId });
      }
      return { targets, problems };
    }

    const count = Math.floor(req.count ?? 0);
    if (count < 1 || count > 50) problems.push('La cantidad de videos por canal va de 1 a 50');
    if (!req.channelIds?.length) problems.push('Elegí al menos un canal');
    for (const idOrSlug of req.channelIds ?? []) {
      const channel = channelOf(idOrSlug);
      if (!channel) {
        problems.push(`No existe el canal ${idOrSlug}`);
        continue;
      }
      if (!channel.active) problems.push(`El canal "${channel.name}" está inactivo`);
      for (let i = 0; i < Math.max(0, Math.min(count, 50)); i++) {
        targets.push({ channelId: channel.id, channelName: channel.name });
      }
    }
    return { targets, problems };
  }

  private async firstPendingStage(productionId: string): Promise<StageKey | undefined> {
    const record = await this.runner.getProduction(productionId);
    if (!record) return undefined;
    return STAGE_ORDER.find((s) => !record.inputHashes[s]);
  }

  /** A production is finished when nothing is queued/running for it and it reached an end state. */
  private terminalSummary(productionId: string): ProductionSummary | null {
    if (this.store.activeForProduction(productionId).length) return null;
    const summary = this.summaryFor(productionId);
    if (!summary) throw new NotFoundException(`No existe la producción ${productionId}`);
    if (['done', 'failed', 'canceled'].includes(summary.status)) return summary;
    const last = this.store.latestForProduction(productionId);
    if (last && ['failed', 'canceled', 'skipped'].includes(last.status)) {
      return { ...summary, status: last.status === 'failed' ? 'failed' : 'canceled', error: summary.error ?? last.error ?? undefined };
    }
    return null;
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(this.lastSeq + 1, Date.now());
    return this.lastSeq;
  }

  private requireJob(jobId: string): JobRow {
    const job = this.store.get(jobId);
    if (!job) throw new NotFoundException(`No existe el trabajo ${jobId}`);
    return job;
  }

  private expectedMs(stage: StageKey, lane: Lane): number {
    this.avgCache ??= this.store.averageDurations(20);
    return this.avgCache.get(`${stage}:${lane}`) ?? DEFAULT_STAGE_MS[stage];
  }

  /** Remaining work of every active production, for the ETA simulation. */
  private activeChains(running: JobRow[], queued: JobRow[]): SimChain[] {
    const chains: SimChain[] = [];
    const now = Date.now();
    for (const job of [...running, ...queued]) {
      const idx = STAGE_ORDER.indexOf(job.type);
      const expected = this.expectedMs(job.type, job.lane);
      const steps = [{ lane: job.lane, ms: expected }];
      for (const stage of STAGE_ORDER.slice(idx + 1)) {
        const lane = this.laneHint.get(stage) ?? DEFAULT_STAGE_LANE[stage];
        steps.push({ lane, ms: this.expectedMs(stage, lane) });
      }
      let runningRemainingMs: number | undefined;
      if (job.status === 'running') {
        const active = this.running.get(job.id);
        const elapsed = job.startedAt ? now - Date.parse(job.startedAt) : 0;
        const p = active?.progress ?? job.progress;
        runningRemainingMs = p > 0.05 ? (elapsed * (1 - p)) / p : Math.max(0, expected - elapsed);
      } else if (job.payload.notBefore && job.payload.notBefore > now) {
        steps[0] = { lane: job.lane, ms: expected + (job.payload.notBefore - now) };
      }
      chains.push({ steps, priority: job.priority, seq: job.payload.seq ?? 0, runningRemainingMs });
    }
    return chains;
  }

  private dtoMapper(rows: JobRow[]): (row: JobRow) => JobDto {
    const productionIds = rows.map((r) => r.payload.productionId);
    const productions = this.summaries.many(productionIds);
    const channelNames = this.summaries.channelNames();
    return (row) => this.toDto(row, productions.get(row.payload.productionId), channelNames);
  }

  private toDto(row: JobRow, production?: ProductionSummary | null, channelNames?: Map<string, string>): JobDto {
    const summary = production === undefined ? this.summaries.get(row.payload.productionId) : production;
    const active = this.running.get(row.id);
    const channelId = row.channelId ?? row.payload.channelId;
    return {
      id: row.id,
      productionId: row.payload.productionId,
      channelId,
      channelName: summary?.channelName ?? (channelNames ?? this.summaries.channelNames()).get(channelId),
      title: summary?.title ?? (row.payload.topic ? `Nuevo guion · ${row.payload.topic}` : 'Nuevo guion'),
      type: row.type,
      lane: row.lane,
      status: row.status as JobStatus,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      progress: active?.progress ?? row.progress,
      error: row.error ?? undefined,
      queuedAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      finishedAt: row.finishedAt ?? undefined,
      durationMs: row.durationMs ?? undefined,
      expectedMs: Math.round(this.expectedMs(row.type, row.lane)),
    };
  }
}

/** The payload a new job of the same production inherits (no retry state). */
function basePayload(p: JobPayload): JobPayload {
  return { productionId: p.productionId, channelId: p.channelId, topic: p.topic, scriptId: p.scriptId, seq: p.seq };
}

function productionStatusFromJob(status: string): ProductionSummary['status'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'queued':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'done':
      return 'running';
    default:
      return 'canceled';
  }
}

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'SQLITE_BUSY', 'UND_ERR_SOCKET']);

/** Transient failures worth another attempt: provider 429/5xx/timeouts, network drops, subprocess timeouts. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  if (err instanceof ProcessCanceledError) return false;
  if (err instanceof ProcessTimeoutError) return true;
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | undefined;
  const code = e?.code ?? e?.cause?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  return err instanceof TypeError && /fetch failed/i.test(e?.message ?? '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
