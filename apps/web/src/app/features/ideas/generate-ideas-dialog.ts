import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChannelSummary } from '@hefesto/shared-types';
import { Button, Dialog, Input, Select, SelectOption } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { ToastService } from '../../core/toast.service';

/** "Generar ideas" dialog: channel, count and an optional hint → POST /api/ideas/generate. */
@Component({
  selector: 'hf-generate-ideas-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, Input, Select, Button, FormsModule],
  template: `
    <hf-dialog [open]="open()" title="Generar ideas" (closed)="close()">
      <span class="hf-label">Canal</span>
      <hf-select [options]="channelOptions()" [(ngModel)]="channelId" ariaLabel="Canal" />

      <span class="hf-label">Cantidad</span>
      <hf-input type="number" [(ngModel)]="count" ariaLabel="Cantidad de ideas" />

      <span class="hf-label">Pista (opcional)</span>
      <hf-input placeholder="Ej. enfocado en ansiedad y descanso" [(ngModel)]="hint" ariaLabel="Pista para la IA" />

      @if (error()) {
        <p class="hf-error">{{ error() }}</p>
      }

      <div footer>
        <hf-button variant="secondary" (pressed)="close()">Cancelar</hf-button>
        <hf-button variant="primary" [loading]="saving()" [disabled]="!channelId || count < 1" (pressed)="generate()">
          Generar
        </hf-button>
      </div>
    </hf-dialog>
  `,
  styles: `
    .hf-label {
      font-size: var(--text-sm);
      color: var(--text-3);
      margin-top: var(--space-1);
    }
    .hf-error {
      font-size: var(--text-sm);
      color: var(--danger);
      margin: 0;
    }
  `,
})
export class GenerateIdeasDialog {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly open = input(false);
  readonly channels = input<ChannelSummary[]>([]);
  readonly closed = output<void>();
  readonly created = output<void>();

  channelId = '';
  count = 3;
  hint = '';

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly channelOptions = () => this.channels().map((c) => ({ value: c.channel.id, label: c.channel.name }) satisfies SelectOption);

  close(): void {
    this.closed.emit();
  }

  generate(): void {
    if (!this.channelId || this.count < 1) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.generateIdeas({ channelId: this.channelId, count: this.count, hint: this.hint.trim() || undefined }).subscribe({
      next: (ideas) => {
        this.saving.set(false);
        this.toasts.ok(`${ideas.length} idea${ideas.length === 1 ? '' : 's'} generada${ideas.length === 1 ? '' : 's'}.`);
        this.hint = '';
        this.created.emit();
        this.closed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No se pudieron generar las ideas.');
      },
    });
  }
}
