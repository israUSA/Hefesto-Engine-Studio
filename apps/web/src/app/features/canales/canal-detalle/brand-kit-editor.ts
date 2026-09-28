import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SUBTITLE_SIZE_RANGE, type BrandKit, type FontDto } from '@hefesto/shared-types';
import { Select, type SelectOption } from '@hefesto/web-ui';
import { ApiClient } from '../../../core/api-client';

type ColorKey = 'textColor' | 'highlightColor' | 'outlineColor';

const SAMPLE_WORDS = ['Guarda', 'esta', 'oración', 'para', 'hoy'];
const WORDS_PER_LINE = 3;
/** Preview frame width in px; the renderer works on a 1080-wide frame. */
const PREVIEW_WIDTH = 180;
const SCALE = PREVIEW_WIDTH / 1080;
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Brand kit controls (subtitle font, size, colors, uppercase) with a live karaoke preview
 * drawn at the same proportions as the rendered `subs.ass` (docs/04 §4 and §7).
 */
@Component({
  selector: 'hf-brand-kit-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Select],
  templateUrl: './brand-kit-editor.html',
  styleUrl: './brand-kit-editor.css',
})
export class BrandKitEditor {
  private readonly api = inject(ApiClient);

  readonly kit = model.required<BrandKit>();

  readonly sizeRange = SUBTITLE_SIZE_RANGE;
  readonly colorFields: { key: ColorKey; label: string }[] = [
    { key: 'textColor', label: 'Texto' },
    { key: 'highlightColor', label: 'Palabra activa' },
    { key: 'outlineColor', label: 'Borde' },
  ];

  readonly fonts = signal<FontDto[]>([]);
  readonly fontOptions = computed<SelectOption[]>(() => {
    const options = this.fonts().map((f) => ({ value: f.family, label: f.family }));
    const current = this.kit().subtitleFont;
    // Keep the saved font visible even if its file is missing on this machine.
    return options.some((o) => o.value === current) ? options : [{ value: current, label: `${current} (no instalada)` }, ...options];
  });

  private readonly activeWord = signal(0);
  readonly line = computed(() => {
    const active = this.activeWord();
    const start = Math.floor(active / WORDS_PER_LINE) * WORDS_PER_LINE;
    const upper = this.kit().uppercase;
    return SAMPLE_WORDS.slice(start, start + WORDS_PER_LINE).map((word, i) => ({
      text: upper ? word.toUpperCase() : word,
      active: start + i === active,
    }));
  });

  readonly previewStyle = computed(() => {
    const k = this.kit();
    const outlinePx = Math.max(1, Math.round(k.subtitleSize * 0.08)) * SCALE;
    return {
      'font-family': `'${k.subtitleFont}', sans-serif`,
      'font-size': `${k.subtitleSize * SCALE}px`,
      color: k.textColor,
      '-webkit-text-stroke': `${outlinePx * 2}px ${k.outlineColor}`,
    };
  });

  constructor() {
    this.api.listFonts().subscribe({ next: (fonts) => this.loadFonts(fonts), error: () => undefined });

    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      const timer = setInterval(() => this.activeWord.update((i) => (i + 1) % SAMPLE_WORDS.length), 450);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
  }

  update(patch: Partial<BrandKit>): void {
    this.kit.set({ ...this.kit(), ...patch });
  }

  setSize(value: number | string): void {
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) {
      this.update({ subtitleSize: Math.min(SUBTITLE_SIZE_RANGE.max, Math.max(SUBTITLE_SIZE_RANGE.min, n)) });
    }
  }

  setColor(key: ColorKey, value: string): void {
    const hex = value.startsWith('#') ? value : `#${value}`;
    if (HEX.test(hex)) this.update({ [key]: hex.toUpperCase() });
  }

  /** Registers each renderer font in the page so the preview uses the same glyphs. */
  private loadFonts(fonts: FontDto[]): void {
    this.fonts.set(fonts);
    for (const font of fonts) {
      if ([...document.fonts].some((f) => f.family === font.family)) continue;
      const face = new FontFace(font.family, `url(${font.url})`);
      document.fonts.add(face);
      face.load().catch(() => undefined);
    }
  }
}
