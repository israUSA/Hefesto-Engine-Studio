import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, IconName } from '../icon/icon';

/** Centered empty/placeholder state: icon, title, optional detail and projected action. */
@Component({
  selector: 'hf-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="hf-empty">
      <hf-icon [name]="icon()" [size]="28" class="hf-empty__icon" />
      <p class="hf-empty__title">{{ title() }}</p>
      @if (detail()) {
        <p class="hf-empty__detail">{{ detail() }}</p>
      }
      <div class="hf-empty__action">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: var(--space-2);
      padding: var(--space-12) var(--space-6);
      color: var(--text-3);
    }
    .hf-empty__icon {
      color: var(--text-3);
      margin-bottom: var(--space-2);
    }
    .hf-empty__title {
      font-size: var(--text-lg);
      color: var(--text-2);
    }
    .hf-empty__detail {
      font-size: var(--text-base);
      color: var(--text-3);
      max-width: 40ch;
    }
    .hf-empty__action:empty {
      display: none;
    }
    .hf-empty__action {
      margin-top: var(--space-3);
    }
  `,
})
export class EmptyState {
  readonly icon = input<IconName>('sparkles');
  readonly title = input.required<string>();
  readonly detail = input<string>('');
}
