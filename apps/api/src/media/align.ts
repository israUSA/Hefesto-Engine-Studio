/**
 * Aligns Whisper's word timings onto the SCRIPT's words (docs/04 §4: subtitles must show the
 * script's spelling, never Whisper's — Whisper can mishear a word but the script is what was
 * actually meant to be said). Also computes WER between script and transcript for QA (§7,
 * threshold 8%).
 */

import type { WordTiming } from '@hefesto/shared-types';

/** Strips accents, punctuation and case so "Diós," and "dios" compare equal. */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ''); // keep letters/digits only
}

/** Splits a script (or transcript) into words on whitespace, dropping empty tokens. */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export interface AlignedWord extends WordTiming {
  /** True when this timing came directly from Whisper; false when interpolated. */
  fromWhisper: boolean;
}

interface DpCell {
  cost: number;
  /** 'match' | 'sub' | 'del' (script word has no whisper counterpart) | 'ins' (extra whisper word) */
  op: 'match' | 'sub' | 'del' | 'ins' | 'start';
}

export interface AlignmentResult {
  words: AlignedWord[];
  /** Word Error Rate in percent, computed against the script (docs/04 §7 threshold: 8%). */
  wer: number;
}

/** Aligns Whisper's word-level timings onto the script text. Every script word gets an entry:
 * matched words keep Whisper's timing, unmatched ones get an interpolated timing spread evenly
 * between the surrounding matched anchors (or extrapolated at the very start/end). */
export function alignScriptToWhisper(scriptText: string, whisperWords: WordTiming[]): AlignmentResult {
  const scriptWords = tokenize(scriptText);
  const scriptNorm = scriptWords.map(normalizeWord);
  const whisperNorm = whisperWords.map((w) => normalizeWord(w.word));

  const { path, editCost } = alignInternal(scriptNorm, whisperNorm);

  const words: AlignedWord[] = scriptWords.map((w) => ({ word: w, startMs: 0, endMs: 0, fromWhisper: false }));
  const matchedWhisperIdx = new Map<number, number>(); // scriptIdx -> whisperIdx

  for (const step of path) {
    if (step.scriptIdx !== null && step.whisperIdx !== null) {
      matchedWhisperIdx.set(step.scriptIdx, step.whisperIdx);
    }
  }

  for (const [scriptIdx, whisperIdx] of matchedWhisperIdx) {
    const w = whisperWords[whisperIdx];
    words[scriptIdx].startMs = w.startMs;
    words[scriptIdx].endMs = w.endMs;
    words[scriptIdx].confidence = w.confidence;
    words[scriptIdx].fromWhisper = true;
  }

  interpolateGaps(words, matchedWhisperIdx);

  const wer = scriptWords.length > 0 ? (editCost / scriptWords.length) * 100 : 0;
  return { words, wer };
}

function alignInternal(scriptNorm: string[], whisperNorm: string[]): { path: Array<{ scriptIdx: number | null; whisperIdx: number | null }>; editCost: number } {
  const n = scriptNorm.length;
  const m = whisperNorm.length;
  const dp: DpCell[][] = Array.from({ length: n + 1 }, () => new Array(m + 1));

  dp[0][0] = { cost: 0, op: 'start' };
  for (let i = 1; i <= n; i++) dp[i][0] = { cost: i, op: 'del' };
  for (let j = 1; j <= m; j++) dp[0][j] = { cost: j, op: 'ins' };

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const matchCost = scriptNorm[i - 1] === whisperNorm[j - 1] ? 0 : 1;
      const diagOp: DpCell['op'] = matchCost === 0 ? 'match' : 'sub';
      const diag = dp[i - 1][j - 1].cost + matchCost;
      const del = dp[i - 1][j].cost + 1;
      const ins = dp[i][j - 1].cost + 1;

      let best = diag;
      let op: DpCell['op'] = diagOp;
      if (del < best) {
        best = del;
        op = 'del';
      }
      if (ins < best) {
        best = ins;
        op = 'ins';
      }
      dp[i][j] = { cost: best, op };
    }
  }

  const path: Array<{ scriptIdx: number | null; whisperIdx: number | null }> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cell = dp[i][j];
    if (cell.op === 'match' || cell.op === 'sub') {
      path.push({ scriptIdx: i - 1, whisperIdx: j - 1 });
      i--;
      j--;
    } else if (cell.op === 'del') {
      path.push({ scriptIdx: i - 1, whisperIdx: null });
      i--;
    } else {
      path.push({ scriptIdx: null, whisperIdx: j - 1 });
      j--;
    }
  }
  path.reverse();
  return { path, editCost: dp[n][m].cost };
}

/** Fills startMs/endMs for words whose `fromWhisper` is false by spreading them evenly between
 * the nearest matched neighbours (or extrapolating a fixed per-word duration at the edges). */
function interpolateGaps(words: AlignedWord[], matched: Map<number, number>): void {
  const DEFAULT_WORD_MS = 350; // fallback pace when there's no anchor at all (e.g. empty transcript)
  const n = words.length;
  let i = 0;
  while (i < n) {
    if (words[i].fromWhisper) {
      i++;
      continue;
    }
    // Find the run of consecutive unmatched words [i, j).
    let j = i;
    while (j < n && !words[j].fromWhisper) j++;

    const prevEnd = i > 0 ? words[i - 1].endMs : undefined;
    const nextStart = j < n ? words[j].startMs : undefined;
    const gapCount = j - i;

    if (prevEnd !== undefined && nextStart !== undefined && nextStart > prevEnd) {
      const span = nextStart - prevEnd;
      const step = span / gapCount;
      for (let k = 0; k < gapCount; k++) {
        words[i + k].startMs = Math.round(prevEnd + step * k);
        words[i + k].endMs = Math.round(prevEnd + step * (k + 1));
      }
    } else if (prevEnd !== undefined) {
      for (let k = 0; k < gapCount; k++) {
        words[i + k].startMs = prevEnd + DEFAULT_WORD_MS * k;
        words[i + k].endMs = prevEnd + DEFAULT_WORD_MS * (k + 1);
      }
    } else if (nextStart !== undefined) {
      for (let k = 0; k < gapCount; k++) {
        const idxFromEnd = gapCount - k;
        words[i + k].startMs = Math.max(0, nextStart - DEFAULT_WORD_MS * idxFromEnd);
        words[i + k].endMs = Math.max(0, nextStart - DEFAULT_WORD_MS * (idxFromEnd - 1));
      }
    } else {
      // No anchors at all: lay words out sequentially from 0.
      for (let k = 0; k < gapCount; k++) {
        words[i + k].startMs = DEFAULT_WORD_MS * (i + k);
        words[i + k].endMs = DEFAULT_WORD_MS * (i + k + 1);
      }
    }
    i = j;
  }
}
