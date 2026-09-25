import { ChangeDetectionStrategy, Component, forwardRef, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon, IconName } from '../icon/icon';

/**
 * Text input with an optional leading icon and a projected trailing slot
 * (a tag, an eye toggle, etc). Implements ControlValueAccessor for reactive forms.
 */
const noop = (): void => undefined;

@Component({
  selector: 'hf-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Input), multi: true }],
  template: `
    <label class="hf-field" [class.hf-field--disabled]="disabled">
      @if (icon(); as ic) {
        <hf-icon [name]="ic" [size]="14" class="hf-field__icon" />
      }
      <input
        class="hf-field__input"
        [type]="type()"
        [placeholder]="placeholder()"
        [value]="value ?? ''"
        [disabled]="disabled"
        [attr.aria-label]="ariaLabel() || null"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      <span class="hf-field__trailing">
        <ng-content></ng-content>
      </span>
    </label>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .hf-field {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      height: 36px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--text-3);
    }
    .hf-field:focus-within {
      border-color: var(--line-strong);
      box-shadow: var(--focus-ring);
    }
    .hf-field--disabled {
      opacity: 0.5;
    }
    .hf-field__icon {
      flex: none;
      color: var(--text-3);
    }
    .hf-field__input {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      outline: none;
      color: var(--text);
      font-family: var(--font-ui);
      font-size: var(--text-base);
    }
    .hf-field__input::placeholder {
      color: var(--text-3);
    }
    .hf-field__trailing:empty {
      display: none;
    }
  `,
})
export class Input implements ControlValueAccessor {
  readonly icon = input<IconName | null>(null);
  readonly placeholder = input('');
  readonly type = input<'text' | 'password' | 'number' | 'email'>('text');
  /** Accessible name for the native input when it isn't wrapped by a visible <label>. */
  readonly ariaLabel = input('');

  value: string | number | null = '';
  disabled = false;

  private onChange: (value: string | number) => void = noop;
  onTouched: () => void = noop;

  writeValue(value: string | number | null): void {
    this.value = value ?? '';
  }
  registerOnChange(fn: (value: string | number) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (this.type() === 'number') {
      const parsed = raw === '' ? null : Number(raw);
      this.value = parsed;
      this.onChange(parsed ?? NaN);
      return;
    }
    this.value = raw;
    this.onChange(raw);
  }
}
