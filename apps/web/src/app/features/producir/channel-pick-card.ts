import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ChannelSummary } from '@hefesto/shared-types';
import { Icon } from '@hefesto/web-ui';

export const AVATAR_TONES = ['accent', 'ok', 'warn', 'steel'] as const;

export interface ChannelVm {
  summary: ChannelSummary;
  initial: string;
  tone: (typeof AVATAR_TONES)[number];
  approvedCount: number;
}

/** Selectable channel card of Producir (a checkbox button); the page owns the selection. */
@Component({
  selector: 'hf-channel-pick-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button
      type="button"
      class="hf-card"
      role="checkbox"
      [class.hf-card--selected]="selected()"
      [attr.aria-checked]="selected()"
      (click)="toggled.emit()"
    >
      <div class="hf-card__head">
        <span class="hf-card__avatar" [class]="'hf-card__avatar--' + vm().tone">{{ vm().initial }}</span>
        <span class="hf-card__check" [class.hf-card__check--on]="selected()">
          @if (selected()) {
            <hf-icon name="check" [size]="12" />
          }
        </span>
      </div>
      <div class="hf-card__name">{{ vm().summary.channel.name }}</div>
      <div class="hf-card__topic">{{ vm().summary.channel.topic }}</div>
      <div class="hf-card__meta">{{ vm().approvedCount }} aprobados</div>
    </button>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-card {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      text-align: left;
      padding: var(--space-3);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--text);
      cursor: pointer;
      font-family: var(--font-ui);
    }
    .hf-card:hover {
      border-color: var(--line-strong);
    }
    .hf-card--selected {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .hf-card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .hf-card__avatar {
      width: 26px;
      height: 26px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: var(--text-sm);
    }
    .hf-card__avatar--accent {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .hf-card__avatar--ok {
      background: var(--ok-soft);
      color: var(--ok);
    }
    .hf-card__avatar--warn {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .hf-card__avatar--steel {
      background: var(--steel-soft);
      color: var(--steel);
    }
    .hf-card__check {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid var(--line-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      flex: none;
    }
    .hf-card__check--on {
      background: var(--accent);
      border-color: var(--accent);
    }
    .hf-card__name {
      font-weight: 500;
      margin-top: var(--space-1);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hf-card__topic {
      color: var(--text-3);
      font-size: var(--text-sm);
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .hf-card__meta {
      color: var(--text-3);
      font-size: var(--text-xs);
      margin-top: auto;
      padding-top: var(--space-2);
    }
  `,
})
export class ChannelPickCard {
  readonly vm = input.required<ChannelVm>();
  readonly selected = input(false);
  readonly toggled = output<void>();
}
