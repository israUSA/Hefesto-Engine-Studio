import type Database from 'better-sqlite3';
import { STAGE_ORDER, type Lane, type LogEntry, type ProviderConfig, type ServerEvent, type StageKey } from '@hefesto/shared-types';
import { eq } from 'drizzle-orm';
import { Subject } from 'rxjs';
import { ChannelsRepository } from '../db/repositories';
import { productions, scripts } from '../db/schema';
import { createTestDb } from '../db/test-utils';
import type { DbInstance } from '../db/db.token';
import type { EventsService } from '../events/events.service';
import type { ProductionRef, RunStageOptions, StageResult } from '../pipeline/production.service';
import type { ProductionRecord } from '../pipeline/ports';
import { InMemoryBindingSource, ProviderError, ProviderRegistry } from '../providers';
import { fakeProviderFactory } from '../providers/adapters/fake';
import { QueueEstimator } from './estimator';
import { JobsStore } from './jobs.store';
import { ProductionSummaryReader } from './production-summary';
import { QueueService } from './queue.service';
import type { LaneResolver, QueueOptions, StageRunner } from './queue.tokens';

const TEST_OPTIONS: Partial<QueueOptions> = {
  autoStart: false,
  backoffBaseMs: 5,
  backoffMaxMs: 20,
  queueEventThrottleMs: 5,
  progressThrottleMs: 0,
  lockHeartbeatMs: 60_000,
  waitPollMs: 20,
};

const ALL_CPU: Record<StageKey, Lane> = {
  script: 'cpu',
  voice: 'cpu',
  transcribe: 'cpu',
  subtitles: 'cpu',
  visuals: 'cpu',
  render: 'cpu',
  qa: 'cpu',
};

const tick = () => new Promise<void>((r) => setImmediate(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const untilAborted = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));

class FakeEvents {
  readonly events$ = new Subject<ServerEvent>();
  readonly emitted: ServerEvent[] = [];
  readonly logs: LogEntry[] = [];

  emit(e: ServerEvent): void {
    this.emitted.push(e);
    this.events$.next(e);
  }

  log(level: LogEntry['level'], source: string, message: string, ctx: { productionId?: string; jobId?: string } = {}) {
    const entry: LogEntry = { id: this.logs.length + 1, at: new Date().toISOString(), level, source, message, ...ctx };
    this.logs.push(entry);
    this.emit({ type: 'log', entry });
    return entry;
  }
}

type Handler = (ref: ProductionRef, opts: RunStageOptions, call: number) => Promise<Partial<StageResult> | void>;

