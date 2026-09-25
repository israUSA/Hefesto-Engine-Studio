import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { Channel } from '@hefesto/shared-types';
import { ApiClient } from '../../../core/api-client';

/**
 * Per-route store for the channel detail screen. Provided on CanalDetallePage
 * so every tab (Videos, Identidad, …) shares the same loaded Channel.
 */
@Injectable()
export class ChannelDetailStore {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly channel = signal<Channel | null>(null);

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      this.load(slug);
    }
  }

  load(slug: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getChannel(slug).subscribe({
      next: (channel) => {
        this.channel.set(channel);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo cargar el canal.');
      },
    });
  }

  refresh(): void {
    const current = this.channel();
    if (current) {
      this.load(current.slug);
    }
  }
}
