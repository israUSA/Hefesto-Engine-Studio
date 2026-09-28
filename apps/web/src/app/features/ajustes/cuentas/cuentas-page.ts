import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { GoogleAccountStatus } from '@hefesto/shared-types';
import { Button, Icon, Input, Skeleton, StatusChip } from '@hefesto/web-ui';
import { ApiClient } from '../../../core/api-client';
import { ToastService } from '../../../core/toast.service';

const POLL_MS = 2000;
const POLL_LIMIT_MS = 5 * 60_000;

/** Ajustes → Cuentas y OAuth: the Google account Drive uses (docs/06 · autenticación). */
@Component({
  selector: 'hf-cuentas-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, FormsModule, Icon, Input, RouterLink, Skeleton, StatusChip],
  templateUrl: './cuentas-page.html',
  styleUrl: './cuentas-page.css',
})
export class CuentasPage {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly status = signal<GoogleAccountStatus | null>(null);
  readonly editingClient = signal(false);
  readonly savingClient = signal(false);
  readonly connecting = signal(false);
  readonly disconnecting = signal(false);
  clientId = '';
  clientSecret = '';
  private poll?: ReturnType<typeof setInterval>;

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  load(): void {
    this.api.getGoogleAccount().subscribe({
      next: (s) => this.status.set(s),
      error: () => this.toasts.error('No se pudo conectar con el motor.'),
    });
  }

  saveClient(): void {
    this.savingClient.set(true);
    this.api.setGoogleClient({ clientId: this.clientId.trim(), clientSecret: this.clientSecret.trim() }).subscribe({
      next: (s) => {
        this.status.set(s);
        this.savingClient.set(false);
        this.editingClient.set(false);
        this.clientId = '';
        this.clientSecret = '';
        this.toasts.ok('Cliente OAuth guardado (cifrado).');
      },
      error: (err) => {
        this.savingClient.set(false);
        this.toasts.error(err?.error?.message ?? 'No se pudo guardar el cliente.');
      },
    });
  }

  connect(): void {
    this.connecting.set(true);
    this.api.connectGoogle().subscribe({
      next: ({ authUrl }) => {
        window.open(authUrl, '_blank', 'noopener');
        this.waitForConnection();
      },
      error: (err) => {
        this.connecting.set(false);
        this.toasts.error(err?.error?.message ?? 'No se pudo iniciar la conexión.');
      },
    });
  }

  /** The consent happens in the browser; the API gets the callback. Poll until it lands. */
  private waitForConnection(): void {
    this.stopPolling();
    const started = Date.now();
    this.poll = setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        this.stopPolling();
        this.connecting.set(false);
        return;
      }
      this.api.getGoogleAccount().subscribe({
        next: (s) => {
          if (!s.connected) return;
          this.status.set(s);
          this.stopPolling();
          this.connecting.set(false);
          this.toasts.ok(`Google Drive conectado${s.email ? ` · ${s.email}` : ''}`);
        },
      });
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
  }

  cancelConnect(): void {
    this.stopPolling();
    this.connecting.set(false);
  }

  disconnect(): void {
    this.disconnecting.set(true);
    this.api.disconnectGoogle().subscribe({
      next: (s) => {
        this.status.set(s);
        this.disconnecting.set(false);
        this.toasts.ok('Google Drive desconectado. Lo ya archivado sigue en tu Drive.');
      },
      error: () => {
        this.disconnecting.set(false);
        this.toasts.error('No se pudo desconectar.');
      },
    });
  }

  copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => this.toasts.ok('Copiado.'));
  }
}