/** Stage runner backed by the test DB: the script stage creates the production row, like the real one. */
class FakeRunner implements StageRunner {
  readonly calls: { productionId: string; stage: StageKey }[] = [];
  readonly handlers: Partial<Record<StageKey, Handler>> = {};
  readonly running: Record<Lane, number> = { gpu: 0, net: 0, cpu: 0 };
  readonly maxRunning: Record<Lane, number> = { gpu: 0, net: 0, cpu: 0 };
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly db: DbInstance,
    private readonly lanes: Record<StageKey, Lane>,
  ) {}

  async runStage(ref: ProductionRef, stage: StageKey, opts: RunStageOptions): Promise<StageResult> {
    const key = `${ref.productionId}:${stage}`;
    const call = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, call);
    this.calls.push({ productionId: ref.productionId, stage });
    const lane = this.lanes[stage];
    this.running[lane]++;
    this.maxRunning[lane] = Math.max(this.maxRunning[lane], this.running[lane]);
    try {
      if (stage === 'script' && !this.row(ref.productionId)) this.createRow(ref);
      const extra = (await this.handlers[stage]?.(ref, opts, call)) ?? (await tick());
      const row = this.row(ref.productionId);
      if (row) {
        this.db
          .update(productions)
          .set({
            inputHashes: { ...row.inputHashes, [stage]: `h-${stage}` },
            status: stage === 'qa' ? 'done' : 'running',
            currentStep: stage,
          })
          .where(eq(productions.id, ref.productionId))
          .run();
      }
      return { productionId: ref.productionId, stage, skipped: false, durationMs: 1, costUsd: 0, ...(extra ?? {}) };
    } finally {
      this.running[lane]--;
    }
  }

  async createFromScript(scriptId: string, productionId = 'p'): Promise<{ productionId: string; channelId: string }> {
    const script = this.db.select().from(scripts).where(eq(scripts.id, scriptId)).get();
    if (!script) throw new Error('no script');
    this.db.insert(productions).values({ id: productionId, scriptId, channelId: script.channelId }).run();
    return { productionId, channelId: script.channelId };
  }

  async loadScript(scriptId: string) {
    const s = this.db.select().from(scripts).where(eq(scripts.id, scriptId)).get();
    if (!s) return null;
    return { ...s, title: s.title ?? s.hook, scenes: [], metadata: s.metadata };
  }

  async getProduction(id: string): Promise<ProductionRecord | null> {
    const row = this.row(id);
    return row ? { id, channelId: row.channelId, status: row.status, inputHashes: row.inputHashes } : null;
  }

  async setStatus(id: string, status: ProductionRecord['status'], error?: string): Promise<void> {
    this.db.update(productions).set({ status, error: error ?? null }).where(eq(productions.id, id)).run();
  }

  async resetFrom(id: string, from: StageKey): Promise<void> {
    const row = this.row(id);
    if (!row) return;
    const hashes = { ...row.inputHashes };
    for (const s of STAGE_ORDER.slice(STAGE_ORDER.indexOf(from))) delete hashes[s];
    this.db.update(productions).set({ inputHashes: hashes }).where(eq(productions.id, id)).run();
  }

  row(id: string) {
    return this.db.select().from(productions).where(eq(productions.id, id)).get();
  }

  stagesOf(productionId: string): StageKey[] {
    return this.calls.filter((c) => c.productionId === productionId).map((c) => c.stage);
  }

  private createRow(ref: ProductionRef): void {
    const scriptId = `s-${ref.productionId}`;
    this.db
      .insert(scripts)
      .values({ id: scriptId, channelId: ref.channelId as string, title: `Video ${ref.topic ?? ''}`.trim(), hook: 'h', body: 'b', cta: 'c', fullText: 'h b c' })
      .run();
    this.db.insert(productions).values({ id: ref.productionId, scriptId, channelId: ref.channelId as string, status: 'running' }).run();
  }
}

const FAKE_CONFIG: ProviderConfig = {
  id: 'fake',
  name: 'fake',
  adapter: 'fake',
  capabilities: ['text', 'tts', 'transcribe', 'stock'],
  params: {},
  enabled: true,
};

function fakeBindings(): InMemoryBindingSource {
  const source = new InMemoryBindingSource().addConfig(FAKE_CONFIG);
  for (const [capability, role] of [['text', 'script'], ['tts'], ['transcribe'], ['stock']] as const) {
    source.addBinding({ id: capability, channelId: null, capability, role, providerConfigId: 'fake', params: {}, fallbackIds: [] });
  }
  return source;
}

function makeRegistry(source: InMemoryBindingSource, env: NodeJS.ProcessEnv = {}): ProviderRegistry {
  const registry = new ProviderRegistry(source, env);
  registry.register(fakeProviderFactory);
  return registry;
}

interface Harness {
  db: DbInstance;
  sqlite: Database.Database;
  svc: QueueService;
  runner: FakeRunner;
  events: FakeEvents;
  store: JobsStore;
  channelId: string;
  make(): QueueService;
}

