import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ScriptDto, VerseRef } from '@hefesto/shared-types';
import { Button, EmptyState, Icon, Skeleton, StatusChip, Tag } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { ToastService } from '../../core/toast.service';

function formatVerseRef(ref: VerseRef): string {
  const range = ref.verseEnd && ref.verseEnd !== ref.verseStart ? `${ref.verseStart}-${ref.verseEnd}` : `${ref.verseStart}`;
  return `${ref.book} ${ref.chapter}:${range}`;
}

function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

/**
 * Side drawer to read/edit a script's hook, body, cta and title, approve or
 * reject it, and see its Bible verse references (read-only — AI never writes
 * scripture, see docs/08-nicho-cristiano.md).
 */
@Component({
  selector: 'hf-script-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, Icon, Skeleton, StatusChip, Tag, EmptyState],
  templateUrl: './script-drawer.html',
  styleUrl: './script-drawer.css',
})
export class ScriptDrawer {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly scriptId = input.required<string>();
  readonly closed = output<void>();
  readonly updated = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly script = signal<ScriptDto | null>(null);

  readonly saving = signal(false);
  readonly deciding = signal(false);

  title = '';
  hook = '';
  body = '';
  cta = '';

  readonly dirty = computed(() => {
    const s = this.script();
    if (!s) return false;
    return s.title !== this.title || s.hook !== this.hook || s.body !== this.body || s.cta !== this.cta;
  });

  formatVerseRef = formatVerseRef;
  formatDuration = formatDuration;

  constructor() {
    effect(() => {
      this.load(this.scriptId());
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getScript(id).subscribe({
      next: (script) => {
        this.script.set(script);
        this.title = script.title;
        this.hook = script.hook;
        this.body = script.body;
        this.cta = script.cta;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('No se pudo cargar el guion.');
      },
    });
  }

  save(): void {
    const script = this.script();
    if (!script) return;
    this.saving.set(true);
    this.api.updateScript(script.id, { title: this.title, hook: this.hook, body: this.body, cta: this.cta }).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.script.set(updated);
        this.toasts.ok('Cambios guardados.');
        this.updated.emit();
      },
      error: () => {
        this.saving.set(false);
        this.toasts.error('No se pudo guardar el guion.');
      },
    });
  }

  decide(status: 'approved' | 'rejected'): void {
    const script = this.script();
    if (!script) return;
    this.deciding.set(true);
    this.api.updateScript(script.id, { status }).subscribe({
      next: (updated) => {
        this.deciding.set(false);
        this.script.set(updated);
        this.toasts.ok(status === 'approved' ? 'Guion aprobado.' : 'Guion rechazado.');
        this.updated.emit();
      },
      error: () => {
        this.deciding.set(false);
        this.toasts.error('No se pudo actualizar el guion.');
      },
    });
  }
}
