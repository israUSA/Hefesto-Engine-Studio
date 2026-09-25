import { sceneTimeline } from './timeline';

const w = (word: string, startMs: number) => ({ word, startMs, endMs: startMs + 300 });

describe('sceneTimeline', () => {
  it('makes contiguous scenes that start at the first word of each scene', () => {
    const words = [w('Dios', 100), w('te', 500), w('ama.', 800), w('Siempre', 1500), w('está.', 1900)];
    expect(sceneTimeline(['Dios te ama.', 'Siempre está.'], words, 2300)).toEqual([
      { startMs: 0, endMs: 1500 },
      { startMs: 1500, endMs: 2700 },
    ]);
  });

  it('fails loudly when the alignment and the script disagree', () => {
    expect(() => sceneTimeline(['uno dos'], [w('uno', 0)], 1000)).toThrow(/1 palabras/);
  });
});

describe('sceneTimeline fallback', () => {
  it('splits by word count when timings collapse', () => {
    const words = ['a', 'b', 'c', 'd'].map((x) => w(x, 0));
    expect(sceneTimeline(['a b c', 'd'], words, 4000, 400)).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 4400 },
    ]);
  });
});
