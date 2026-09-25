import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Inline metric: a serif number next to a mono uppercase label.
 * Never render this inside a bordered "KPI box" — it sits directly on the panel.
 */
@Component({
  selector: 'hf-metric',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="hf-metric__value">{{ value() }}</span>
    <span class="hf-metric__label">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      gap: 2px;
    }
    .hf-metric__value {
      font-family: var(--font-serif);
      font-size: var(--text-2xl);
      line-height: 1;
      color: var(--text);
    }
    .hf-metric__label {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: var(--tracking-label);
      text-transform: uppercase;
      color: var(--text-3);
    }
  `,
})
export class Metric {
  readonly value = input.required<string | number>();
  readonly label = input.required<string>();
}
