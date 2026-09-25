import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Board, BoardCard, ChannelSummary } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Select, SelectOption, Skeleton, Tag } from '@hefesto/web-ui';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { ToastService } from '../../core/toast.service';
import { GenerateIdeasDialog } from './generate-ideas-dialog';
import { ScriptDrawer } from './script-drawer';

type OptimisticStatus = 'accepted' | 'rejected';

/**
 * Ideas y guiones: the kanban from idea to published. See docs/09-diseno-ui.md.
 * Drag and drop is intentionally omitted — the only allowed transitions
 * (idea → script via "Escribir guion", script → approved/rejected) are buttons.
 */
@Component({
  selector: 'hf-ideas-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Button, EmptyState, Icon, Select, Skeleton, Tag, GenerateIdeasDialog, ScriptDrawer],
  templateUrl: './ideas-page.html',
  styleUrl: './ideas-page.css',
})
export class IdeasPage {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly board = signal<Board | null>(null);
  readonly channels = signal<ChannelSummary[]>([]);
  /** Fresh install: no channels yet. Hefesto ships empty — sample channels are demo-only. */
  readonly hasNoChannels = computed(() => this.channels().length === 0);
  readonly channelFilter = signal<string>('');

  readonly generateOpen = signal(false);
  readonly openScriptId = signal<string | null>(null);
  readonly busyIds = signal<Set<string>>(new Set());
  readonly ideaOverrides = signal<Record<string, OptimisticStatus>>({});

  readonly channelOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'Todos los canales' },
    ...this.channels().map((c) => ({ value: c.channel.id, label: c.channel.name })),
  ]);

  private readonly channelNames = computed<Record<string, string>>(() =>
    Object.fromEntries(this.channels().map((c) => [c.channel.id, c.channel.name])),
  );

  constructor() {
    if (this.route.snapshot.queryParamMap.get('generate')) {
      this.generateOpen.set(true);
    }
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      channels: this.api.listChannels(),
      board: this.api.getBoard(this.channelFilter() || undefined),
    }).subscribe({
      next: ({ channels, board }) => {
        this.channels.set(channels);
        this.board.set(board);
        this.ideaOverrides.set({});
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  onFilterChange(): void {
    this.load();
  }

  channelName(id: string): string {
    return this.channelNames()[id] ?? id;
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  overrideOf(id: string): OptimisticStatus | undefined {
    return this.ideaOverrides()[id];
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update((set) => {
      const next = new Set(set);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  acceptIdea(card: BoardCard): void {
    this.setBusy(card.id, true);
    this.api.updateIdeaStatus(card.id, 'accepted').subscribe({
      next: () => {
        this.setBusy(card.id, false);
        this.ideaOverrides.update((o) => ({ ...o, [card.id]: 'accepted' }));
        this.toasts.ok('Idea aceptada.');
      },
      error: () => {
        this.setBusy(card.id, false);
        this.toasts.error('No se pudo aceptar la idea.');
      },
    });
  }

  rejectIdea(card: BoardCard): void {
    this.setBusy(card.id, true);
    this.api.updateIdeaStatus(card.id, 'rejected').subscribe({
      next: () => {
        this.toasts.ok('Idea rechazada.');
        this.load();
      },
      error: () => {
        this.setBusy(card.id, false);
        this.toasts.error('No se pudo rechazar la idea.');
      },
    });
  }

  writeScript(card: BoardCard): void {
    this.setBusy(card.id, true);
    this.api.generateScript({ channelId: card.channelId, ideaId: card.id }).subscribe({
      next: () => {
        this.toasts.ok('Guion generado.');
        this.load();
      },
      error: () => {
        this.setBusy(card.id, false);
        this.toasts.error('No se pudo generar el guion.');
      },
    });
  }

  openScript(card: BoardCard): void {
    this.openScriptId.set(card.id);
  }

  closeScript(): void {
    this.openScriptId.set(null);
  }

  onScriptUpdated(): void {
    this.load();
  }

  onIdeasGenerated(): void {
    this.load();
  }

  closeGenerateDialog(): void {
    this.generateOpen.set(false);
    if (this.route.snapshot.queryParamMap.get('generate')) {
      this.router.navigate([], { queryParams: {} });
    }
  }
}
