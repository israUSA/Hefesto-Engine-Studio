import type { TtsInput } from '../../contracts';
import { generateTonePcm, writePcmWav } from '../../wav';
import { WORDS_PER_SECOND } from './pace';

/** Writes a valid WAV (a quiet 220 Hz tone, not silence, so it's audibly distinguishable) at ~words/2.5s. */
export function fakeSynthesize(input: TtsInput): { durationMs: number } {
  const words = input.text.trim().split(/\s+/).filter(Boolean).length || 1;
  const durationMs = Math.max(400, Math.round((words / WORDS_PER_SECOND) * 1000));
  const sampleRate = 24000;
  const pcm = generateTonePcm(durationMs, sampleRate, 220, 3000);
  writePcmWav(input.outPath, pcm, { sampleRate });
  return { durationMs };
}
