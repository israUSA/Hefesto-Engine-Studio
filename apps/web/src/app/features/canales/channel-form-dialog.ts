import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChannelInput, ChannelTemplateDto, Platform, VideoFormat } from '@hefesto/shared-types';
import { Button, Dialog, Input, Select, SelectOption } from '@hefesto/web-ui';
import { ApiClient } from '../../core/api-client';
import { ToastService } from '../../core/toast.service';

const PLATFORMS: SelectOption[] = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
];

const FORMATS: SelectOption[] = [
  { value: '9:16', label: '9:16 (shorts)' },
  { value: '16:9', label: '16:9' },
];

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * "Create channel" dialog. The product ships with no channels: the user starts
 * blank or from a niche template (tone, voice, visual style), then fine-tunes it in Identidad.
 */
@Component({
  selector: 'hf-channel-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dialog, Input, Select, Button, FormsModule],
  template: `
    <hf-dialog [open]="open()" title="Nuevo canal" (closed)="closed.emit()">
      <span class="hf-label" id="hf-template-label">Punto de partida</span>
      <div class="hf-templates" role="radiogroup" aria-labelledby="hf-template-label">
        <button
          type="button"
          role="radio"
          class="hf-template"
          [class.is-selected]="templateId() === null"
          [attr.aria-checked]="templateId() === null"
          (click)="pickTemplate(null)"
        >
          <span class="hf-template__name">En blanco</span>
          <span class="hf-template__desc">Definí el tono y la voz vos mismo.</span>
        </button>
        @for (t of templates(); track t.id) {
          <button
            type="button"
            role="radio"
            class="hf-template"
            [class.is-selected]="templateId() === t.id"
            [attr.aria-checked]="templateId() === t.id"
            (click)="pickTemplate(t)"
          >
            <span class="hf-template__name">{{ t.name }} <span class="hf-template__niche">{{ t.niche }}</span></span>
            <span class="hf-template__desc">{{ t.description }}</span>
          </button>
        }
      </div>

      <span class="hf-label">Nombre</span>
      <hf-input placeholder="Ej. Mi canal" [(ngModel)]="name" />

      <span class="hf-label">Plataforma</span>
      <hf-select [options]="platforms" [(ngModel)]="platform" />

      <span class="hf-label">Handle</span>
      <hf-input placeholder="@tucanal" [(ngModel)]="handle" />

      <span class="hf-label">Nicho / tema</span>
      <hf-input placeholder="Ej. Oraciones y versículos cortos" [(ngModel)]="topic" />

      <span class="hf-label">Formato</span>
      <hf-select [options]="formats" [(ngModel)]="format" />

      @if (error()) {
        <p class="hf-error">{{ error() }}</p>
      }

      <div footer>
        <hf-button variant="secondary" (pressed)="closed.emit()">Cancelar</hf-button>
        <hf-button variant="primary" [loading]="saving()" [disabled]="!name.trim()" (pressed)="save()">
          Crear canal
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
    .hf-templates {
      display: flex;
      flex-direction: column;
      max-height: 232px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
    }
    .hf-template {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-2) var(--space-3);
      text-align: left;
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--line);
      color: var(--text);
      cursor: pointer;
      font: inherit;
    }
    .hf-template:last-child {
      border-bottom: 0;
    }
    .hf-template:hover {
      background: var(--surface-2);
    }
    .hf-template:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .hf-template.is-selected {
      background: var(--accent-soft);
      box-shadow: inset 2px 0 0 var(--accent);
    }
    .hf-template__name {
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .hf-template__niche {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-3);
      margin-left: var(--space-1);
    }
    .hf-template__desc {
      font-size: var(--text-xs, 12px);
      color: var(--text-2);
    }
    .hf-error {
      font-size: var(--text-sm);
      color: var(--danger);
      margin: 0;
    }
  `,
})
export class ChannelFormDialog {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly open = input(false);
  readonly closed = output<void>();
  readonly created = output<string>();

  readonly platforms = PLATFORMS;
  readonly formats = FORMATS;

  name = '';
  platform: Platform = 'tiktok';
  handle = '';
  topic = '';
  format: VideoFormat = '9:16';

  readonly templates = signal<ChannelTemplateDto[]>([]);
  readonly templateId = signal<string | null>(null);
  private template: ChannelTemplateDto | null = null;

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Load the templates the first time the dialog opens.
    effect(() => {
      if (this.open() && this.templates().length === 0) {
        this.api.listChannelTemplates().subscribe({ next: (t) => this.templates.set(t), error: () => undefined });
      }
    });
  }

  pickTemplate(t: ChannelTemplateDto | null): void {
    this.template = t;
    this.templateId.set(t?.id ?? null);
    // Pre-fill the niche only if the user hasn't typed their own.
    const templateTopics = this.templates().map((x) => x.defaults.topic);
    if (!this.topic.trim() || templateTopics.includes(this.topic)) {
      this.topic = t?.defaults.topic ?? '';
    }
  }

  save(): void {
    const name = this.name.trim();
    if (!name) {
      return;
    }
    const d = this.template?.defaults ?? {};
    const input: ChannelInput = {
      name,
      slug: slugify(name),
      platform: this.platform,
      handle: this.handle.trim() || `@${slugify(name)}`,
      language: 'es',
      format: this.format,
      topic: this.topic.trim(),
      bible: d.bible ?? '',
      bibleTranslation: d.bibleTranslation,
      durationTarget: d.durationTarget ?? { min: 30, max: 60 },
      aiLabel: true,
      monetized: false,
      active: true,
      voice: d.voice ?? { voiceId: '', language: 'es' },
      visualStyle: d.visualStyle ?? { source: 'stock', motion: 'kenburns' },
    };

    this.saving.set(true);
    this.error.set(null);
    this.api.createChannel(input).subscribe({
      next: (channel) => {
        this.saving.set(false);
        this.resetForm();
        this.toasts.ok('Canal creado.');
        this.created.emit(channel.slug);
        this.closed.emit();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No se pudo crear el canal.');
      },
    });
  }

  private resetForm(): void {
    this.name = '';
    this.platform = 'tiktok';
    this.handle = '';
    this.topic = '';
    this.format = '9:16';
    this.template = null;
    this.templateId.set(null);
  }
}
