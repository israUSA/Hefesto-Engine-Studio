import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'danger' | 'neutral';
  actionLabel?: string;
  action?: () => void;
  durationMs: number;
}

export interface ToastOptions {
  tone?: Toast['tone'];
  actionLabel?: string;
  action?: () => void;
  durationMs?: number;
}

/** App-wide toast queue, e.g. "Cambios guardados · se aplican en la próxima tarea  Deshacer". */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  show(message: string, options: ToastOptions = {}): number {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      message,
      tone: options.tone ?? 'neutral',
      actionLabel: options.actionLabel,
      action: options.action,
      durationMs: options.durationMs ?? 4000,
    };
    this.toasts.update((list) => [...list, toast]);
    setTimeout(() => this.dismiss(id), toast.durationMs);
    return id;
  }

  ok(message: string, options: ToastOptions = {}): number {
    return this.show(message, { ...options, tone: 'ok' });
  }

  error(message: string, options: ToastOptions = {}): number {
    return this.show(message, { ...options, tone: 'danger', durationMs: options.durationMs ?? 6000 });
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
