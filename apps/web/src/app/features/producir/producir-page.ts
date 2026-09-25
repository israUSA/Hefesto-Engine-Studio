import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Board, BoardCard, ChannelSummary, Lane, ProduceEstimate, ProduceRequest, StageKey } from '@hefesto/shared-types';
import {
  Button,
  EmptyState,
  formatClockTime,
  formatDurationMs,
  Icon,
  Input,
  Skeleton,
} from '@hefesto/web-ui';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ToastService } from '../../core/toast.service';

type Mode = 'new' | 'approved';
type Priority = -1 | 0 | 1;

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Transcripción',
  subtitles: 'Subtítulos',
  visuals: 'Visuales',
  render: 'Render',
  qa: 'QA',
};

const LANE_LABEL: Record<Lane, string> = { gpu: 'GPU', net: 'Red', cpu: 'CPU' };
const LANE_CLASS: Record<Lane, string> = { gpu: 'gpu', net: 'net', cpu: 'cpu' };
const AVATAR_TONES = ['accent', 'ok', 'warn', 'steel'] as const;

interface ChannelVm {
  summary: ChannelSummary;
  initial: string;
  tone: (typeof AVATAR_TONES)[number];
  approvedCount: number;
}

interface LaneShare {
  lane: Lane;
  label: string;
  cssClass: string;
  jobs: number;
  pct: number;
}

interface ChannelShare {
  channelId: string;
  name: string;
  videos: number;
  minutes: number;
  costUsd: number;
}

type EstimateResult = { kind: 'idle' } | { kind: 'ok'; estimate: ProduceEstimate } | { kind: 'error' };

/**
 * Producir: pick channels + mode, watch a debounced live estimate, then enqueue.
 * See docs/09-diseno-ui.md and design/previews/04-producir.png.
 */
@Component({
  selector: 'hf-producir-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Button, EmptyState, Icon, Input, Skeleton],
  templateUrl: './producir-page.html',
  styleUrl: './producir-page.css',
})
export class ProducirPage {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly loadingChannels = signal(true);
  readonly channelsError = signal<string | null>(null);
  readonly channels = signal<ChannelSummary[]>([]);
  readonly board = signal<Board | null>(null);

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly mode = signal<Mode>('new');
  readonly countPerChannel = signal(2);
  readonly topic = signal('');
  readonly selectedScriptIds = signal<Set<string>>(new Set());
  readonly priority = signal<Priority>(0);

  readonly estimate = signal<ProduceEstimate | null>(null);
  readonly estimating = signal(false);
  readonly estimateError = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly channelVms = computed<ChannelVm[]>(() => {
    const approvedCounts = this.approvedCountByChannel();
    return this.channels().map((summary, index) => ({
      summary,
      initial: summary.channel.name.charAt(0).toUpperCase(),
      tone: AVATAR_TONES[index % AVATAR_TONES.length],
      approvedCount: approvedCounts.get(summary.channel.id) ?? 0,
    }));
  });

  readonly selectedCount = computed(() => this.selectedIds().size);

  private readonly approvedCardsAll = computed<BoardCard[]>(
    () => this.board()?.columns.find((c) => c.id === 'approved')?.cards ?? [],
  );

  private readonly approvedCountByChannel = computed(() => {
    const map = new Map<string, number>();
    for (const card of this.approvedCardsAll()) {
      map.set(card.channelId, (map.get(card.channelId) ?? 0) + 1);
    }
    return map;
  });

  readonly approvedCardsForSelected = computed(() =>
    this.approvedCardsAll().filter((card) => this.selectedIds().has(card.channelId)),
  );

  readonly currentRequest = computed<ProduceRequest | null>(() => {
    const channelIds = [...this.selectedIds()];
    if (channelIds.length === 0) {
      return null;
    }
    if (this.mode() === 'new') {
      const count = this.countPerChannel();
      if (!count || count < 1) {
        return null;
      }
      return { channelIds, count, topic: this.topic().trim() || undefined, priority: this.priority() };
    }
    const scriptIds = [...this.selectedScriptIds()];
    if (scriptIds.length === 0) {
      return null;
    }
    return { channelIds, count: scriptIds.length, scriptIds, priority: this.priority() };
  });

  private readonly perVideoMs = computed(() => {
    const est = this.estimate();
    return est ? est.byStage.reduce((sum, stage) => sum + stage.avgMs, 0) : 0;
  });

  readonly laneShares = computed<LaneShare[]>(() => {
    const est = this.estimate();
    if (!est) {
      return [];
    }
    const lanes: Lane[] = ['gpu', 'net', 'cpu'];
    const raw = lanes.map((lane) => ({
      lane,
      label: LANE_LABEL[lane],
      cssClass: LANE_CLASS[lane],
      jobs: est.byStage.filter((s) => s.lane === lane).length * est.videos,
    }));
    const total = raw.reduce((sum, l) => sum + l.jobs, 0) || 1;
    return raw.filter((l) => l.jobs > 0).map((l) => ({ ...l, pct: (l.jobs / total) * 100 }));
  });

