import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Icon } from '../icon/icon';
import { ToastService } from './toast.service';

/** Renders the active toast queue, bottom-center over the main panel. */
@Component({
  selector: 'hf-toast-outlet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="hf-toast-outlet" role="status" aria-live="polite">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="hf-toast" [class]="'hf-toast--' + toast.tone">
          @if (toast.tone === 'ok') {
            <hf-icon name="check" [size]="14" />
          } @else if (toast.tone === 'danger') {
            <hf-icon name="alert-circle" [size]="14" />
          }
          <span class="hf-toast__message">{{ toast.message }}</span>
          @if (toast.actionLabel) {
            <button
              class="hf-toast__action"
              type="button"
              (click)="runAction(toast)"
            >
              {{ toast.actionLabel }}
            </button>
          }
          <button class="hf-toast__close" type="button" (click)="toasts.dismiss(toast.id)" aria-label="Cerrar">
            <hf-icon name="close" [size]="12" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .hf-toast-outlet {
      position: absolute;
      left: 50%;
      bottom: var(--space-6);
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      z-index: 40;
      align-items: center;
    }
    .hf-toast {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--surface-3);
      border: 1px solid var(--line);
      color: var(--text);
      font-size: var(--text-base);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
    }
    .hf-toast--ok {
      color: var(--ok);
    }
    .hf-toast--danger {
      color: var(--danger);
    }
    .hf-toast__message {
      color: var(--text);
    }
    .hf-toast__action {
      background: none;
      border: none;
      color: var(--accent);
      font-weight: 500;
      padding: 0;
      cursor: pointer;
    }
    .hf-toast__close {
      background: none;
      border: none;
      color: var(--text-3);
      padding: 0;
      display: flex;
      cursor: pointer;
    }
  `,
})
export class ToastOutlet {
  readonly toasts = inject(ToastService);

  runAction(toast: { id: number; action?: () => void }): void {
    toast.action?.();
    this.toasts.dismiss(toast.id);
  }
}
