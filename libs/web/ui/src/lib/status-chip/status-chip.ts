import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'steel' | 'accent' | 'neutral';

/** Small dot + label chip, e.g. "QA OK", "Revisar", "Forjando". */
@Component({
  selector: 'hf-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="hf-chip" [class]="'hf-chip--' + tone()">
      <span class="hf-chip__dot" [class.hf-chip__dot--pulse]="pulse()"></span>
      <ng-content></ng-content>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .hf-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      height: 22px;
      padding: 0 var(--space-2);
      border-radius: var(--radius-pill);
      font-size: var(--text-sm);
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
    }
    .hf-chip__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      flex: none;
    }
    .hf-chip__dot--pulse {
      animation: hf-chip-pulse 1.6s ease-in-out infinite;
    }
    @keyframes hf-chip-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }
    .hf-chip--ok {
      background: var(--ok-soft);
      color: var(--ok);
    }
    .hf-chip--warn {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .hf-chip--danger {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .hf-chip--steel {
      background: var(--steel-soft);
      color: var(--steel);
    }
    .hf-chip--accent {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .hf-chip--neutral {
      background: var(--surface-3);
      color: var(--text-2);
    }
  `,
})
export class StatusChip {
  readonly tone = input<StatusTone>('neutral');
  readonly pulse = input(false);
}
