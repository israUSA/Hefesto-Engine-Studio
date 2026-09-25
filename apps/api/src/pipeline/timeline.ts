import type { WordTiming } from '@hefesto/shared-types';

const MIN_SCENE_MS = 500;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Scene boundaries from word timings aligned to the script (one timing per
 * whitespace-separated script word). Scenes are contiguous: each one lasts
 * until the next starts, and the last one until the end of the voice plus a tail.
 */
export function sceneTimeline(
  sceneTexts: string[],
  words: WordTiming[],
  voiceDurationMs: number,
  tailMs = 400,
): { startMs: number; endMs: number }[] {
  const expected = sceneTexts.reduce((n, t) => n + countWords(t), 0);
  if (expected !== words.length) {
    throw new Error(`La alineación devolvió ${words.length} palabras y el guion tiene ${expected}`);
  }

  const starts: number[] = [];
  let cursor = 0;
  for (const text of sceneTexts) {
    starts.push(starts.length === 0 ? 0 : words[cursor]?.startMs ?? voiceDurationMs);
    cursor += countWords(text);
  }

  const end = voiceDurationMs + tailMs;
  const scenes = starts.map((startMs, i) => ({ startMs, endMs: i + 1 < starts.length ? starts[i + 1] : end }));

  // Bad timings (e.g. a transcript that collapsed to zero) would leave empty scenes:
  // fall back to splitting the voice proportionally to each scene's word count.
  if (scenes.some((s) => s.endMs - s.startMs < MIN_SCENE_MS)) {
    let acc = 0;
    return sceneTexts.map((text, i) => {
      const startMs = Math.round((acc / expected) * voiceDurationMs);
      acc += countWords(text);
      const endMs = i + 1 < sceneTexts.length ? Math.round((acc / expected) * voiceDurationMs) : end;
      return { startMs, endMs };
    });
  }
  return scenes;
}
