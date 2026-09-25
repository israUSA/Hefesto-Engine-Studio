import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Board, ChannelSummary, ProductionSummary, ProviderDto, StageKey } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, IconName, Metric, ProgressBar, Skeleton, StatusChip, Thumb9x16 } from '@hefesto/web-ui';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';

const REFRESH_MS = 20000;
const RECENT_WINDOW = 100;

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Transcripción',
  subtitles: 'Subtítulos',
  visuals: 'Visuales',
  render: 'Render',
  qa: 'QA',
};

interface ChannelRow {
  summary: ChannelSummary;
  recent: ProductionSummary[];
  platformIcon: IconName;
}

interface AttentionRow {
  production: ProductionSummary;
  reason: string;
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Hoy: the day's dashboard, built entirely from real endpoints (channels, board,
 * recent productions, live events). Anything that needs the publishing calendar
 * (Fase 5/6) renders an honest empty state instead of invented numbers.
 */
@Component({
  selector: 'hf-hoy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, EmptyState, Icon, Metric, ProgressBar, Skeleton, StatusChip, Thumb9x16],
  templateUrl: './hoy-page.html',
  styleUrl: './hoy-page.css',
})
export class HoyPage {
  private readonly api = inject(ApiClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly live = inject(LiveEvents);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly channels = signal<ChannelSummary[]>([]);
  readonly board = signal<Board | null>(null);
  readonly recent = signal<ProductionSummary[]>([]);
  readonly providers = signal<ProviderDto[]>([]);

  /** Fresh install: no channels yet. Hefesto ships empty — sample channels are demo-only. */
  readonly hasNoChannels = computed(() => this.channels().length === 0);
  readonly missingSecrets = computed(() => this.providers().some((p) => p.secret && !p.secret.present));

  readonly todayLabel = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date())
    .toUpperCase();
  readonly weekLabel = `Semana ${isoWeek(new Date())}`;

  readonly readyCount = computed(() => this.recent().filter((p) => p.status === 'done' && p.qaPassed !== false).length);
  readonly queuedCount = computed(() => this.channels().reduce((sum, c) => sum + c.inQueue, 0));
  readonly attentionRows = computed<AttentionRow[]>(() =>
    this.recent()
      .filter((p) => p.status === 'failed' || p.qaPassed === false)
      .slice(0, 6)
      .map((production) => ({
        production,
        reason: production.status === 'failed' ? (production.error || 'Falló durante la producción') : 'Falló el control de calidad',
      })),
  );
  readonly failedCount = computed(() => this.attentionRows().length);
  readonly monthlySpend = computed(() => this.channels().reduce((sum, c) => sum + c.costThisMonthUsd, 0));

  readonly forgingNow = computed(() => Object.values(this.live.productions()).filter((p) => p.status === 'running'));

  readonly pipeline = computed(() => {
    const columns = this.board()?.columns ?? [];
    const max = Math.max(1, ...columns.map((c) => c.cards.length));
    return columns.map((c) => ({ id: c.id, label: c.label, count: c.cards.length, pct: (c.cards.length / max) * 100 }));
  });

  readonly channelRows = computed<ChannelRow[]>(() =>
    this.channels().map((summary) => ({
      summary,
      recent: this.recent()
        .filter((p) => p.channelId === summary.channel.id)
        .slice(0, 5),
      platformIcon: summary.channel.platform === 'tiktok' ? 'tiktok' : 'youtube',
    })),
  );

  stageLabel(stage?: StageKey): string {
    return stage ? (STAGE_LABEL[stage] ?? stage) : '';
  }

  pct(value: number): number {
    return Math.round(value <= 1 ? value * 100 : value);
  }

  formatDuration(ms?: number): string {
    if (!ms) return '';
    const totalSec = Math.round(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  }

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(), REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  load(): void {
    forkJoin({
      channels: this.api.listChannels(),
      board: this.api.getBoard(),
      recent: this.api.listProductions({ limit: RECENT_WINDOW }),
      providers: this.api.listProviders(),
    }).subscribe({
      next: ({ channels, board, recent, providers }) => {
        this.channels.set(channels);
        this.board.set(board);
        this.recent.set(recent.items);
        this.providers.set(providers);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }
}