function setup(lanes: Record<StageKey, Lane> = ALL_CPU, options: Partial<QueueOptions> = {}): Harness {
  const { db, sqlite } = createTestDb();
  const channels = new ChannelsRepository(db);
  const channel = channels.create({
    name: 'Fe Diaria',
    slug: 'fe-diaria',
    platform: 'tiktok',
    handle: '@fe',
    language: 'es',
    format: '9:16',
    topic: 'fe',
    bible: 'b',
    durationTarget: { min: 20, max: 40 },
    aiLabel: true,
    monetized: false,
    active: true,
    voice: { voiceId: 'Kore', language: 'es' },
    visualStyle: { source: 'stock', motion: 'kenburns' },
  });
  const runner = new FakeRunner(db, lanes);
  const events = new FakeEvents();
  const store = new JobsStore(db);
  const laneResolver: LaneResolver = { laneFor: async (stage) => lanes[stage] };
  const bindings = fakeBindings();
  const estimator = new QueueEstimator(makeRegistry(bindings), bindings, db, () => true);
  const make = () =>
    new QueueService(
      store,
      runner,
      laneResolver,
      events as unknown as EventsService,
      new ProductionSummaryReader(db),
      estimator,
      channels,
      { ...TEST_OPTIONS, ...options },
    );
  return { db, sqlite, svc: make(), runner, events, store, channelId: channel.id, make };
}

