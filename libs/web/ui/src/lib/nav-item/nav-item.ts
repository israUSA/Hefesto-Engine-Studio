import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Icon, IconName } from '../icon/icon';

/** Sidebar navigation row: icon + label + optional count, active state on route match. */
@Component({
  selector: 'hf-nav-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, Icon],
  template: `
    <a
      class="hf-nav-item"
      [routerLink]="link()"
      routerLinkActive="hf-nav-item--active"
      [routerLinkActiveOptions]="{ exact: exact() }"
    >
      <hf-icon [name]="icon()" [size]="16" />
      <span class="hf-nav-item__label">{{ label() }}</span>
      @if (count(); as c) {
        <span class="hf-nav-item__count">{{ c }}</span>
      }
    </a>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-nav-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      height: 36px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-md);
      color: var(--text-2);
      text-decoration: none;
      font-size: var(--text-base);
    }
    .hf-nav-item:hover {
      color: var(--text);
      background: var(--surface-2);
    }
    .hf-nav-item--active {
      color: var(--text);
      background: var(--surface-2);
    }
    .hf-nav-item__label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hf-nav-item__count {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-3);
    }
  `,
})
export class NavItem {
  readonly link = input.required<string>();
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly count = input<number | null>(null);
  readonly exact = input(false);
}
