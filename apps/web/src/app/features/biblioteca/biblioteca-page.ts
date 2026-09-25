import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ChannelSummary, ProductionSummary } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Select, SelectOption, Skeleton, StatusChip, Thumb9x16 } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ProductionInspector } from './production-inspector';

type QaFilter = 'all' | 'running' | 'ready' | 'qa-failed' | 'failed';

const QA_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Todo' },
  { value: 'running', label: 'Forjando' },
  { value: 'ready', label: 'Listos' },
  { value: 'qa-failed', label: 'Con fallas QA' },
  { value: 'failed', label: 'Fallidos' },
];

const PAGE_SIZE = 24;

function statusOf(p: ProductionSummary): { label: string; tone: 'ok' | 'warn' | 'danger' | 'steel' | 'accent' | 'neutral' } {
  if (p.status === 'failed') return { label: 'Falló', tone: 'danger' };
  if (p.status === 'running') return { label: 'Forjando', tone: 'accent' };
  if (p.qaPassed === false) return { label: 'Revisar', tone: 'warn' };
  if (p.stage === 'published') return { label: 'Publicado', tone: 'ok' };
  if (p.status === 'done') return { label: 'Listo', tone: 'ok' };
  return { label: 'Pendiente', tone: 'neutral' };
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  const totalSec = Math.round(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

/**
 * Biblioteca: paginated grid of every production, filterable by channel and
 * QA/status, with an inspector panel for the selected video. See docs/09-diseno-ui.md.
 */
@Component({
  selector: 'hf-biblioteca-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Button, EmptyState, Icon, Select, Skeleton, StatusChip, Thumb9x16, ProductionInspector],
  templateUrl: './biblioteca-page.html',
  styleUrl: './biblioteca-page.css',
})
export class BibliotecaPage {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly items = signal<ProductionSummary[]>([]);
  readonly total = signal(0);
  readonly hasMore = computed(() => this.items().length < this.total());

  readonly channels = signal<ChannelSummary[]>([]);
  /** Fresh install: no channels yet. Hefesto ships empty — sample channels are demo-only. */
  readonly hasNoChannels = computed(() => this.channels().length === 0);
  readonly channelFilter = signal<string>('');
  readonly qaFilter = signal<QaFilter>('all');
  readonly sortDesc = signal(true);

  readonly selectedId = signal<string | null>(null);
  /** Set when the inspector was opened via a deep link (?open=) for a production outside the current page. */
  readonly deepLinkOnly = signal(false);

  private offset = 0;

  readonly channelOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Todos los canales' },
    ...this.channels().map((c) => ({ value: c.channel.id, label: c.channel.name })),
  ]);

  readonly qaOptions = QA_FILTER_OPTIONS;

  readonly displayItems = computed(() => {
    const list = this.items();
    return this.sortDesc() ? list : [...list].reverse();
  });

  statusOf = statusOf;
  formatDuration = formatDuration;

  constructor() {
    this.api.listChannels().subscribe({ next: (channels) => this.channels.set(channels), error: () => void 0 });

    const openId = this.route.snapshot.queryParamMap.get('open');
    if (openId) {
      this.selectedId.set(openId);
      this.deepLinkOnly.set(true);
    }

    this.load(true);

    // Patch already-visible cards in place when the server pushes a live update
    // (progress ticking, a render finishing, QA settling). We don't inject brand
    // new rows here to keep the pagination total consistent with the server.
    effect(() => {
      const byId = this.live.productions();
      const current = this.items();
      let changed = false;
      const next = current.map((item) => {
        const update = byId[item.id];
        if (update && update.updatedAt !== item.updatedAt) {
          changed = true;
          return update;
        }
        return item;
      });
      if (changed) {
        this.items.set(next);
      }
    });
  }

  load(reset: boolean): void {
    if (reset) {
      this.offset = 0;
      this.loading.set(true);
    } else {
      this.loadingMore.set(true);
    }
    this.loadError.set(null);

    const status = this.serverStatusParam();
    this.api
      .listProductions({
        channelId: this.channelFilter() || undefined,
        status,
        limit: PAGE_SIZE,
        offset: this.offset,
      })
      .subscribe({
        next: (page) => {
          const filtered = this.applyClientFilter(page.items);
          this.items.update((cur) => (reset ? filtered : [...cur, ...filtered]));
          this.total.set(page.total);
          this.offset += page.items.length;
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadingMore.set(false);
          this.loadError.set('No se pudo conectar con el motor.');
        },
      });
  }

  private serverStatusParam(): string | undefined {
    const f = this.qaFilter();
    if (f === 'running') return 'running';
    if (f === 'failed') return 'failed';
    if (f === 'ready' || f === 'qa-failed') return 'done';
    return undefined;
  }

  private applyClientFilter(rows: ProductionSummary[]): ProductionSummary[] {
    const f = this.qaFilter();
    if (f === 'ready') return rows.filter((r) => r.qaPassed !== false);
    if (f === 'qa-failed') return rows.filter((r) => r.qaPassed === false);
    return rows;
  }

  onFilterChange(): void {
    this.load(true);
  }

  toggleSort(): void {
    this.sortDesc.set(!this.sortDesc());
  }

  loadMore(): void {
    this.load(false);
  }

  select(id: string): void {
    this.deepLinkOnly.set(false);
    this.selectedId.set(id);
  }

  closeInspector(): void {
    this.selectedId.set(null);
    if (this.route.snapshot.queryParamMap.get('open')) {
      this.router.navigate([], { queryParams: {} });
    }
  }

  onDeleted(id: string): void {
    this.items.update((cur) => cur.filter((p) => p.id !== id));
    this.total.update((t) => Math.max(0, t - 1));
    this.closeInspector();
  }

  onRetried(): void {
    // The inspector already refreshed its own detail; nudge the grid row too.
    this.load(true);
  }
}
