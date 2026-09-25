import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Thin horizontal progress bar, e.g. the forge strip's render progress. */
@Component({
  selector: 'hf-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="hf-progress"
      [class]="'hf-progress--' + tone()"
      role="progressbar"
      [attr.aria-valuenow]="pct()"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="hf-progress__fill" [style.width.%]="pct()"></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .hf-progress {
      position: relative;
      width: 100%;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--surface-3);
      overflow: hidden;
    }
    .hf-progress__fill {
      height: 100%;
      border-radius: var(--radius-pill);
      background: var(--accent);
      transition: width 0.25s ease;
    }
    .hf-progress--ok .hf-progress__fill {
      background: var(--ok);
    }
    .hf-progress--danger .hf-progress__fill {
      background: var(--danger);
    }
  `,
})
export class ProgressBar {
  readonly value = input(0);
  readonly max = input(100);
  readonly tone = input<'accent' | 'ok' | 'danger'>('accent');
  readonly pct = computed(() => Math.max(0, Math.min(100, (this.value() / (this.max() || 1)) * 100)));
}
