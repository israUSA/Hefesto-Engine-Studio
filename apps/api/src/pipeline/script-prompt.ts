import type { Channel, ScriptDraft } from '@hefesto/shared-types';
import type { BibleLookup, StoredScript } from './ports';

/** Spanish narration pace used to size scripts (docs/04 §2). */
export const WORDS_PER_SECOND = 2.5;

const VERSE_TOKEN = /\[\[V(\d+)\]\]/g;

export function usesBible(channel: Channel): boolean {
  return Boolean(channel.bibleTranslation);
}

export function buildScriptPrompt(
  channel: Channel,
  recentTopics: string[],
  topicHint?: string,
): { system: string; prompt: string } {
  const minWords = Math.round(channel.durationTarget.min * WORDS_PER_SECOND);
  const maxWords = Math.round(channel.durationTarget.max * WORDS_PER_SECOND);

  const verseRules = usesBible(channel)
    ? [
        'Citas bíblicas: NUNCA escribas el texto de un versículo.',
        'Poné en `verseRefs` las referencias exactas (libro en español, capítulo, versículo inicial y final) y, en el texto de la escena donde se lee el versículo, escribí solo el marcador [[V1]], [[V2]]… en el mismo orden que `verseRefs`.',
        'El sistema reemplaza cada marcador por el texto exacto de la Biblia local. Usá entre 1 y 2 versículos, de 1 a 3 versos cada uno.',
      ]
    : ['No uses `verseRefs` (dejalo vacío).'];

  const system = [
    `Sos guionista de videos cortos verticales para el canal "${channel.name}" (${channel.platform}).`,
    `Nicho: ${channel.topic}.`,
    'Biblia del canal (tono, público, qué sí y qué no):',
    channel.bible,
    '',
    'Reglas del guion:',
    `- Idioma: ${channel.language}. Narración natural para ser leída en voz alta por una voz sintética.`,
    `- Largo total de la narración: entre ${minWords} y ${maxWords} palabras.`,
    '- `hook`: la primera frase, de 12 palabras o menos, que frene el scroll en los primeros 3 segundos.',
    '- `scenes`: la narración COMPLETA dividida en escenas, en orden. La primera escena empieza con el hook y la última termina con el llamado a la acción. Cada escena es una o dos frases.',
    '- En cada escena: `visualPrompt` describe la imagen ideal (sin texto en pantalla, sin personas reconocibles, sin logos) y `keywords` son 1 a 4 palabras en INGLÉS para buscar en bancos de stock.',
    '- `body` es el cuerpo sin el hook ni el cta; `cta` es el llamado a la acción final.',
    '- `metadata`: título, descripción y 3–6 hashtags para la plataforma del canal.',
    '- Sin emojis en la narración. Sin números con símbolos raros: escribí "tres" o "3", nunca "3️⃣".',
    ...verseRules.map((r) => `- ${r}`),
  ].join('\n');

  const avoid = recentTopics.length
    ? `\nTemas ya usados (no los repitas ni los parafrasees):\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
    : '';

  const prompt = [
    topicHint ? `Escribí un guion sobre: ${topicHint}.` : 'Elegí un tema nuevo y concreto dentro del nicho y escribí el guion.',
    avoid,
    '\nRespondé solo con el JSON pedido.',
  ].join('\n');

  return { system, prompt };
}

/**
 * Replaces [[Vn]] markers with the exact local Bible text (ADR-009).
 * Throws if the model wrote a marker without a matching reference or a reference doesn't exist.
 */
export async function materializeScript(
  draft: ScriptDraft,
  channel: Channel,
  bible: BibleLookup,
): Promise<StoredScript> {
  const translation = channel.bibleTranslation;
  const verseTexts: string[] = [];

  if (translation) {
    for (const ref of draft.verseRefs) {
      const text = await bible.passage(ref, translation);
      verseTexts.push(`${text.trim()} ${bible.format(ref)}.`);
    }
  }

  const usedMarkers = new Set<number>();
  const fill = (s: string): string =>
    s.replace(VERSE_TOKEN, (_m, n: string) => {
      usedMarkers.add(Number(n));
      const text = verseTexts[Number(n) - 1];
      if (!text) throw new Error(`El guion usa [[V${n}]] pero no hay una referencia bíblica para ese marcador`);
      return text;
    });

  const scenes = draft.scenes.map((s, i) => ({
    order: i,
    text: fill(s.text).replace(/\s+/g, ' ').trim(),
    visualPrompt: s.visualPrompt,
    keywords: s.keywords,
  }));

  const meta = draft.metadata[channel.platform];
  return {
    title: meta?.title ?? draft.hook,
    hook: fill(draft.hook),
    body: fill(draft.body),
    cta: fill(draft.cta),
    fullText: scenes.map((s) => s.text).join(' '),
    // Only references the narration actually reads: an unused one can't be checked by QA.
    verseRefs: translation ? draft.verseRefs.filter((_, i) => usedMarkers.has(i + 1)) : [],
    metadata: draft.metadata,
    scenes,
  };
}
