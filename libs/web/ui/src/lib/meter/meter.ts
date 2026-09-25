import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Sidebar telemetry row: mono label, track, mono value (e.g. "GPU 38% · 61°"). */
@Component({
  selector: 'hf-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hf-meter">
      <div class="hf-meter__row">
        <span class="hf-meter__label">{{ label() }}</span>
        <span class="hf-meter__value">{{ display() }}</span>
      </div>
      @if (!unavailable()) {
        <div class="hf-meter__track">
          <div class="hf-meter__fill" [style.width.%]="pct()"></div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-meter__row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: var(--tracking-label);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .hf-meter__label {
      color: var(--text-3);
    }
    .hf-meter__value {
      color: var(--text-2);
    }
    .hf-meter__track {
      height: 3px;
      border-radius: var(--radius-pill);
      background: var(--surface-3);
      overflow: hidden;
    }
    .hf-meter__fill {
      height: 100%;
      background: var(--text-2);
      border-radius: var(--radius-pill);
      transition: width 0.4s ease;
    }
  `,
})
export class Meter {
  readonly label = input.required<string>();
  /** Formatted value text, e.g. "38% · 61°" or "212 GB libres". */
  readonly display = input.required<string>();
  readonly value = input(0);
  readonly max = input(100);
  /** True when there's no sensor (e.g. no NVIDIA GPU): hides the track. */
  readonly unavailable = input(false);
  readonly pct = computed(() => Math.max(0, Math.min(100, (this.value() / (this.max() || 1)) * 100)));
}
