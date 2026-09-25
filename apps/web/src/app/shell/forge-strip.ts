import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import type { JobDto, StageKey } from '@hefesto/shared-types';
import { Button, Icon, ProgressBar, StatusChip } from '@hefesto/web-ui';
import { ApiClient } from '../core/api-client';
import { LiveEvents } from '../core/live-events';
import { ToastService } from '../core/toast.service';

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Transcripción',
  subtitles: 'Subtítulos',
  visuals: 'Visuales',
  render: 'Render',
  qa: 'QA',
};

/** Persistent top strip: shows the job currently forging, or an idle state. */
@Component({
  selector: 'hf-forge-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Button, ProgressBar, StatusChip],
  template: `
    <div class="hf-forge">
      @if (currentJob(); as job) {
        <div class="hf-forge__status">
          <hf-status-chip tone="accent" [pulse]="true">FORJANDO</hf-status-chip>
        </div>
        <div class="hf-forge__title">
          @if (job.channelName) {
            <span class="hf-forge__channel">{{ job.channelName }}</span>
            <span class="hf-forge__sep">·</span>
          }
          <span>{{ job.title || stageLabel(job.type) }}</span>
        </div>
        <div class="hf-forge__stage">{{ stageLabel(job.type) }}</div>
        <div class="hf-forge__bar">
          <hf-progress-bar [value]="pct(job)" />
        </div>
        <div class="hf-forge__pct">{{ pct(job) }}%</div>
        <div class="hf-forge__eta">{{ eta(job) }}</div>
        <div class="hf-forge__actions">
          <hf-button variant="icon" (pressed)="togglePause()" [attr.aria-label]="paused() ? 'Reanudar' : 'Pausar'">
            <hf-icon [name]="paused() ? 'play' : 'pause'" [size]="14" />
          </hf-button>
          <hf-button variant="icon" (pressed)="skip(job)" aria-label="Saltar">
            <hf-icon name="skip" [size]="14" />
          </hf-button>
          <hf-button variant="icon" (pressed)="stop(job)" aria-label="Detener">
            <hf-icon name="stop" [size]="14" />
          </hf-button>
        </div>
      } @else {
        <div class="hf-forge__idle">
          <hf-status-chip tone="neutral">
            {{ paused() ? 'COLA EN PAUSA' : 'SIN ACTIVIDAD' }}
          </hf-status-chip>
          <span class="hf-forge__idle-text">Nada forjando ahora mismo.</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--space-3) var(--space-5);
      border-bottom: 1px solid var(--line);
    }
    .hf-forge {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 24px;
    }
    .hf-forge__title {
      font-size: var(--text-base);
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hf-forge__channel {
      color: var(--text);
      font-weight: 500;
    }
    .hf-forge__sep {
      color: var(--text-3);
      margin: 0 4px;
    }
    .hf-forge__stage {
      color: var(--text-3);
      font-size: var(--text-sm);
      white-space: nowrap;
      padding-left: var(--space-3);
      border-left: 1px solid var(--line);
    }
    .hf-forge__bar {
      flex: 1;
      min-width: 80px;
    }
    .hf-forge__pct {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--text-2);
      width: 36px;
      text-align: right;
    }
    .hf-forge__eta {
      font-family: var(--font-mono);
      font-size: var(--text-sm);
      color: var(--text-3);
      width: 48px;
    }
    .hf-forge__actions {
      display: flex;
      gap: var(--space-2);
    }
    .hf-forge__idle {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .hf-forge__idle-text {
      color: var(--text-3);
      font-size: var(--text-base);
    }
  `,
})
export class ForgeStrip {
  private readonly live = inject(LiveEvents);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  readonly paused = computed(() => this.live.queueState()?.paused ?? false);

  readonly currentJob = computed<JobDto | null>(() => {
    const state = this.live.queueState();
    if (!state) {
      return null;
    }
    for (const lane of Object.values(state.lanes)) {
      if (lane.running.length > 0) {
        return lane.running[0];
      }
    }
    return null;
  });

  stageLabel(stage: StageKey): string {
    return STAGE_LABEL[stage] ?? stage;
  }

  pct(job: JobDto): number {
    const raw = job.progress ?? 0;
    return Math.round(raw <= 1 ? raw * 100 : raw);
  }

  eta(job: JobDto): string {
    if (!job.expectedMs || !job.startedAt) {
      return '';
    }
    this.now(); // depend on the ticking clock
    const elapsed = Date.now() - new Date(job.startedAt).getTime();
    const remainingMs = Math.max(0, job.expectedMs - elapsed);
    const totalSec = Math.round(remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  togglePause(): void {
    const action = this.paused() ? this.api.resumeQueue() : this.api.pauseQueue();
    action.subscribe({
      error: () => this.toasts.error('No se pudo cambiar el estado de la cola.'),
    });
  }

  skip(job: JobDto): void {
    this.api.skipJob(job.id).subscribe({
      next: () => this.toasts.ok('Tarea saltada.'),
      error: () => this.toasts.error('No se pudo saltar la tarea.'),
    });
  }

  stop(job: JobDto): void {
    this.api.cancelJob(job.id).subscribe({
      next: () => this.toasts.ok('Tarea detenida.'),
      error: () => this.toasts.error('No se pudo detener la tarea.'),
    });
  }
}
