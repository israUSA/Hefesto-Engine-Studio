import type { TextInput } from '../../contracts';
import { hashSeed } from './hash';

const BOOKS = ['Juan', 'Salmos', 'Mateo', 'Romanos', 'Proverbios'];

/**
 * Deterministic text generation from a hash of the prompt: same input, same output,
 * no network. When `jsonSchema` is requested, returns a JSON string shaped like a
 * `ScriptDraft` (docs/03) so the whole pipeline can run offline in tests.
 */
export function fakeGenerateText(input: TextInput): { text: string; units: number } {
  const seed = hashSeed(input.prompt + (input.system ?? ''));

  if (input.jsonSchema) {
    const sceneCount = 3 + (seed[0] % 4); // 3..6, always within the 3–12 contract range
    const firstWord = input.prompt.trim().split(/\s+/)[0] || 'esto';
    const scenes = Array.from({ length: sceneCount }, (_, i) => {
      const kwCount = 1 + (seed[(i + 1) % seed.length] % 4); // 1..4
      return {
        text: `Escena ${i + 1} sobre ${firstWord}.`,
        visualPrompt: `Imagen vertical cinematica, escena ${i + 1}, sin texto en pantalla`,
        keywords: Array.from({ length: kwCount }, (_, k) => `kw-${i}-${k}`),
      };
    });
    const draft = {
      hook: `Esto cambia como ves ${firstWord}`,
      body: scenes.map((s) => s.text).join(' '),
      cta: 'Seguí el canal para más contenido como este.',
      scenes,
      verseRefs: [
        {
          book: BOOKS[seed[1] % BOOKS.length],
          chapter: 1 + (seed[2] % 20),
          verseStart: 1 + (seed[3] % 10),
        },
      ],
      metadata: {},
    };
    const text = JSON.stringify(draft);
    return { text, units: text.length };
  }

  const text = `Respuesta fake determinista para: ${input.prompt}`;
  return { text, units: text.length };
}
