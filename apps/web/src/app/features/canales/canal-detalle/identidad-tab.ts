import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Motion, Platform, VisualSource } from '@hefesto/shared-types';
import { Button, Icon, Input, Select, SelectOption, Skeleton } from '@hefesto/web-ui';
import { ApiClient } from '../../../core/api-client';
import { ToastService } from '../../../core/toast.service';
import { ChannelDetailStore } from './channel-detail.store';

const PLATFORMS: SelectOption[] = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
];

const VISUAL_SOURCES: SelectOption[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'ai-image', label: 'Imágenes IA' },
  { value: 'ai-video', label: 'Video IA' },
  { value: 'mixed', label: 'Mixto' },
];

const MOTIONS: SelectOption[] = [
  { value: 'kenburns', label: 'Ken Burns' },
  { value: 'parallax', label: 'Paralaje' },
  { value: 'static', label: 'Estático' },
];

/** Channel identity: brand voice, "biblia del canal", target duration and visual style. */
@Component({
  selector: 'hf-identidad-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, Icon, Input, Select, Skeleton],
  templateUrl: './identidad-tab.html',
  styleUrl: './identidad-tab.css',
})
export class IdentidadTab {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  readonly store = inject(ChannelDetailStore);

  readonly platforms = PLATFORMS;
  readonly visualSources = VISUAL_SOURCES;
  readonly motions = MOTIONS;

  name = '';
  handle = '';
  platform: Platform = 'tiktok';
  topic = '';
  bible = '';
  durationMin = 30;
  durationMax = 60;

  voiceId = '';
  voiceLanguage = 'es';
  stylePrompt = '';
  speed = 1;

  visualSource: VisualSource = 'stock';
  motion: Motion = 'kenburns';
  basePrompt = '';

  readonly saving = signal(false);
  readonly previewing = signal(false);
  readonly previewAudioUrl = signal<string | null>(null);
  readonly previewError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const channel = this.store.channel();
      if (channel) {
        this.name = channel.name;
        this.handle = channel.handle;
        this.platform = channel.platform;
        this.topic = channel.topic;
        this.bible = channel.bible;
        this.durationMin = channel.durationTarget.min;
        this.durationMax = channel.durationTarget.max;
        this.voiceId = channel.voice.voiceId;
        this.voiceLanguage = channel.voice.language;
        this.stylePrompt = channel.voice.stylePrompt ?? '';
        this.speed = channel.voice.speed ?? 1;
        this.visualSource = channel.visualStyle.source;
        this.motion = channel.visualStyle.motion;
        this.basePrompt = channel.visualStyle.basePrompt ?? '';
      }
    });
  }

  save(): void {
    const channel = this.store.channel();
    if (!channel) {
      return;
    }
    this.saving.set(true);
    this.api
      .updateChannel(channel.id, {
        name: this.name.trim(),
        handle: this.handle.trim(),
        platform: this.platform,
        topic: this.topic.trim(),
        bible: this.bible,
        durationTarget: { min: this.durationMin, max: this.durationMax },
        voice: {
          ...channel.voice,
          voiceId: this.voiceId.trim(),
          language: this.voiceLanguage,
          stylePrompt: this.stylePrompt.trim() || undefined,
          speed: this.speed,
        },
        visualStyle: {
          ...channel.visualStyle,
          source: this.visualSource,
          motion: this.motion,
          basePrompt: this.basePrompt.trim() || undefined,
        },
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toasts.ok('Identidad del canal guardada.');
          this.store.refresh();
        },
        error: () => {
          this.saving.set(false);
          this.toasts.error('No se pudo guardar la identidad del canal.');
        },
      });
  }

  previewVoice(): void {
    const channel = this.store.channel();
    if (!channel) {
      return;
    }
    this.previewing.set(true);
    this.previewError.set(null);
    this.previewAudioUrl.set(null);
    this.api
      .previewVoice(channel.id, {
        voice: {
          voiceId: this.voiceId.trim(),
          language: this.voiceLanguage,
          stylePrompt: this.stylePrompt.trim() || undefined,
          speed: this.speed,
        },
      })
      .subscribe({
        next: (result) => {
          this.previewing.set(false);
          this.previewAudioUrl.set(result.audioUrl);
        },
        error: () => {
          this.previewing.set(false);
          this.previewError.set('No se pudo generar la muestra de voz.');
        },
      });
  }
}
