import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Button, EmptyState, Icon, IconName, Skeleton, StatusChip } from '@hefesto/web-ui';
import { ChannelDetailStore } from './channel-detail.store';

interface DetailTab {
  path: string;
  label: string;
}

const TABS: DetailTab[] = [
  { path: 'videos', label: 'Videos' },
  { path: 'guiones', label: 'Guiones' },
  { path: 'identidad', label: 'Identidad' },
  { path: 'calendario', label: 'Calendario' },
  { path: 'metricas', label: 'Métricas' },
];

/** Channel header (avatar, platform, status, quick actions) + tab nav + the active tab. */
@Component({
  selector: 'hf-canal-detalle-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Button, Icon, Skeleton, StatusChip, EmptyState],
  providers: [ChannelDetailStore],
  templateUrl: './canal-detalle-page.html',
  styleUrl: './canal-detalle-page.css',
})
export class CanalDetallePage {
  readonly store = inject(ChannelDetailStore);
  readonly tabs = TABS;

  platformIcon(platform: string): IconName {
    return platform === 'tiktok' ? 'tiktok' : 'youtube';
  }
}
