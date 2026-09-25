import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChannelSummary, Platform } from '@hefesto/shared-types';
import { Icon, IconName, Meter, NavItem, SectionLabel } from '@hefesto/web-ui';
import { ApiClient } from '../core/api-client';
import { LiveEvents } from '../core/live-events';
import { ThemeService } from '../core/theme.service';

const REFRESH_MS = 20000;
const AVATAR_PALETTE = ['accent', 'ok', 'steel', 'warn', 'danger'] as const;

function avatarTone(seed: string): (typeof AVATAR_PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function platformIcon(platform: Platform): IconName {
  return platform === 'tiktok' ? 'tiktok' : 'youtube';
}

/** Left sidebar: logo, primary nav, per-channel list and live telemetry. */
const ENCODER_LABELS: Record<string, string> = {
  h264_nvenc: 'NVENC',
  h264_qsv: 'QSV (Intel)',
  h264_amf: 'AMF (AMD)',
  libx264: 'CPU (x264)',
};

@Component({
  selector: 'hf-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NavItem, SectionLabel, Icon, Meter],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly api = inject(ApiClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly live = inject(LiveEvents);
  readonly themeService = inject(ThemeService);

  readonly channels = signal<ChannelSummary[]>([]);
  readonly ideasCount = signal<number | null>(null);
  /** Encoder label for the status line, e.g. "QSV (Intel)". null = unknown. */
  readonly encoderLabel = signal<string | null>(null);

  readonly queueCount = computed(() => this.live.queueState()?.queued.length ?? 0);

  readonly telemetryView = computed(() => {
    const t = this.live.telemetry();
    if (!t) {
      return null;
    }
    return {
      gpu: t.gpu ? { pct: t.gpu.utilPct, display: `${Math.round(t.gpu.utilPct)}%${t.gpu.tempC ? ' · ' + Math.round(t.gpu.tempC) + '°' : ''}` } : null,
      cpu: { pct: t.cpu.pct, display: `${Math.round(t.cpu.pct)}% · ${t.cpu.threads} hilos` },
      vram: t.gpu
        ? {
            pct: (t.gpu.vramUsedMb / t.gpu.vramTotalMb) * 100,
            display: `${(t.gpu.vramUsedMb / 1024).toFixed(1)} / ${(t.gpu.vramTotalMb / 1024).toFixed(1)} GB`,
          }
        : null,
      disk: {
        pct: 100 - (t.disk.freeGb / t.disk.totalGb) * 100,
        display: `${Math.round(t.disk.freeGb)} GB libres`,
      },
    };
  });

  constructor() {
    this.refresh();
    const timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  avatarLetter(name: string): string {
    return (name.trim()[0] ?? '?').toUpperCase();
  }

  avatarTone(id: string): string {
    return avatarTone(id);
  }

  platformIcon(platform: Platform): IconName {
    return platformIcon(platform);
  }

  private refresh(): void {
    this.api.listChannels().subscribe({
      next: (channels) => this.channels.set(channels),
      error: () => void 0,
    });
    this.api.getBoard().subscribe({
      next: (board) => {
        const pending = board.columns
          .filter((c) => c.id === 'idea' || c.id === 'script')
          .reduce((sum, c) => sum + c.cards.length, 0);
        this.ideasCount.set(pending);
      },
      error: () => this.ideasCount.set(null),
    });
    this.api.getSystemInfo().subscribe({
      next: (info) => this.encoderLabel.set(ENCODER_LABELS[info.encoder.name] ?? info.encoder.name),
      error: () => this.encoderLabel.set(null),
    });
  }
}
