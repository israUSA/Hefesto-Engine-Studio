import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { JobDto, JobStatus, Lane, QueueState, StageKey } from '@hefesto/shared-types';
import { Button, EmptyState, formatClockTime, formatDurationMs, Icon, Skeleton, StatusChip, StatusTone } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ToastService } from '../../core/toast.service';
import { LaneRow, QueueTimeline } from './queue-timeline';

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Whisper',
  subtitles: 'Subtítulos',
  visuals: 'Imágenes',
  render: 'Render',
  qa: 'QA',
};

const LANE_LABEL: Record<Lane, string> = { gpu: 'GPU', net: 'Red', cpu: 'CPU' };
const DEFAULT_CONCURRENCY: Record<Lane, number> = { gpu: 1, net: 3, cpu: 2 };
const LANES: Lane[] = ['gpu', 'net', 'cpu'];

const STATUS_TONE: Record<JobStatus, StatusTone> = {
  queued: 'neutral',
  running: 'accent',
  done: 'ok',
  failed: 'danger',
  skipped: 'neutral',
  canceled: 'neutral',
};

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'Corriendo',
  done: 'Hecho',
  failed: 'Error',
  skipped: 'Saltada',
  canceled: 'Cancelada',
};

interface JobRow {
  job: JobDto;
  statusTone: StatusTone;
  statusLabel: string;
  isFailed: boolean;
  isQueued: boolean;
  isRunning: boolean;
  durationText: string;
}

/** Cola: live timeline by lane + a flat table of jobs, everything driven by LiveEvents. */
@Component({
  selector: 'hf-cola-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, Icon, QueueTimeline, Skeleton, StatusChip],
  templateUrl: './cola-page.html',
  styleUrl: './cola-page.css',
})
export class ColaPage {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly toasts = inject(ToastService);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  private readonly fallback = signal<QueueState | null>(null);
  readonly busyIds = signal<Set<string>>(new Set());
  readonly pausing = signal(false);
  readonly retryingAll = signal(false);

  readonly queue = computed<QueueState | null>(() => this.live.queueState() ?? this.fallback());
  readonly connected = this.live.connected;

  readonly laneRows = computed<LaneRow[]>(() => {
    const q = this.queue();
    return LANES.map((lane) => ({
      lane,
      label: LANE_LABEL[lane],
      concurrency: q?.lanes[lane]?.concurrency ?? DEFAULT_CONCURRENCY[lane],
      running: (q?.lanes[lane]?.running ?? []).map((j) => this.merge(j)),
      queued: (q?.queued ?? []).filter((j) => j.lane === lane).map((j) => this.merge(j)),
    }));
  });

  readonly failedCount = computed(() => this.tableRows().filter((r) => r.isFailed).length);
  readonly runningCount = computed(() => this.tableRows().filter((r) => r.isRunning).length);

  readonly tableRows = computed<JobRow[]>(() => {
    const q = this.queue();
    if (!q) {
      return [];
    }
    const running = LANES.flatMap((lane) => (q.lanes[lane]?.running ?? []).map((j) => this.merge(j)));
    const seen = new Set(running.map((j) => j.id));
    const queued = q.queued.map((j) => this.merge(j)).filter((j) => !seen.has(j.id));
    for (const j of queued) {
      seen.add(j.id);
    }
    const recent = q.recent.map((j) => this.merge(j)).filter((j) => !seen.has(j.id));
    return [...running, ...queued, ...recent].map((job) => this.toRow(job));
  });

  readonly totalTasks = computed(() => this.tableRows().length);
  readonly etaText = computed(() => {
    const q = this.queue();
    return q ? formatDurationMs(q.etaMs) : '';
  });
  readonly finishClock = computed(() => {
    const q = this.queue();
    return q ? formatClockTime(Date.now() + q.etaMs) : '';
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getQueue().subscribe({
      next: (state) => {
        this.fallback.set(state);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  private merge(job: JobDto): JobDto {
    const patch = this.live.jobsById()[job.id];
    return patch ? { ...job, ...patch } : job;
  }

  private toRow(job: JobDto): JobRow {
    const durationText =
      job.status === 'running' && job.expectedMs && job.startedAt
        ? formatDurationMs(Math.max(0, job.expectedMs - (Date.now() - new Date(job.startedAt).getTime())))
        : job.durationMs
          ? formatDurationMs(job.durationMs)
          : job.expectedMs
            ? `~${formatDurationMs(job.expectedMs)}`
            : '–';
    return {
      job,
      statusTone: STATUS_TONE[job.status],
      statusLabel: STATUS_LABEL[job.status],
      isFailed: job.status === 'failed',
      isQueued: job.status === 'queued',
      isRunning: job.status === 'running',
      durationText,
    };
  }

  stageLabel(stage: StageKey): string {
    return STAGE_LABEL[stage] ?? stage;
  }

  laneLabel(lane: Lane): string {
    return LANE_LABEL[lane] ?? lane;
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update((set) => {
      const next = new Set(set);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  togglePause(): void {
    this.pausing.set(true);
    const action = this.queue()?.paused ? this.api.resumeQueue() : this.api.pauseQueue();
    action.subscribe({
      next: (state) => {
        this.fallback.set(state);
        this.pausing.set(false);
      },
      error: () => {
        this.pausing.set(false);
        this.toasts.error('No se pudo cambiar el estado de la cola.');
      },
    });
  }

  skip(job: JobDto): void {
    this.setBusy(job.id, true);
    this.api.skipJob(job.id).subscribe({
      next: () => this.setBusy(job.id, false),
      error: () => {
        this.setBusy(job.id, false);
        this.toasts.error('No se pudo saltar la tarea.');
      },
    });
  }

  cancel(job: JobDto): void {
    this.setBusy(job.id, true);
    this.api.cancelJob(job.id).subscribe({
      next: () => this.setBusy(job.id, false),
      error: () => {
        this.setBusy(job.id, false);
        this.toasts.error('No se pudo cancelar la tarea.');
      },
    });
  }

  retry(job: JobDto): void {
    this.setBusy(job.id, true);
    this.api.retryJob(job.id).subscribe({
      next: () => {
        this.setBusy(job.id, false);
        this.toasts.ok('Tarea reencolada.');
      },
      error: () => {
        this.setBusy(job.id, false);
        this.toasts.error('No se pudo reintentar la tarea.');
      },
    });
  }

  bumpPriority(job: JobDto, delta: number): void {
    this.setBusy(job.id, true);
    this.api.setJobPriority(job.id, job.priority + delta).subscribe({
      next: () => this.setBusy(job.id, false),
      error: () => {
        this.setBusy(job.id, false);
        this.toasts.error('No se pudo cambiar la prioridad.');
      },
    });
  }

  retryAllFailed(): void {
    const failed = this.tableRows().filter((r) => r.isFailed).map((r) => r.job);
    if (failed.length === 0) {
      return;
    }
    this.retryingAll.set(true);
    let remaining = failed.length;
    let errors = 0;
    for (const job of failed) {
      this.api.retryJob(job.id).subscribe({
        next: () => {
          remaining -= 1;
          if (remaining === 0) {
            this.retryingAll.set(false);
            this.toasts.ok(errors === 0 ? 'Tareas reencoladas.' : `${failed.length - errors} de ${failed.length} reencoladas.`);
          }
        },
        error: () => {
          remaining -= 1;
          errors += 1;
          if (remaining === 0) {
            this.retryingAll.set(false);
            this.toasts.error('Algunas tareas no se pudieron reintentar.');
          }
        },
      });
    }
  }
}
