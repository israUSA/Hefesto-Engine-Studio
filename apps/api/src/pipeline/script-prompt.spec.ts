import type { Channel, ScriptDraft } from '@hefesto/shared-types';
import type { BibleLookup } from './ports';
import { buildScriptPrompt, materializeScript } from './script-prompt';

const channel = {
  name: 'Fe Diaria',
  platform: 'tiktok',
  topic: 'oraciones',
  bible: 'Tono cálido.',
  language: 'es',
  bibleTranslation: 'RV1909',
  durationTarget: { min: 30, max: 60 },
} as Channel;

const bible: BibleLookup = {
  passage: async () => 'Jehová es mi pastor; nada me faltará.',
  format: () => 'Salmos 23:1',
  verify: async () => ({ exact: true, similarity: 1 }),
};

const draft = (sceneText: string, refs = 1): ScriptDraft => ({
  hook: 'No estás solo.',
  body: 'cuerpo',
  cta: 'Seguinos.',
  scenes: [{ text: 'No estás solo.', visualPrompt: 'luz', keywords: ['light'] }, { text: sceneText, visualPrompt: 'campo', keywords: ['field'] }],
  verseRefs: Array.from({ length: refs }, () => ({ book: 'Sal', chapter: 23, verseStart: 1 })),
  metadata: { tiktok: { title: 'Dios cuida', description: 'd', hashtags: ['#fe'] } },
});

describe('materializeScript', () => {
  it('replaces verse markers with the exact local Bible text', async () => {
    const s = await materializeScript(draft('Dice la Palabra: [[V1]]'), channel, bible);
    expect(s.fullText).toBe('No estás solo. Dice la Palabra: Jehová es mi pastor; nada me faltará. Salmos 23:1.');
    expect(s.title).toBe('Dios cuida');
    expect(s.verseRefs).toHaveLength(1);
  });

  it('drops references the narration never reads', async () => {
    const s = await materializeScript(draft('Sin cita.', 2), channel, bible);
    expect(s.verseRefs).toEqual([]);
  });

  it('rejects a marker without a reference', async () => {
    await expect(materializeScript(draft('[[V2]]'), channel, bible)).rejects.toThrow(/\[\[V2\]\]/);
  });
});

describe('buildScriptPrompt', () => {
  it('forbids writing verse text and sizes the script from the duration target', () => {
    const { system, prompt } = buildScriptPrompt(channel, ['Tema viejo'], 'la paz');
    expect(system).toContain('NUNCA escribas el texto de un versículo');
    expect(system).toContain('entre 75 y 150 palabras');
    expect(prompt).toContain('Tema viejo');
    expect(prompt).toContain('la paz');
  });
});
