import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Icon, ToastOutlet } from '@hefesto/web-ui';
import { LiveEvents } from '../core/live-events';
import { ForgeStrip } from './forge-strip';
import { Sidebar } from './sidebar';

/** App shell: sidebar + forge strip + the single rounded main panel. */
@Component({
  selector: 'hf-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, ForgeStrip, ToastOutlet, Icon],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  readonly live = inject(LiveEvents);
}
