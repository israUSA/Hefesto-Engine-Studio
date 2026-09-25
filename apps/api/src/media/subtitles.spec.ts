import { buildAss, chunkWords, escapeAssText, formatAssTime, hexToAss } from './subtitles';
import type { AlignedWord } from './align';

function word(w: string, startMs: number, endMs: number): AlignedWord {
  return { word: w, startMs, endMs, fromWhisper: true };
}

describe('formatAssTime', () => {
  it('formats milliseconds as H:MM:SS.cc', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00');
    expect(formatAssTime(1234)).toBe('0:00:01.23');
    expect(formatAssTime(3_661_500)).toBe('1:01:01.50');
  });
});

describe('hexToAss', () => {
  it('converts #RRGGBB to ASS &HAABBGGRR (BGR order)', () => {
    expect(hexToAss('#FFD23F')).toBe('&H003FD2FF');
    expect(hexToAss('#000000')).toBe('&H00000000');
  });
});

describe('escapeAssText', () => {
  it('escapes backslashes, braces and newlines', () => {
    expect(escapeAssText('a\\b{c}d\ne')).toBe('a\\\\b\\{c\\}d\\Ne');
  });
});

describe('chunkWords', () => {
  it('caps chunks at maxWordsPerLine', () => {
    const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco'].map((w, i) => word(w, i * 100, i * 100 + 90));
    const chunks = chunkWords(words, 3);
    expect(chunks.map((c) => c.map((w) => w.word))).toEqual([['uno', 'dos', 'tres'], ['cuatro', 'cinco']]);
  });

  it('breaks early right after terminal punctuation, even under the max', () => {
    const words = [word('Hola,', 0, 90), word('mundo.', 100, 190), word('Chau', 200, 290)];
    const chunks = chunkWords(words, 3);
    expect(chunks.map((c) => c.map((w) => w.word))).toEqual([['Hola,'], ['mundo.'], ['Chau']]);
  });
});

describe('buildAss', () => {
  const baseOptions = {
    width: 1080,
    height: 1920,
    style: { fontName: 'Archivo Black', fontSizePx: 90, primaryColor: '#FFFFFF', highlightColor: '#FFD23F' },
  };

  it('emits a valid header with PlayRes matching the target format', () => {
    const ass = buildAss([word('Hola', 0, 300)], baseOptions);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
  });

  it('keeps subtitles out of the bottom ~20% and right ~12% safe zone', () => {
    const ass = buildAss([word('Hola', 0, 300)], baseOptions);
    const styleLine = ass.split('\n').find((l) => l.startsWith('Style: Default'))!;
    const fields = styleLine.split(',');
    // Format: ...,MarginL, MarginR, MarginV, Encoding (last 4 fields)
    const marginV = Number(fields[fields.length - 2]);
    const marginR = Number(fields[fields.length - 3]);
    expect(marginV).toBeGreaterThanOrEqual(1920 * 0.2);
    expect(marginR).toBeGreaterThanOrEqual(1080 * 0.12 - 1);
  });

  it('emits one Dialogue event per word with the active word highlighted', () => {
    const words = [word('Dios', 0, 300), word('es', 300, 500), word('bueno', 500, 900)];
    const ass = buildAss(words, baseOptions);
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogues).toHaveLength(3);
    // First event: "Dios" highlighted (color tag), "es" and "bueno" in the default primary color.
    expect(dialogues[0]).toContain(hexToAss('#FFD23F'));
    expect(dialogues[0]).toContain('Dios');
    expect(dialogues[0]).toContain('es');
    expect(dialogues[0]).toContain('bueno');
  });

  it('uppercases text when style.uppercase is set', () => {
    const ass = buildAss([word('hola', 0, 300)], { ...baseOptions, style: { ...baseOptions.style, uppercase: true } });
    expect(ass).toContain('HOLA');
  });

  it('tints keyword words with keywordColor outside their active window', () => {
    const words = [word('el', 0, 200), word('Senor', 200, 500), word('reina', 500, 800)];
    const ass = buildAss(words, {
      ...baseOptions,
      style: { ...baseOptions.style, keywords: ['señor'], keywordColor: '#00AAFF' },
    });
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // In the first event (active word = "el"), "Senor" should carry the keyword color tag.
    expect(dialogues[0]).toContain(hexToAss('#00AAFF'));
  });

  it('escapes ASS-special characters in the words', () => {
    const ass = buildAss([word('{weird}\\word', 0, 300)], baseOptions);
    expect(ass).toContain('\\{weird\\}\\\\word');
  });
});
