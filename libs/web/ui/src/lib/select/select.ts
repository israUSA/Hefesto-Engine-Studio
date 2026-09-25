import { ChangeDetectionStrategy, Component, forwardRef, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from '../icon/icon';

export interface SelectOption {
  value: string;
  label: string;
}

/** Styled native <select>, with ControlValueAccessor for reactive forms. */
const noop = (): void => undefined;

@Component({
  selector: 'hf-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Select), multi: true }],
  template: `
    <div class="hf-select" [class.hf-select--disabled]="disabled">
      <select
        class="hf-select__native"
        [disabled]="disabled"
        [value]="value ?? ''"
        [attr.aria-label]="ariaLabel() || null"
        (change)="onSelect($event)"
        (blur)="onTouched()"
      >
        @for (opt of options(); track opt.value) {
          <option [value]="opt.value">{{ opt.label }}</option>
        }
      </select>
      <hf-icon name="chevron-down" [size]="14" class="hf-select__chevron" />
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .hf-select {
      position: relative;
      display: flex;
      align-items: center;
    }
    .hf-select--disabled {
      opacity: 0.5;
    }
    .hf-select__native {
      width: 100%;
      height: 36px;
      padding: 0 var(--space-8) 0 var(--space-3);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--text);
      font-family: var(--font-ui);
      font-size: var(--text-base);
      appearance: none;
    }
    .hf-select__native:focus-visible {
      outline: none;
      border-color: var(--line-strong);
      box-shadow: var(--focus-ring);
    }
    .hf-select__chevron {
      position: absolute;
      right: var(--space-3);
      color: var(--text-3);
      pointer-events: none;
    }
  `,
})
export class Select implements ControlValueAccessor {
  readonly options = input.required<SelectOption[]>();
  /** Accessible name for the native select when it isn't wrapped by a visible <label>. */
  readonly ariaLabel = input('');

  value: string | null = '';
  disabled = false;

  private onChange: (value: string) => void = noop;
  onTouched: () => void = noop;

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.value = value;
    this.onChange(value);
  }
}
