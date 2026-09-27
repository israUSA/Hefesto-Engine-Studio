import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChannelSummary, ProductionSummary } from '@hefesto/shared-types';
import { Icon, IconName, Thumb9x16 } from '@hefesto/web-ui';

export interface ChannelRow {
  summary: ChannelSummary;
  recent: ProductionSummary[];
  platformIcon: IconName;
}

/** One channel line on Hoy: avatar, month stats and the latest thumbnails. Links to the channel. */
@Component({
  selector: 'hf-hoy-channel-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Thumb9x16],
  template: `
    <a class="hf-row" [routerLink]="['/canales', row().summary.channel.slug]">
      <span class="hf-row__avatar">{{ row().summary.channel.name[0] }}</span>
      <div class="hf-row__about">
        <span class="hf-row__name">
          {{ row().summary.channel.name }}
          <hf-icon [name]="row().platformIcon" [size]="12" />
        </span>
        <span class="hf-row__stats">
          {{ row().summary.videosThisMonth }} este mes · {{ row().summary.inQueue }} en cola · {{ '$' + row().summary.costThisMonthUsd.toFixed(2) }}
        </span>
      </div>
      <div class="hf-row__thumbs">
        @for (p of row().recent; track p.id) {
          <hf-thumb-9x16 [imageUrl]="p.thumbUrl ?? null" [aiMark]="false" class="hf-row__thumb" />
        } @empty {
          <span class="hf-row__empty">Sin videos aún</span>
        }
      </div>
    </a>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--surface-2);
      text-decoration: none;
      color: var(--text);
    }
    .hf-row:hover {
      border-color: var(--line-strong);
    }
    .hf-row__avatar {
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md);
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .hf-row__about {
      display: flex;
      flex-direction: column;
      min-width: 140px;
      gap: 2px;
    }
    .hf-row__name {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 500;
    }
    .hf-row__stats {
      color: var(--text-3);
      font-size: var(--text-sm);
      font-family: var(--font-mono);
    }
    .hf-row__thumbs {
      display: flex;
      gap: var(--space-2);
      margin-left: auto;
      overflow: hidden;
    }
    .hf-row__thumb {
      width: 40px;
      flex: none;
    }
    .hf-row__empty {
      color: var(--text-3);
      font-size: var(--text-sm);
    }
  `,
})
export class HoyChannelRow {
  readonly row = input.required<ChannelRow>();
}