  readonly channelShares = computed<ChannelShare[]>(() => {
    const est = this.estimate();
    if (!est || est.videos === 0) {
      return [];
    }
    const perVideoMs = this.perVideoMs();
    const costPerVideo = est.costUsd / est.videos;
    const videosByChannel = new Map<string, number>();
    if (this.mode() === 'new') {
      for (const id of this.selectedIds()) {
        videosByChannel.set(id, this.countPerChannel());
      }
    } else {
      for (const card of this.approvedCardsForSelected()) {
        if (!this.selectedScriptIds().has(card.id)) {
          continue;
        }
        videosByChannel.set(card.channelId, (videosByChannel.get(card.channelId) ?? 0) + 1);
      }
    }
    const result: ChannelShare[] = [];
    for (const [channelId, videos] of videosByChannel) {
      if (videos <= 0) {
        continue;
      }
      const name = this.channels().find((c) => c.channel.id === channelId)?.channel.name ?? channelId;
      result.push({
        channelId,
        name,
        videos,
        minutes: Math.round((perVideoMs * videos) / 60000),
        costUsd: costPerVideo * videos,
      });
    }
    return result;
  });

  readonly finishClock = computed(() => {
    const est = this.estimate();
    return est ? formatClockTime(Date.now() + est.etaMs) : '';
  });

  readonly etaText = computed(() => {
    const est = this.estimate();
    return est ? formatDurationMs(est.etaMs) : '';
  });

  readonly startNote = computed(() => {
    const state = this.live.queueState();
    const busy = state ? Object.values(state.lanes).some((l) => l.running.length > 0) : false;
    return busy
      ? `Arranca cuando termine la tanda actual. Podés pausarla o reordenarla en Cola.`
      : 'Arranca de inmediato.';
  });

  readonly canSubmit = computed(() => {
    const est = this.estimate();
    return !!this.currentRequest() && !!est && est.blockers.length === 0 && !this.submitting();
  });

  constructor() {
    this.loadChannels();
    this.loadBoard();

    toObservable(this.currentRequest)
      .pipe(
        debounceTime(350),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap((req): import('rxjs').Observable<EstimateResult> => {
          if (!req) {
            return of({ kind: 'idle' as const });
          }
          this.estimating.set(true);
          return this.api.estimateProduction(req).pipe(
            map((estimate) => ({ kind: 'ok' as const, estimate })),
            catchError(() => of({ kind: 'error' as const })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        this.estimating.set(false);
        if (result.kind === 'idle') {
          this.estimate.set(null);
          this.estimateError.set(null);
        } else if (result.kind === 'ok') {
          this.estimate.set(result.estimate);
          this.estimateError.set(null);
        } else {
          this.estimateError.set('No se pudo calcular el resumen.');
        }
      });

    // Prune script selections that no longer belong to the filtered approved list.
    effect(() => {
      const validIds = new Set(this.approvedCardsForSelected().map((c) => c.id));
      const current = this.selectedScriptIds();
      const pruned = new Set([...current].filter((id) => validIds.has(id)));
      if (pruned.size !== current.size) {
        this.selectedScriptIds.set(pruned);
      }
    });
  }

  loadChannels(): void {
    this.loadingChannels.set(true);
    this.channelsError.set(null);
    this.api.listChannels().subscribe({
      next: (channels) => {
        this.channels.set(channels);
        this.loadingChannels.set(false);
      },
      error: () => {
        this.loadingChannels.set(false);
        this.channelsError.set('No se pudo conectar con el motor.');
      },
    });
  }

  private loadBoard(): void {
    this.api.getBoard().subscribe({ next: (board) => this.board.set(board), error: () => undefined });
  }

  toggleChannel(id: string): void {
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
  }

  setPriority(priority: Priority): void {
    this.priority.set(priority);
  }

  toggleScript(id: string): void {
    this.selectedScriptIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  selectAllApproved(): void {
    this.selectedScriptIds.set(new Set(this.approvedCardsForSelected().map((c) => c.id)));
  }

  clearApproved(): void {
    this.selectedScriptIds.set(new Set());
  }

  stageLabel(stage: StageKey): string {
    return STAGE_LABEL[stage] ?? stage;
  }

  laneLabel(lane: Lane): string {
    return LANE_LABEL[lane] ?? lane;
  }

  forge(): void {
    const request = this.currentRequest();
    const est = this.estimate();
    if (!request || !est || est.blockers.length > 0 || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.api.produce(request).subscribe({
      next: (productions) => {
        this.submitting.set(false);
        this.toasts.ok(`${productions.length} video${productions.length === 1 ? '' : 's'} en cola.`);
        this.router.navigate(['/cola']);
      },
      error: () => {
        this.submitting.set(false);
        this.toasts.error('No se pudo encolar la tanda.');
      },
    });
  }
}