describe('QueueService', () => {
  let h: Harness;

  afterEach(() => {
    h.svc.onModuleDestroy();
    h.sqlite.close();
  });

  it('runs every stage of a production in order, one job per stage, chaining the next one', async () => {
    h = setup();
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1, topic: 'paz' });
    expect(p.status).toBe('pending');

    const done = await h.svc.waitFor(p.id);
    expect(done.status).toBe('done');
    expect(h.runner.stagesOf(p.id)).toEqual(STAGE_ORDER);

    const state = h.svc.state();
    expect(state.queued).toHaveLength(0);
    expect(state.recent.filter((j) => j.productionId === p.id).map((j) => j.type).sort()).toEqual([...STAGE_ORDER].sort());
    expect(state.recent.every((j) => j.status === 'done' && j.lane === 'cpu' && j.title === 'Video paz')).toBe(true);
    // Every job got linked to the production row once the script stage created it.
    expect(h.store.recent(20).every((j) => j.productionId === p.id)).toBe(true);
  });

  it('accepts channel slugs (CLI) and produces approved scripts', async () => {
    h = setup();
    h.db.insert(scripts).values({ id: 'sc1', channelId: h.channelId, title: 'Aprobado', hook: 'h', body: 'b', cta: 'c', fullText: 'h b c', status: 'approved' }).run();
    const [p] = await h.svc.enqueue({ channelIds: [], count: 1, scriptIds: ['sc1'] });
    expect(p.title).toBe('Aprobado');
    expect((await h.svc.waitFor(p.id)).status).toBe('done');

    const [q] = await h.svc.enqueue({ channelIds: ['fe-diaria'], count: 1 });
    expect((await h.svc.waitFor(q.id)).status).toBe('done');

    h.db.insert(scripts).values({ id: 'draft', channelId: h.channelId, hook: 'h', body: 'b', cta: 'c', fullText: 'h', status: 'draft' }).run();
    await expect(h.svc.enqueue({ channelIds: [], count: 1, scriptIds: ['draft'] })).rejects.toThrow(/no está aprobado/);
  });

  it('never runs more than one GPU job at a time, even across productions', async () => {
    const gpu = Object.fromEntries(STAGE_ORDER.map((s) => [s, 'gpu'])) as Record<StageKey, Lane>;
    h = setup(gpu);
    for (const s of STAGE_ORDER) h.runner.handlers[s] = () => sleep(2);
    const ps = await h.svc.enqueue({ channelIds: [h.channelId], count: 3 });
    await Promise.all(ps.map((p) => h.svc.waitFor(p.id)));

    expect(h.runner.maxRunning.gpu).toBe(1);
    expect(() => h.svc.setLaneConcurrency('gpu', 2)).toThrow(/una sola tarea de GPU/);
  });

  it('runs lanes in parallel within their limits', async () => {
    const lanes = { ...ALL_CPU, script: 'net', voice: 'net' } as Record<StageKey, Lane>;
    h = setup(lanes);
    h.runner.handlers.script = () => sleep(20);
    h.runner.handlers.voice = () => sleep(20);
    h.svc.setLaneConcurrency('net', 2);
    const ps = await h.svc.enqueue({ channelIds: [h.channelId], count: 4 });
    await Promise.all(ps.map((p) => h.svc.waitFor(p.id)));
    expect(h.runner.maxRunning.net).toBe(2);
    expect(h.runner.maxRunning.cpu).toBe(1);
    expect(() => h.svc.setLaneConcurrency('net', 5)).toThrow(/2 a 4/);
  });

  it('picks the highest priority first, then the oldest; finishes videos depth-first', async () => {
    h = setup();
    h.svc.pause();
    const [low] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1, priority: 0 });
    const [high] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1, priority: 5 });
    const [low2] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1, priority: 0 });
    expect(h.svc.state().queued.map((j) => j.productionId)).toEqual([high.id, low.id, low2.id]);
    h.svc.resume();
    await Promise.all([low, high, low2].map((p) => h.svc.waitFor(p.id)));

    const order = h.runner.calls.map((c) => c.productionId);
    // One cpu slot: each production runs all its stages before the next one starts.
    expect(order).toEqual([...Array(7).fill(high.id), ...Array(7).fill(low.id), ...Array(7).fill(low2.id)]);
  });

  it('retries retryable errors with backoff and fails fast on the rest', async () => {
    h = setup();
    h.runner.handlers.voice = async (_ref, _o, call) => {
      if (call < 3) throw new ProviderError('429 demasiadas solicitudes', 'gemini', true);
    };
    const [ok] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    expect((await h.svc.waitFor(ok.id)).status).toBe('done');
    const voiceJob = h.store.recent(20).find((j) => j.type === 'voice' && j.payload.productionId === ok.id);
    expect(voiceJob?.attempts).toBe(3);
    expect(h.events.logs.some((l) => l.level === 'warn' && /reintento 2\/3/.test(l.message))).toBe(true);

    h.runner.handlers.voice = async () => {
      throw new Error('voz inválida');
    };
    const [bad] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    const failed = await h.svc.waitFor(bad.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/voz inválida/);
    const job = h.store.latestForProduction(bad.id);
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(1);
    expect(h.runner.stagesOf(bad.id)).toEqual(['script', 'voice']);
  });

  it('gives up after maxAttempts retryable failures', async () => {
    h = setup();
    h.runner.handlers.render = async () => {
      throw new ProviderError('timeout', 'x', true);
    };
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    expect((await h.svc.waitFor(p.id)).status).toBe('failed');
    expect(h.store.latestForProduction(p.id)?.attempts).toBe(3);
  });

  it('cancel aborts the running job signal; retry re-queues it', async () => {
    h = setup();
    let signal: AbortSignal | undefined;
    h.runner.handlers.render = async (_ref, opts, call) => {
      if (call > 1) return;
      signal = opts.signal;
      opts.onProgress?.(0.3);
      await untilAborted(opts.signal);
    };
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    while (!signal) await sleep(2);
    const job = h.svc.state().lanes.cpu.running[0];
    expect(job.type).toBe('render');
    expect(h.events.emitted.some((e) => e.type === 'progress' && e.jobId === job.id && e.value === 0.3)).toBe(true);

    const canceled = await h.svc.cancel(job.id);
    expect(signal.aborted).toBe(true);
    expect(canceled.status).toBe('canceled');
    const summary = await h.svc.waitFor(p.id);
    expect(summary.status).toBe('canceled');

    const retried = await h.svc.retry(job.id);
    expect(retried.status).toBe('queued');
    expect(retried.attempts).toBe(0);
    expect((await h.svc.waitFor(p.id)).status).toBe('done');
  });

  it('skip stops the job and the chain: the production is canceled', async () => {
    h = setup();
    h.runner.handlers.voice = (_ref, opts) => untilAborted(opts.signal);
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    let job;
    while (!(job = h.svc.state().lanes.cpu.running.find((j) => j.type === 'voice'))) await sleep(2);

    const skipped = await h.svc.skip(job.id);
    expect(skipped.status).toBe('skipped');
    const summary = await h.svc.waitFor(p.id);
    expect(summary.status).toBe('canceled');
    await sleep(10);
    expect(h.runner.stagesOf(p.id)).toEqual(['script', 'voice']);
    expect(h.store.activeForProduction(p.id)).toHaveLength(0);
  });

  it('pause stops taking jobs (running ones finish); resume continues', async () => {
    h = setup();
    let release!: () => void;
    h.runner.handlers.voice = () => new Promise<void>((r) => (release = r));
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    while (!release) await sleep(2);

    const paused = h.svc.pause();
    expect(paused.paused).toBe(true);
    release();
    await sleep(30);
    expect(h.runner.stagesOf(p.id)).toEqual(['script', 'voice']);
    const state = h.svc.state();
    expect(state.queued.map((j) => j.type)).toEqual(['transcribe']);
    expect(state.lanes.cpu.running).toHaveLength(0);

    // Persisted: a new instance comes up paused.
    expect(h.store.getSetting('queue.paused')).toBe(true);
    h.svc.resume();
    expect((await h.svc.waitFor(p.id)).status).toBe('done');
  });

  it('recovers jobs left running by a crash', async () => {
    h = setup();
    const job = h.store.insert({
      productionId: null,
      channelId: h.channelId,
      type: 'script',
      lane: 'cpu',
      priority: 0,
      payload: { productionId: 'crashed', channelId: h.channelId, seq: 1 },
    });
    h.store.update(job.id, { status: 'running', attempts: 1, startedAt: new Date().toISOString() });

    const done = await h.svc.waitFor('crashed');
    expect(done.status).toBe('done');
    expect(h.events.logs.some((l) => /retomaron 1/.test(l.message))).toBe(true);
    expect(h.runner.stagesOf('crashed')).toEqual(STAGE_ORDER);
  });

  it('only one process runs the queue: another one enqueues but does not execute', async () => {
    h = setup();
    h.store.setSetting('queue.lock', { pid: process.ppid, beatAt: Date.now() });
    expect(h.svc.isOwner()).toBe(false);
    await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    await sleep(20);
    expect(h.runner.calls).toHaveLength(0);
    expect(h.svc.state().queued).toHaveLength(1);
  });

  it('retryProduction re-queues from the failed stage or from a given one', async () => {
    h = setup();
    h.runner.handlers.subtitles = async (_r, _o, call) => {
      if (call === 1) throw new Error('fuente rota');
    };
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    expect((await h.svc.waitFor(p.id)).status).toBe('failed');

    const again = await h.svc.retryProduction(p.id);
    expect(again.status).toBe('pending');
    expect((await h.svc.waitFor(p.id)).status).toBe('done');
    expect(h.runner.stagesOf(p.id)).toEqual([...STAGE_ORDER.slice(0, 4), ...STAGE_ORDER.slice(3)]);

    await h.svc.retryProduction(p.id, 'render');
    await h.svc.waitFor(p.id);
    expect(h.runner.stagesOf(p.id).slice(-2)).toEqual(['render', 'qa']);
    await expect(h.svc.retryProduction('missing')).rejects.toThrow(/No existe/);
  });

  it('emits queue, job, production and log events', async () => {
    h = setup();
    const [p] = await h.svc.enqueue({ channelIds: [h.channelId], count: 1 });
    await h.svc.waitFor(p.id);
    await sleep(15);
    const types = new Set(h.events.emitted.map((e) => e.type));
    expect([...types].sort()).toEqual(['job', 'log', 'production', 'queue']);
    const statuses = h.events.emitted.filter((e) => e.type === 'job').map((e) => (e as { job: { status: string } }).job.status);
    expect(statuses).toEqual(expect.arrayContaining(['queued', 'running', 'done']));
    expect(h.events.logs.some((l) => l.message.startsWith('✓ Voz') && l.productionId === p.id && l.jobId)).toBe(true);
    const last = h.events.emitted.filter((e) => e.type === 'production').at(-1) as { production: { status: string } };
    expect(last.production.status).toBe('done');
  });

  it('expectedMs averages the last 20 real runs of the same type + lane', async () => {
    h = setup({ ...ALL_CPU, render: 'gpu' });
    let t = Date.parse('2026-01-01T00:00:00Z');
    const addDone = (ms: number, cached = false) => {
      t += 1000;
      const j = h.store.insert({
        productionId: null,
        channelId: h.channelId,
        type: 'render',
        lane: 'gpu',
        priority: 0,
        payload: { productionId: 'old', channelId: h.channelId, seq: 1, cached },
      });
      h.store.update(j.id, { status: 'done', durationMs: ms, finishedAt: new Date(t).toISOString() });
    };
    for (let i = 0; i < 5; i++) addDone(999_000); // older than the last 20
    for (let i = 0; i < 20; i++) addDone(30_000 + i);
    addDone(1, true); // cached (skipped) runs don't count

    const est = await h.svc.estimate({ channelIds: [h.channelId], count: 2 });
    const render = est.byStage.find((s) => s.stage === 'render');
    expect(render?.lane).toBe('gpu');
    expect(render?.avgMs).toBe(30_010);
    expect(est.videos).toBe(2);
    expect(est.jobs).toBe(14);
    // Two videos share the single GPU slot: at least two renders back to back.
    expect(est.etaMs).toBeGreaterThanOrEqual(2 * 30_000);
    expect(est.blockers).toEqual([]);
  });
});

