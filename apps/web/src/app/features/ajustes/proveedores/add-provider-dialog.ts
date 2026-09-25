import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Capability } from '@hefesto/shared-types';
import { Button, Dialog, Input, Select, SelectOption } from '@hefesto/web-ui';
import { ApiClient } from '../../../core/api-client';
import { ToastService } from '../../../core/toast.service';

const ADAPTERS: SelectOption[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'pexels', label: 'Pexels' },
  { value: 'fake', label: 'Fake (pruebas)' },
];

const CAPABILITIES: { value: Capability; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'tts', label: 'Voz' },
  { value: 'transcribe', label: 'Transcripción' },
  { value: 'image', label: 'Imágenes IA' },
  { value: 'video', label: 'Video IA' },
  { value: 'stock', label: 'Stock' },
  { value: 'music', label: 'Música' },
  { value: 'storage', label: 'Almacenamiento' },
  { value: 'publish', label: 'Publicación' },
  { value: 'notify', label: 'Avisos' },
  { value: 'embedding', label: 'Embeddings' },
];

/**
 * Minimal "add provider" dialog: adapter, name, capability, base URL, model and
 * secret env-var name. There's no adapter-discovery endpoint yet, so the adapter
 * list here is the known set from CLAUDE.md (gemini, openai-compatible, pexels, fake).
 */
@Component({
  selector: 'hf-add-provider-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, Input, Select, Button, FormsModule],
  template: `
    <hf-dialog [open]="open()" title="Agregar proveedor" (closed)="closed.emit()">
      <span class="hf-label">Adaptador</span>
      <hf-select [options]="adapters" [(ngModel)]="adapter" />

      <span class="hf-label">Nombre</span>
      <hf-input placeholder="Ej. Gemini Flash" [(ngModel)]="name" />

      <span class="hf-label">Capacidad</span>
      <hf-select [options]="capabilities" [(ngModel)]="capability" />

      <span class="hf-label">URL base (opcional)</span>
      <hf-input placeholder="https://…" [(ngModel)]="baseUrl" />

      <span class="hf-label">Modelo (opcional)</span>
      <hf-input placeholder="Ej. gemini-2.5-flash" [(ngModel)]="model" />

      <span class="hf-label">Variable de entorno de la clave (opcional)</span>
      <hf-input placeholder="Ej. GEMINI_API_KEY" [(ngModel)]="secretRef" />

      @if (error()) {
        <p class="hf-error">{{ error() }}</p>
      }

      <div footer>
        <hf-button variant="secondary" (pressed)="closed.emit()">Cancelar</hf-button>
        <hf-button variant="primary" [loading]="saving()" [disabled]="!name.trim()" (pressed)="save()">
          Agregar proveedor
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
export class AddProviderDialog {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly open = input(false);
  readonly closed = output<void>();
  readonly created = output<void>();

  readonly adapters = ADAPTERS;
  readonly capabilities = CAPABILITIES;

  adapter = ADAPTERS[0].value;
  name = '';
  capability: Capability = 'text';
  baseUrl = '';
  model = '';
  secretRef = '';

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  save(): void {
    const name = this.name.trim();
    if (!name) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createProvider({
        name,
        adapter: this.adapter,
        capabilities: [this.capability],
        baseUrl: this.baseUrl.trim() || undefined,
        model: this.model.trim() || undefined,
        params: {},
        secretRef: this.secretRef.trim() || undefined,
        enabled: true,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.resetForm();
          this.toasts.ok('Proveedor agregado.');
          this.created.emit();
          this.closed.emit();
        },
        error: () => {
          this.saving.set(false);
          this.error.set('No se pudo agregar el proveedor.');
        },
      });
  }

  private resetForm(): void {
    this.adapter = ADAPTERS[0].value;
    this.name = '';
    this.capability = 'text';
    this.baseUrl = '';
    this.model = '';
    this.secretRef = '';
  }
}
