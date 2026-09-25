import { readFileSync } from 'node:fs';
import type { WordTiming } from '@hefesto/shared-types';
import type { TranscribeInput } from '../../contracts';
import { readWavDurationMs } from '../../wav';
import { WORDS_PER_SECOND } from './pace';

/**
 * Evenly spaces `WordTiming`s across the known script text (`input.prompt`). Uses the
 * real WAV duration when `audioPath` points at a readable WAV (e.g. one `fakeSynthesize`
 * wrote), falling back to a words/2.5s estimate otherwise.
 */
export function fakeTranscribe(input: TranscribeInput): { text: string; words: WordTiming[] } {
  const text = input.prompt?.trim() || 'texto de prueba generado por el proveedor fake';
  const words = text.split(/\s+/).filter(Boolean);

  let totalMs = Math.max(400, Math.round((words.length / WORDS_PER_SECOND) * 1000));
  try {
    const buf = readFileSync(input.audioPath);
    totalMs = readWavDurationMs(buf) ?? totalMs;
  } catch {
    // No readable file at audioPath: keep the estimate. Fine for unit tests that don't render audio.
  }

  const perWordMs = totalMs / words.length;
  const timings: WordTiming[] = words.map((word, i) => ({
    word,
    startMs: Math.round(i * perWordMs),
    endMs: Math.round((i + 1) * perWordMs),
    confidence: 0.99,
  }));
  return { text, words: timings };
}
