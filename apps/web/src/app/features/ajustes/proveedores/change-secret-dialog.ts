import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Button, Dialog, Input } from '@hefesto/web-ui';
import { FormsModule } from '@angular/forms';
import { ApiClient } from '../../../core/api-client';
import { ToastService } from '../../../core/toast.service';

/** Small dialog to overwrite a secret. The value is write-only: never shown back. */
@Component({
  selector: 'hf-change-secret-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, Input, Button, FormsModule],
  template: `
    <hf-dialog [open]="open()" [title]="'Cambiar clave · ' + secretName()" (closed)="closed.emit()">
      <p class="hf-hint">
        Se guarda cifrada y solo se usa en el motor. Nunca se vuelve a mostrar en pantalla.
      </p>
      <hf-input type="password" placeholder="Nueva clave" [(ngModel)]="value" icon="key" />
      @if (error()) {
        <p class="hf-error">{{ error() }}</p>
      }
      <div footer>
        <hf-button variant="secondary" (pressed)="closed.emit()">Cancelar</hf-button>
        <hf-button variant="primary" [loading]="saving()" [disabled]="!value.trim()" (pressed)="save()">
          Guardar clave
        </hf-button>
      </div>
    </hf-dialog>
  `,
  styles: `
    .hf-hint {
      font-size: var(--text-sm);
      color: var(--text-3);
      margin: 0;
    }
    .hf-error {
      font-size: var(--text-sm);
      color: var(--danger);
      margin: 0;
    }
  `,
})
export class ChangeSecretDialog {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly open = input(false);
  readonly secretName = input.required<string>();
  readonly closed = output<void>();
  readonly saved = output<void>();

  value = '';
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  save(): void {
    const value = this.value.trim();
    if (!value) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.setSecret(this.secretName(), value).subscribe({
      next: () => {
        this.saving.set(false);
        this.value = '';
        this.toasts.ok('Clave actualizada.');
        this.saved.emit();
        this.closed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No se pudo guardar la clave.');
      },
    });
  }
}
