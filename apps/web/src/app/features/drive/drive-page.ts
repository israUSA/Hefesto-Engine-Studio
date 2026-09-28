import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ArchivedKind, GoogleAccountStatus, JobDto, StorageChannelRow, StorageOverview } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Skeleton } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { LiveEvents } from '../../core/live-events';
import { ToastService } from '../../core/toast.service';
import { formatBytes, timeAgo } from './storage-format';
import { StorageSetup } from './storage-setup';

const KIND_LABEL: Record<ArchivedKind, string> = { render: 'Videos', voice: 'Audio', thumb: 'Portadas', script: 'Guiones' };
const KIND_ORDER: ArchivedKind[] = ['render', 'voice', 'thumb', 'script'];

interface ChannelVm extends StorageChannelRow {
  onDisk: number;
  inRemote: number;
  /** Bar segments in %: both, remote only, disk only, missing. */
  bar: [number, number, number, number];
}

/** Drive (docs/06): what's archived, where each video is, free space and bring files back. */
@Component({
  selector: 'hf-drive-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, Icon, RouterLink, Skeleton, StorageSetup],
  templateUrl: './drive-page.html',
  styleUrl: './drive-page.css',
})
export class DrivePage {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveEvents);
  private readonly toasts = inject(ToastService);

  readonly overview = signal<StorageOverview | null>(null);
  readonly google = signal<GoogleAccountStatus | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly syncing = signal(false);
  readonly freeing = signal(false);
  readonly uploading = signal(false);

  readonly provider = computed(() => this.overview()?.provider);
  readonly isDrive = computed(() => this.provider()?.adapter === 'google-drive');
  readonly remoteName = computed(() => (this.isDrive() ? 'Drive' : 'el archivo'));
  readonly remoteShort = computed(() => (this.isDrive() ? 'Drive' : 'archivo'));

  readonly channels = computed<ChannelVm[]>(() =>
    (this.overview()?.channels ?? []).map((c) => {
      const pct = (n: number) => (c.videos ? (n / c.videos) * 100 : 0);
      return {
        ...c,
        onDisk: c.both + c.diskOnly,
        inRemote: c.both + c.remoteOnly,
        bar: [pct(c.both), pct(c.remoteOnly), pct(c.diskOnly), pct(c.missing)],
      };
    }),
  );

  readonly totals = computed(() =>
    this.channels().reduce(
      (t, c) => ({
        videos: t.videos + c.videos,
        onDisk: t.onDisk + c.onDisk,
        inRemote: t.inRemote + c.inRemote,
        missing: t.missing + c.missing,
        diskOnly: t.diskOnly + c.diskOnly,
        freeable: t.freeable + c.freeableBytes,
      }),
      { videos: 0, onDisk: 0, inRemote: 0, missing: 0, diskOnly: 0, freeable: 0 },
    ),
  );

  readonly headline = computed(() => {
    const t = this.totals();
    if (!this.provider()) return 'sin configurar';
    if (t.videos === 0) return 'listo para archivar';
    if (t.diskOnly > 0) return `${t.diskOnly} sin subir`;
    return 'todo archivado';
  });

  readonly kinds = computed(() => {
    const o = this.overview();
    const total = o?.remote.bytes || 1;
    return KIND_ORDER.map((kind) => ({
      kind,
      label: KIND_LABEL[kind],
      bytes: o?.remote.byKind[kind].bytes ?? 0,
      pct: ((o?.remote.byKind[kind].bytes ?? 0) / total) * 100,
    }));
  });

  /** Archive jobs running or waiting in the queue, live. */
  readonly uploads = computed<JobDto[]>(() => {
    const q = this.live.queueState();
    if (!q) return [];
    const running = Object.values(q.lanes).flatMap((l) => l.running);
    const jobs = this.live.jobsById();
    return [...running, ...q.queued].filter((j) => j.type === 'archive').map((j) => ({ ...j, ...jobs[j.id] }));
  });

  /** "Hefesto Engine Studio/ › Canal/ › renders/2026-09/ › archivo.mp4" as tree lines. */
  readonly tree = computed(() => {
    const example = this.overview()?.example;
    if (!example) return [];
    const parts = example.split('/');
    const file = parts.pop() as string;
    const dirs = [parts[0], parts.slice(1).join('/')].filter(Boolean);
    return ['Hefesto Engine Studio/', ...dirs.map((d) => `${d}/`), file];
  });

  constructor() {
    this.load();
    // When an upload finishes, the numbers change: reload once the list of uploads shrinks.
    let previous = 0;
    effect(() => {
      const count = this.uploads().length;
      if (count < previous) this.refresh();
      previous = count;
    });
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getGoogleAccount().subscribe({ next: (g) => this.google.set(g), error: () => undefined });
    this.api.getStorage().subscribe({
      next: (o) => {
        this.overview.set(o);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  private refresh(): void {
    this.api.getStorage().subscribe({ next: (o) => this.overview.set(o), error: () => undefined });
  }

  sync(): void {
    this.syncing.set(true);
    this.api.syncStorage().subscribe({
      next: (o) => {
        this.overview.set(o);
        this.syncing.set(false);
        const missing = o.channels.reduce((n, c) => n + c.missing, 0);
        this.toasts.show(missing ? `Sincronizado: faltan ${missing} video(s) en ${this.remoteName()}` : 'Sincronizado: todo en su lugar', {
          tone: missing ? 'danger' : 'ok',
        });
      },
      error: (err) => {
        this.syncing.set(false);
        this.toasts.error(err?.error?.message ?? 'No se pudo sincronizar');
      },
    });
  }

  free(): void {
    this.freeing.set(true);
    this.api.freeSpace().subscribe({
      next: (r) => {
        this.freeing.set(false);
        this.toasts.ok(r.productions ? `Liberados ${formatBytes(r.freedBytes)} de ${r.productions} video(s)` : 'No había nada verificado para liberar');
        this.refresh();
      },
      error: (err) => {
        this.freeing.set(false);
        this.toasts.error(err?.error?.message ?? 'No se pudo liberar espacio');
      },
    });
  }

  uploadPending(): void {
    this.uploading.set(true);
    this.api.uploadToStorage().subscribe({
      next: (r) => {
        this.uploading.set(false);
        this.toasts.ok(r.queued ? `${r.queued} video(s) en la cola para subir` : 'No hay videos pendientes de subir');
      },
      error: (err) => {
        this.uploading.set(false);
        this.toasts.error(err?.error?.message ?? 'No se pudo encolar la subida');
      },
    });
  }

  onConfigured(o: StorageOverview): void {
    this.overview.set(o);
  }

  bytes(n: number): string {
    return formatBytes(n);
  }

  ago(iso?: string): string {
    return timeAgo(iso);
  }

  pct(job: JobDto): string {
    return `${Math.round(job.progress * 100)}%`;
  }

  uploadName(job: JobDto): string {
    return job.title ?? 'Video';
  }
}