describe('QueueEstimator.blockers', () => {
  const target = { channelId: 'c1', channelName: 'Fe Diaria' };

  it('reports missing secrets, disabled providers and missing binaries', () => {
    const gemini: ProviderConfig = {
      id: 'gem',
      name: 'Gemini',
      adapter: 'fake',
      capabilities: ['text', 'tts'],
      params: {},
      secretRef: 'GEMINI_API_KEY',
      enabled: true,
    };
    const off: ProviderConfig = { ...FAKE_CONFIG, id: 'off', name: 'Pexels', enabled: false };
    const source = fakeBindings().addConfig(gemini).addConfig(off);
    source.addBinding({ id: 'b1', channelId: 'c1', capability: 'text', role: 'script', providerConfigId: 'gem', params: {}, fallbackIds: [] });
    source.addBinding({ id: 'b2', channelId: 'c1', capability: 'stock', providerConfigId: 'off', params: {}, fallbackIds: [] });
    const { db, sqlite } = createTestDb();
    const est = new QueueEstimator(makeRegistry(source), source, db, (p) => !/ffprobe/.test(p));

    const blockers = est.blockers([target]);
    expect(blockers).toEqual(
      expect.arrayContaining(['Falta GEMINI_API_KEY', 'El proveedor "Pexels" está deshabilitado', expect.stringMatching(/^Falta ffprobe/)]),
    );
    expect(blockers).toHaveLength(3);
    // An approved script doesn't need the text provider.
    expect(est.blockers([{ ...target, scriptId: 's' }])).not.toContain('Falta GEMINI_API_KEY');
    sqlite.close();
  });

  it('is satisfied by a working fallback', () => {
    const gemini: ProviderConfig = { ...FAKE_CONFIG, id: 'gem', name: 'Gemini', secretRef: 'GEMINI_API_KEY' };
    const source = fakeBindings().addConfig(gemini);
    source.addBinding({ id: 'b1', channelId: 'c1', capability: 'text', role: 'script', providerConfigId: 'gem', params: {}, fallbackIds: ['fake'] });
    const { db, sqlite } = createTestDb();
    expect(new QueueEstimator(makeRegistry(source), source, db, () => true).blockers([target])).toEqual([]);
    sqlite.close();
  });
});
