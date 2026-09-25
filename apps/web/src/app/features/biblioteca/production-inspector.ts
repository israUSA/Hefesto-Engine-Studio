import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ProductionDetail, StageKey } from '@hefesto/shared-types';
import { STAGE_ORDER } from '@hefesto/shared-types';
import { Button, Dialog, EmptyState, Icon, Select, SelectOption, Skeleton, StatusChip, Tag } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ToastService } from '../../core/toast.service';

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Transcripción',
  subtitles: 'Subtítulos',
  visuals: 'Visuales',
  render: 'Render',
  qa: 'QA',
};

type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

function stageTone(state: StageState): 'ok' | 'accent' | 'danger' | 'steel' | 'neutral' {
  if (state === 'done') return 'ok';
  if (state === 'running') return 'accent';
  if (state === 'failed') return 'danger';
  if (state === 'skipped') return 'steel';
  return 'neutral';
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '—';
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

/**
 * Right-hand inspector for a selected production: player, metadata, QA checks,
 * scene list and stage-restart / delete actions. See docs/09-diseno-ui.md (Biblioteca).
 */
@Component({
  selector: 'hf-production-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, Icon, Select, Skeleton, StatusChip, Tag, EmptyState, Dialog],
  templateUrl: './production-inspector.html',
  styleUrl: './production-inspector.css',
})
export class ProductionInspector {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly toasts = inject(ToastService);

  readonly productionId = input.required<string>();
  readonly closed = output<void>();
  readonly deleted = output<string>();
  readonly retried = output<void>();

  private readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detail = signal<ProductionDetail | null>(null);

  readonly retryStage = signal<string>('');
  readonly retrying = signal(false);
  readonly deleteOpen = signal(false);
  readonly deleting = signal(false);

  readonly stageOptions: SelectOption[] = [
    { value: '', label: 'Desde el principio' },
    ...STAGE_ORDER.map((key) => ({ value: key, label: STAGE_LABEL[key] })),
  ];

  readonly qaSummary = computed(() => {
    const qa = this.detail()?.qa;
    if (!qa) return null;
    const passedCount = qa.checks.filter((c) => c.passed).length;
    return { passed: qa.passed, ratio: `${passedCount}/${qa.checks.length}` };
  });

  formatDuration = formatDuration;
  stageTone = stageTone;

  stageLabel(key: StageKey): string {
    return STAGE_LABEL[key] ?? key;
  }

  formatTime(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  constructor() {
    effect(() => {
      const id = this.productionId();
      this.load(id);
    });

    // Refresh the detail once a live update marks this production as no longer running
    // (QA results, scenes and stage states only settle once the run finishes).
    effect(() => {
      const id = this.productionId();
      const live = this.live.productions()[id];
      const current = this.detail();
      if (live && current && live.updatedAt !== current.updatedAt && live.status !== 'running') {
        this.load(id);
      }
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.retryStage.set('');
    this.api.getProduction(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo cargar la producción.');
      },
    });
  }

  seekTo(startMs: number): void {
    const video = this.videoEl()?.nativeElement;
    if (video) {
      video.currentTime = startMs / 1000;
      void video.play().catch(() => void 0);
    }
  }

  retry(): void {
    const detail = this.detail();
    if (!detail) return;
    this.retrying.set(true);
    const fromStage = (this.retryStage() || undefined) as StageKey | undefined;
    this.api.retryProduction(detail.id, fromStage).subscribe({
      next: () => {
        this.retrying.set(false);
        this.toasts.ok('Producción reencolada.');
        this.retried.emit();
        this.load(detail.id);
      },
      error: () => {
        this.retrying.set(false);
        this.toasts.error('No se pudo reencolar la producción.');
      },
    });
  }

  confirmDelete(): void {
    const detail = this.detail();
    if (!detail) return;
    this.deleting.set(true);
    this.api.deleteProduction(detail.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.toasts.ok('Producción eliminada.');
        this.deleted.emit(detail.id);
      },
      error: () => {
        this.deleting.set(false);
        this.toasts.error('No se pudo eliminar la producción.');
      },
    });
  }
}
