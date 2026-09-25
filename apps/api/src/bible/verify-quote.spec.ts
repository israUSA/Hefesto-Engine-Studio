import { compareTexts, normalizeText } from './verify-quote';

describe('normalizeText', () => {
  it('strips accents, punctuation, case and extra whitespace', () => {
    expect(normalizeText('¡Jehová   es MI Pastor;  nada me faltará.')).toBe(
      'jehova es mi pastor nada me faltara',
    );
  });
});

describe('compareTexts', () => {
  it('is exact for an identical quote', () => {
    const result = compareTexts('Jehová es mi pastor; nada me faltará.', 'Jehová es mi pastor; nada me faltará.');
    expect(result.exact).toBe(true);
    expect(result.similarity).toBe(1);
  });

  it('is exact when the verse is embedded in a longer script', () => {
    const result = compareTexts(
      'Hoy quiero recordarte: Jehová es mi pastor; nada me faltará. Que tengas un lindo día.',
      'Jehová es mi pastor; nada me faltará.',
    );
    expect(result.exact).toBe(true);
  });

  it('ignores accent, punctuation and case differences', () => {
    const result = compareTexts('JEHOVA ES MI PASTOR NADA ME FALTARA', 'Jehová es mi pastor; nada me faltará.');
    expect(result.exact).toBe(true);
  });

  it('is not exact for a paraphrase, but reports partial similarity', () => {
    const result = compareTexts('El Señor es mi pastor, nada me falta.', 'Jehová es mi pastor; nada me faltará.');
    expect(result.exact).toBe(false);
    expect(result.similarity).toBeGreaterThan(0.3);
    expect(result.similarity).toBeLessThan(1);
  });

  it('reports low similarity for unrelated text', () => {
    const result = compareTexts('Receta de tarta de manzana', 'Jehová es mi pastor; nada me faltará.');
    expect(result.exact).toBe(false);
    expect(result.similarity).toBeLessThan(0.5);
  });
});
