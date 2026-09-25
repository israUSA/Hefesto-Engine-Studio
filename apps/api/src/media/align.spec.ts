import { alignScriptToWhisper, normalizeWord, tokenize } from './align';
import type { WordTiming } from '@hefesto/shared-types';

describe('normalizeWord', () => {
  it('strips accents, punctuation and case', () => {
    expect(normalizeWord('Diós,')).toBe('dios');
    expect(normalizeWord('¿Por?')).toBe('por');
    expect(normalizeWord('Salmos23:1')).toBe('salmos231');
  });
});

describe('tokenize', () => {
  it('splits on whitespace and drops empty tokens', () => {
    expect(tokenize('Porque  de tal manera')).toEqual(['Porque', 'de', 'tal', 'manera']);
  });
});

describe('alignScriptToWhisper', () => {
  it('assigns whisper timings to matching script words and reports 0% WER on a perfect match', () => {
    const script = 'Porque de tal manera amo Dios al mundo';
    const words: WordTiming[] = script.split(' ').map((w, i) => ({
      word: w,
      startMs: i * 300,
      endMs: i * 300 + 250,
    }));

    const { words: aligned, wer } = alignScriptToWhisper(script, words);

    expect(aligned).toHaveLength(8);
    expect(aligned[0]).toMatchObject({ word: 'Porque', startMs: 0, endMs: 250, fromWhisper: true });
    expect(aligned[4]).toMatchObject({ word: 'amo', startMs: 1200, endMs: 1450, fromWhisper: true });
    expect(wer).toBe(0);
  });

  it('keeps the SCRIPT spelling even when whisper misheard the word (docs/04 §4)', () => {
    const script = 'amo a Dios';
    const whisperWords: WordTiming[] = [
      { word: 'amó', startMs: 0, endMs: 200 },
      { word: 'adiós', startMs: 200, endMs: 500 }, // mishears "a Dios" as "adiós"
    ];

    const { words: aligned } = alignScriptToWhisper(script, whisperWords);

    expect(aligned.map((w) => w.word)).toEqual(['amo', 'a', 'Dios']);
    // "amo" matches "amó" after normalization.
    expect(aligned[0].fromWhisper).toBe(true);
  });

  it('interpolates timings for script words whisper missed entirely', () => {
    const script = 'uno dos tres cuatro cinco';
    const whisperWords: WordTiming[] = [
      { word: 'uno', startMs: 0, endMs: 100 },
      { word: 'cinco', startMs: 1000, endMs: 1100 },
    ];

    const { words: aligned, wer } = alignScriptToWhisper(script, whisperWords);

    expect(aligned[0]).toMatchObject({ word: 'uno', fromWhisper: true, startMs: 0, endMs: 100 });
    expect(aligned[4]).toMatchObject({ word: 'cinco', fromWhisper: true, startMs: 1000, endMs: 1100 });
    // "dos", "tres", "cuatro" are spread evenly between 100 and 1000.
    expect(aligned[1].fromWhisper).toBe(false);
    expect(aligned[1].startMs).toBeGreaterThanOrEqual(100);
    expect(aligned[3].endMs).toBeLessThanOrEqual(1000);
    expect(aligned[1].startMs).toBeLessThan(aligned[2].startMs);
    expect(aligned[2].startMs).toBeLessThan(aligned[3].startMs);
    expect(wer).toBeCloseTo((3 / 5) * 100, 5);
  });

  it('computes a non-zero WER above the docs/04 §7 8% threshold on a garbled transcript', () => {
    const script = 'el senor es mi pastor nada me faltara';
    const whisperWords: WordTiming[] = ['el', 'sinior', 'es', 'mi', 'pastor'].map((w, i) => ({
      word: w,
      startMs: i * 200,
      endMs: i * 200 + 150,
    }));
    const { wer } = alignScriptToWhisper(script, whisperWords);
    expect(wer).toBeGreaterThan(8);
  });
});
