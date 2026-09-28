import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { GoogleAccountStatus, StorageOverview, StorageTargetRequest } from '@hefesto/shared-types';
import { Button, Icon, Input } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { ToastService } from '../../core/toast.service';

/** First run of the Drive view: pick Google Drive or a folder (NAS, external disk, Drive for desktop). */
@Component({
  selector: 'hf-storage-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, FormsModule, Icon, Input, RouterLink],
  template: `
    <div class="hf-setup">
      <section class="hf-setup__card">
        <hf-icon name="drive" [size]="20" />
        <h2>Google Drive</h2>
        <p>Sube cada video con checksum verificado a <code>Mi unidad/Hefesto Engine Studio</code>. Solo ve los archivos que crea la app.</p>
        @if (google()?.connected) {
          <p class="hf-setup__ok"><hf-icon name="check" [size]="13" /> Conectado{{ google()?.email ? ' como ' + google()?.email : '' }}</p>
          <hf-button variant="primary" [loading]="saving() === 'google-drive'" (pressed)="choose({ adapter: 'google-drive' })">
            Archivar en Google Drive
          </hf-button>
        } @else {
          <a class="hf-setup__link" routerLink="/ajustes/cuentas">
            Conectar la cuenta en Ajustes → Cuentas y OAuth <hf-icon name="arrow-right" [size]="13" />
          </a>
        }
      </section>
      <section class="hf-setup__card">
        <hf-icon name="folder" [size]="20" />
        <h2>Carpeta local o NAS</h2>
        <p>Un disco externo, una carpeta de red o la carpeta de "Google Drive para escritorio". Sin cuentas ni claves.</p>
        <hf-input icon="folder" placeholder="D:\\Archivo" ariaLabel="Carpeta de archivo" [(ngModel)]="root" />
        <hf-button
          variant="secondary"
          [disabled]="!root.trim()"
          [loading]="saving() === 'local-folder'"
          (pressed)="choose({ adapter: 'local-folder', root: root.trim() })"
        >
          Archivar en esta carpeta
        </hf-button>
      </section>
    </div>
  `,
  styles: `
    .hf-setup {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--space-4);
    }
    .hf-setup__card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-5);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      color: var(--text-2);
    }
    h2 {
      font-size: var(--text-lg);
      color: var(--text);
    }
    p {
      font-size: var(--text-sm);
      line-height: var(--leading-base);
    }
    code {
      font-family: var(--font-mono);
      color: var(--text);
    }
    .hf-setup__ok {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--ok);
    }
    .hf-setup__link {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--accent);
      text-decoration: none;
    }
  `,
})
export class StorageSetup {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly google = input<GoogleAccountStatus | null>(null);
  readonly changed = output<StorageOverview>();
  readonly saving = signal<StorageTargetRequest['adapter'] | null>(null);
  root = '';

  choose(target: StorageTargetRequest): void {
    this.saving.set(target.adapter);
    this.api.setStorageTarget(target).subscribe({
      next: (overview) => {
        this.saving.set(null);
        this.toasts.ok('Listo: los videos nuevos se archivan después del QA');
        this.changed.emit(overview);
      },
      error: (err) => {
        this.saving.set(null);
        this.toasts.error(err?.error?.message ?? 'No se pudo guardar');
      },
    });
  }
}
