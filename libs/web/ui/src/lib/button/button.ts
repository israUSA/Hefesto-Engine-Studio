import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';

/**
 * Button in three faces: primary (accent fill, one per view), secondary (bordered)
 * and icon (square, icon-only). Content is projected so callers can mix an <hf-icon>
 * with a label.
 */
@Component({
  selector: 'hf-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="'hf-btn hf-btn--' + variant()"
      [type]="type()"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() || null"
      (click)="pressed.emit($event)"
    >
      @if (loading()) {
        <span class="hf-btn__spinner" aria-hidden="true"></span>
      }
      <ng-content></ng-content>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .hf-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      height: 36px;
      padding: 0 var(--space-4);
      border-radius: var(--radius-md);
      border: 1px solid transparent;
      font-family: var(--font-ui);
      font-size: var(--text-base);
      font-weight: 500;
      white-space: nowrap;
      transition:
        background-color 0.12s ease,
        border-color 0.12s ease,
        opacity 0.12s ease;
    }

    .hf-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .hf-btn--primary {
      background: var(--accent);
      color: #fff;
    }
    .hf-btn--primary:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent) 88%, black);
    }

    .hf-btn--secondary {
      background: var(--surface-2);
      color: var(--text);
      border-color: var(--line);
    }
    .hf-btn--secondary:hover:not(:disabled) {
      border-color: var(--line-strong);
    }

    .hf-btn--ghost {
      background: transparent;
      color: var(--text-2);
    }
    .hf-btn--ghost:hover:not(:disabled) {
      color: var(--text);
      background: var(--surface-2);
    }

    .hf-btn--danger {
      background: transparent;
      color: var(--danger);
      border-color: var(--line);
    }
    .hf-btn--danger:hover:not(:disabled) {
      background: var(--danger-soft);
      border-color: var(--danger);
    }

    .hf-btn--icon {
      width: 36px;
      height: 36px;
      padding: 0;
      background: var(--surface-2);
      color: var(--text-2);
      border-color: var(--line);
    }
    .hf-btn--icon:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--line-strong);
    }

    .hf-btn__spinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid currentColor;
      border-top-color: transparent;
      opacity: 0.7;
      animation: hf-btn-spin 0.7s linear infinite;
    }

    @keyframes hf-btn-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly pressed = output<MouseEvent>();
}
