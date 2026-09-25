import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import type { ProductionSummary } from '@hefesto/shared-types';
import { EmptyState, Skeleton, StatusChip, Thumb9x16 } from '@hefesto/web-ui';
import { ApiClient } from '../../../core/api-client';
import { ChannelDetailStore } from './channel-detail.store';

type StatusTone = 'ok' | 'warn' | 'danger' | 'steel' | 'accent' | 'neutral';

function statusLabel(p: ProductionSummary): { label: string; tone: StatusTone } {
  if (p.status === 'failed') {
    return { label: 'Falló', tone: 'danger' };
  }
  if (p.status === 'running') {
    return { label: 'Forjando', tone: 'accent' };
  }
  if (p.qaPassed === false) {
    return { label: 'Con fallo QA', tone: 'danger' };
  }
  if (p.stage === 'published') {
    return { label: 'Publicado', tone: 'ok' };
  }
  if (p.stage === 'scheduled') {
    return { label: 'Programado', tone: 'steel' };
  }
  if (p.status === 'done') {
    return { label: 'Listo', tone: 'ok' };
  }
  return { label: 'Pendiente', tone: 'neutral' };
}

function formatDuration(ms?: number): string {
  if (!ms) {
    return '';
  }
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

/** Grid of the channel's videos as 9:16 thumbnails, the app's real protagonists. */
@Component({
  selector: 'hf-videos-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Thumb9x16, StatusChip, Skeleton, EmptyState],
  template: `
    @if (loading()) {
      <div class="hf-videos-grid">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <hf-skeleton />
        }
      </div>
    } @else if (error()) {
      <hf-empty-state icon="wifi-off" [title]="error()!" />
    } @else if (productions().length === 0) {
      <hf-empty-state icon="clapperboard" title="Este canal todavía no tiene videos" detail="Producí el primero desde 'Producir para este canal'." />
    } @else {
      <div class="hf-videos-grid">
        @for (p of productions(); track p.id) {
          <div class="hf-video-card">
            <hf-thumb-9x16 [imageUrl]="p.thumbUrl ?? null" [durationText]="formatDuration(p.durationMs)" />
            <p class="hf-video-card__title">{{ p.title }}</p>
            <hf-status-chip [tone]="statusOf(p).tone">{{ statusOf(p).label }}</hf-status-chip>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-videos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: var(--space-4);
    }
    .hf-video-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .hf-video-card__title {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--text-2);
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
  `,
})
export class VideosTab {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ChannelDetailStore);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly productions = signal<ProductionSummary[]>([]);

  private readonly channelId = computed(() => this.store.channel()?.id ?? null);

  constructor() {
    effect(() => {
      const id = this.channelId();
      if (id) {
        this.load(id);
      }
    });
  }

  formatDuration = formatDuration;
  statusOf = statusLabel;

  private load(channelId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listProductions({ channelId, limit: 60 }).subscribe({
      next: (page) => {
        this.productions.set(page.items);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudieron cargar los videos.');
      },
    });
  }
}
