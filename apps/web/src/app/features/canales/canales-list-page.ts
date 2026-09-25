import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import type { ChannelSummary } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, IconName, Skeleton, Tag } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { ChannelFormDialog } from './channel-form-dialog';

/** Canales: grid of channel cards with their monthly numbers, and the entry point to create one. */
@Component({
  selector: 'hf-canales-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, Icon, Skeleton, Tag, EmptyState, ChannelFormDialog],
  templateUrl: './canales-list-page.html',
  styleUrl: './canales-list-page.css',
})
export class CanalesListPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly channels = signal<ChannelSummary[]>([]);
  readonly dialogOpen = signal(false);

  constructor() {
    this.load();
    const q = this.route.snapshot.queryParamMap;
    if (q.get('new') || q.get('nuevo')) {
      this.dialogOpen.set(true);
    }
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.listChannels().subscribe({
      next: (channels) => {
        this.channels.set(channels);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo conectar con el motor.');
      },
    });
  }

  platformIcon(platform: ChannelSummary['channel']['platform']): IconName {
    return platform === 'tiktok' ? 'tiktok' : 'youtube';
  }

  onCreated(slug: string): void {
    this.load();
    this.router.navigate(['/canales', slug]);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
    const q = this.route.snapshot.queryParamMap;
    if (q.get('new') || q.get('nuevo')) {
      this.router.navigate([], { queryParams: {} });
    }
  }
}
