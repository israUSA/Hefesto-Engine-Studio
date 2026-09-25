/**
 * Builds karaoke-style `.ass` subtitles (1080x1920 or 1920x1080) from script words already
 * aligned to Whisper timings (see align.ts). Docs/04 §4 and §7 (safe zone):
 *   - brand-kit style: font, size, primary/highlight colors, outline, uppercase
 *   - 1-3 words per line, respecting punctuation
 *   - karaoke highlight of the active word
 *   - optional keyword coloring
 *   - stays out of the bottom ~20% and right ~12% (TikTok/Shorts UI)
 *
 * Implementation choice: instead of `\k` karaoke tags (which need centisecond-perfect timing
 * and are easy to desync), each active word gets its OWN `Dialogue` event spanning exactly its
 * [startMs, endMs), with the whole chunk's text re-rendered and only that word colored with the
 * highlight. This is more events, but renders identically across libass versions and never
 * drifts out of sync with the audio.
 */

import type { WordTiming } from '@hefesto/shared-types';
import type { AlignedWord } from './align';

export interface SubtitleStyle {
  fontName: string;
  fontSizePx: number;
  /** Hex "#RRGGBB". */
  primaryColor: string;
  /** Hex "#RRGGBB". Active-word karaoke highlight. Default brand color #FFD23F. */
  highlightColor?: string;
  outlineColor?: string;
  outlineWidthPx?: number;
  uppercase?: boolean;
  /** Words (case/accent-insensitive) that are always tinted with `keywordColor`, even when
   * not the active word. The highlight color still wins while a keyword word is active. */
  keywords?: string[];
  keywordColor?: string;
}

export interface SubtitleOptions {
  width: number;
  height: number;
  style: SubtitleStyle;
  /** Max words per rendered line (chunk). Default 3 (docs/04 §4: "1-3 palabras por línea"). */
  maxWordsPerLine?: number;
}

const DEFAULT_HIGHLIGHT = '#FFD23F';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** ms -> ASS time "H:MM:SS.cc" (centiseconds). */
export function formatAssTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

/** "#RRGGBB" -> ASS "&HAABBGGRR" (ASS colors are BGR, alpha 00 = opaque). */
export function hexToAss(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

/** Escapes ASS special characters in dialogue text: backslash, braces, and real newlines. */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N');
}

function normalizeForKeywordMatch(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Groups words into 1..maxWordsPerLine chunks, breaking early after terminal punctuation so a
 * line never straddles a sentence boundary. */
export function chunkWords<T extends WordTiming>(words: T[], maxWordsPerLine = 3): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const word of words) {
    current.push(word);
    const endsWithPunctuation = /[.,;:!?…]$/.test(word.word.trim());
    if (current.length >= maxWordsPerLine || endsWithPunctuation) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildHeader(options: SubtitleOptions): string {
  const { width, height, style } = options;
  const primary = hexToAss(style.primaryColor);
  const outline = hexToAss(style.outlineColor ?? '#000000');
  const outlineWidth = style.outlineWidthPx ?? Math.max(1, Math.round(style.fontSizePx * 0.08));
  // Safe zone (docs/04 §7): stay out of the bottom ~20% and right ~12%. MarginV lifts the block
  // up from the bottom edge; symmetric L/R margins keep it clear of the right-side TikTok UI too.
  const marginV = Math.round(height * 0.22);
  const marginLR = Math.round(width * 0.12);

  return [
    '[Script Info]',
    'Title: Hefesto subtitles',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontName},${style.fontSizePx},${primary},${primary},${outline},&H64000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},0,2,${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

/** Builds the full `.ass` file content from script words aligned to whisper timings. */
export function buildAss(words: AlignedWord[], options: SubtitleOptions): string {
  const style = options.style;
  const highlight = hexToAss(style.highlightColor ?? DEFAULT_HIGHLIGHT);
  const primary = hexToAss(style.primaryColor);
  const keywordColor = style.keywordColor ? hexToAss(style.keywordColor) : undefined;
  const keywordSet = new Set((style.keywords ?? []).map(normalizeForKeywordMatch));
  const maxWordsPerLine = options.maxWordsPerLine ?? 3;

  const chunks = chunkWords(words, maxWordsPerLine);
  const lines: string[] = [buildHeader(options)];

  chunks.forEach((chunk, chunkIdx) => {
    const nextChunk = chunks[chunkIdx + 1];
    chunk.forEach((activeWord, activeIdx) => {
      const start = activeWord.startMs;
      // Extend the last word's event to the start of the next chunk (or a small tail) so the
      // line doesn't flicker/disappear in the gap between words.
      const isLastInChunk = activeIdx === chunk.length - 1;
      const end = isLastInChunk ? (nextChunk ? nextChunk[0].startMs : activeWord.endMs + 300) : chunk[activeIdx + 1].startMs;
      if (end <= start) return; // zero/negative-length event, skip

      const text = chunk
        .map((w, idx) => {
          const display = style.uppercase ? w.word.toUpperCase() : w.word;
          const escaped = escapeAssText(display);
          if (idx === activeIdx) return `{\\c${highlight}}${escaped}{\\c${primary}}`;
          if (keywordColor && keywordSet.has(normalizeForKeywordMatch(w.word))) {
            return `{\\c${keywordColor}}${escaped}{\\c${primary}}`;
          }
          return escaped;
        })
        .join(' ');

      lines.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`);
    });
  });

  return lines.join('\n') + '\n';
}
