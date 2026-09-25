import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * Small modal dialog: one panel, no card-in-card. Used for focused flows like
 * "Cambiar clave" or "Agregar proveedor". Content and footer are projected.
 */
@Component({
  selector: 'hf-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (open()) {
      <div
        class="hf-dialog-backdrop"
        tabindex="-1"
        (click)="$event.target === $event.currentTarget && requestClose()"
        (keydown.escape)="requestClose()"
      >
        <div class="hf-dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()">
          <header class="hf-dialog__header">
            <h2 class="hf-dialog__title">{{ title() }}</h2>
            <button class="hf-dialog__close" type="button" (click)="requestClose()" aria-label="Cerrar">
              <hf-icon name="close" [size]="14" />
            </button>
          </header>
          <div class="hf-dialog__body">
            <ng-content></ng-content>
          </div>
          <footer class="hf-dialog__footer">
            <ng-content select="[footer]"></ng-content>
          </footer>
        </div>
      </div>
    }
  `,
  styles: `
    .hf-dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .hf-dialog {
      width: min(420px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      display: flex;
      flex-direction: column;
    }
    .hf-dialog__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--line);
    }
    .hf-dialog__title {
      font-size: var(--text-lg);
      font-weight: 500;
      color: var(--text);
    }
    .hf-dialog__close {
      background: none;
      border: none;
      color: var(--text-3);
      cursor: pointer;
      display: flex;
    }
    .hf-dialog__close:hover {
      color: var(--text);
    }
    .hf-dialog__body {
      padding: var(--space-5);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .hf-dialog__footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
      padding: var(--space-4) var(--space-5);
      border-top: 1px solid var(--line);
    }
    .hf-dialog__footer:empty {
      display: none;
    }
  `,
})
export class Dialog {
  readonly open = input(false);
  readonly title = input('');
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) {
      this.requestClose();
    }
  }

  requestClose(): void {
    this.closed.emit();
  }
}
