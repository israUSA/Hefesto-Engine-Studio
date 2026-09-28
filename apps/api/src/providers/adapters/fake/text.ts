import type { TextInput } from '../../contracts';
import { hashSeed } from './hash';

const BOOKS = ['Juan', 'Salmos', 'Mateo', 'Romanos', 'Proverbios'];
const TOPICS = ['la gratitud', 'la paciencia', 'el descanso', 'la esperanza', 'el perdón', 'la constancia', 'la calma', 'el propósito'];
const ANGLES = ['Tres errores comunes sobre', 'Lo que nadie te dice sobre', 'Un minuto para pensar en', 'Cómo empezar el día con', 'Una historia real sobre'];

/** True when the requested JSON schema is the `{ ideas: [...] }` shape used by IdeasService. */
function wantsIdeas(schema: Record<string, unknown>): boolean {
  const props = schema['properties'] as Record<string, unknown> | undefined;
  return !!props && 'ideas' in props;
}

/**
 * Deterministic text generation from a hash of the prompt: same input, same output,
 * no network. When `jsonSchema` is requested, returns a JSON string shaped like the
 * ideas list or a `ScriptDraft` (docs/03) so the whole app can run offline in tests.
 */
export function fakeGenerateText(input: TextInput): { text: string; units: number } {
  const seed = hashSeed(input.prompt + (input.system ?? ''));

  if (input.jsonSchema && wantsIdeas(input.jsonSchema)) {
    const count = Math.min(10, Math.max(1, Number(/(\d+)\s+ideas/.exec(input.prompt)?.[1] ?? 3)));
    // Stepping topic and angle together keeps (angle, topic) pairs distinct for up to 40 ideas.
    const ideas = Array.from({ length: count }, (_, i) => {
      const topic = TOPICS[(seed[0] + i) % TOPICS.length];
      const angle = ANGLES[(seed[1] + i) % ANGLES.length];
      return { title: `${angle} ${topic}`, angle: `Enfoque práctico sobre ${topic}.` };
    });
    const text = JSON.stringify({ ideas });
    return { text, units: text.length };
  }

  if (input.jsonSchema) {
    const sceneCount = 3 + (seed[0] % 4); // 3..6, always within the 3–12 contract range
    const topic = TOPICS[seed[4] % TOPICS.length];
    const scenes = Array.from({ length: sceneCount }, (_, i) => {
      const kwCount = 1 + (seed[(i + 1) % seed.length] % 4); // 1..4
      return {
        text: `Escena ${i + 1} sobre ${topic}.`,
        visualPrompt: `Imagen vertical cinematica, escena ${i + 1}, sin texto en pantalla`,
        keywords: Array.from({ length: kwCount }, (_, k) => `kw-${i}-${k}`),
      };
    });
    const draft = {
      hook: `Esto cambia como ves ${topic}`,
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
