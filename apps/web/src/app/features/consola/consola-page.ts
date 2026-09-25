import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { LogEntry, LogLevel } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Input, Select, SelectOption, Skeleton } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ToastService } from '../../core/toast.service';

type LevelFilter = 'all' | LogLevel;

const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'Debug', info: 'Info', warn: 'Avisos', error: 'Errores' };
const ALL_OPTION: SelectOption = { value: 'all', label: 'Todos' };
const RENDER_CAP = 500;

interface LogRow {
  entry: LogEntry;
  time: string;
  jobShort: string;
}

/** Consola: live tail of LogEntry from LiveEvents, seeded once from GET /api/logs. */
@Component({
  selector: 'hf-consola-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, EmptyState, Icon, Input, Select, Skeleton],
  templateUrl: './consola-page.html',
  styleUrl: './consola-page.css',
})
export class ConsolaPage {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly levelFilter = signal<LevelFilter>('all');
  readonly sourceFilter = signal('all');
  readonly productionFilter = signal('all');
  readonly search = signal('');
  readonly follow = signal(true);
  readonly clearedBeforeId = signal(0);
  readonly rateLabel = signal('');

  private readonly programmaticScroll = signal(false);
  private readonly scrollEl = viewChild<ElementRef<HTMLElement>>('scrollEl');

  readonly rawLogs = this.live.logs;

  readonly baseLogs = computed(() => this.rawLogs().filter((e) => e.id > this.clearedBeforeId()));

  readonly sourceOptions = computed<SelectOption[]>(() => {
    const sources = new Set(this.rawLogs().map((e) => e.source));
    return [ALL_OPTION, ...[...sources].sort().map((s) => ({ value: s, label: s.toUpperCase() }))];
  });

  readonly productionOptions = computed<SelectOption[]>(() => {
    const productions = this.live.productions();
    const ids = new Set(this.rawLogs().map((e) => e.productionId).filter((id): id is string => !!id));
    return [
      ALL_OPTION,
      ...[...ids].map((id) => ({
        value: id,
        label: productions[id]?.title ? `${productions[id].title} (${id.slice(0, 8)})` : id.slice(0, 8),
      })),
    ];
  });

  readonly counts = computed(() => {
    const base = this.baseLogs();
    return {
      all: base.length,
      debug: base.filter((e) => e.level === 'debug').length,
      info: base.filter((e) => e.level === 'info').length,
      warn: base.filter((e) => e.level === 'warn').length,
      error: base.filter((e) => e.level === 'error').length,
    };
  });

  readonly filtered = computed<LogEntry[]>(() => {
    const level = this.levelFilter();
    const source = this.sourceFilter();
    const production = this.productionFilter();
    const rawQuery = this.search().trim().toLowerCase();
    const jobQuery = rawQuery.startsWith('job:') ? rawQuery.slice(4).trim() : null;
    const textQuery = jobQuery === null ? rawQuery : '';
    return this.baseLogs().filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false;
      if (source !== 'all' && entry.source !== source) return false;
      if (production !== 'all' && entry.productionId !== production) return false;
      if (jobQuery && !(entry.jobId ?? '').toLowerCase().includes(jobQuery)) return false;
      if (textQuery && !entry.message.toLowerCase().includes(textQuery)) return false;
      return true;
    });
  });

  readonly rendered = computed<LogRow[]>(() => {
    const rows = this.filtered();
    const visible = rows.length > RENDER_CAP ? rows.slice(rows.length - RENDER_CAP) : rows;
    return visible.map((entry) => ({
      entry,
      time: this.formatTime(entry.at),
      jobShort: entry.jobId ? `#${entry.jobId.slice(0, 4)}` : '–',
    }));
  });

  readonly hiddenCount = computed(() => Math.max(0, this.filtered().length - RENDER_CAP));

  constructor() {
    this.load();

    let lastCount = 0;
    const timer = setInterval(() => {
      const count = this.rawLogs().length;
      const delta = count - lastCount;
      this.rateLabel.set(delta > 0 ? `${delta} líneas/s` : '');
      lastCount = count;
    }, 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));

    effect(() => {
      this.rendered();
      if (!this.follow()) {
        return;
      }
      const el = this.scrollEl()?.nativeElement;
      if (!el) {
        return;
      }
      queueMicrotask(() => {
        this.programmaticScroll.set(true);
        el.scrollTop = el.scrollHeight;
        this.programmaticScroll.set(false);
      });
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getLogs({ limit: 500 }).subscribe({
      next: (entries) => {
        this.live.seedLogs(entries);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  setLevel(level: LevelFilter): void {
    this.levelFilter.set(level);
  }

  toggleFollow(): void {
    this.follow.update((v) => !v);
  }

  onScroll(el: HTMLElement): void {
    if (this.programmaticScroll()) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (!atBottom && this.follow()) {
      this.follow.set(false);
    }
  }

  clear(): void {
    const last = this.rawLogs().at(-1);
    this.clearedBeforeId.set(last?.id ?? 0);
  }

  copyLine(entry: LogEntry): void {
    const line = `${entry.at} ${entry.level.toUpperCase()} ${entry.source} ${entry.jobId ? '#' + entry.jobId + ' ' : ''}${entry.message}`;
    navigator.clipboard
      ?.writeText(line)
      .then(() => this.toasts.ok('Línea copiada.'))
      .catch(() => this.toasts.error('No se pudo copiar.'));
  }

  levelLabel(level: LogLevel): string {
    return LEVEL_LABEL[level] ?? level;
  }

  private formatTime(at: string): string {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) {
      return at;
    }
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
}
