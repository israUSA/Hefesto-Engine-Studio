import { z } from 'zod';
import type { TextInput, TextProvider } from './contracts';
import { extractJson, generateStructured, scriptDraftSchema } from './json-repair';
import { testCallContext } from './contract.spec-helper';

describe('extractJson', () => {
  it('extracts a JSON object wrapped in a markdown code fence', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(JSON.parse(extractJson(raw))).toEqual({ a: 1 });
  });

  it('extracts a JSON object with leading/trailing prose', () => {
    const raw = 'Here you go:\n{"a": {"b": 2}}\nHope that helps!';
    expect(JSON.parse(extractJson(raw))).toEqual({ a: { b: 2 } });
  });

  it('extracts a JSON array', () => {
    const raw = 'result: [1, 2, 3] end';
    expect(JSON.parse(extractJson(raw))).toEqual([1, 2, 3]);
  });

  it('handles nested braces correctly', () => {
    const raw = '{"a": {"b": {"c": 1}}, "d": 2}';
    expect(JSON.parse(extractJson(raw))).toEqual({ a: { b: { c: 1 } }, d: 2 });
  });
});

function stubProvider(responses: string[]): TextProvider {
  let call = 0;
  return {
    manifest: {
      adapter: 'stub',
      displayName: 'Stub',
      capabilities: ['text'],
      kind: 'cloud',
      resources: { lane: 'net' },
      license: { name: 'Stub', commercial: true },
      secrets: [],
      features: {},
    },
    config: { id: 'cfg', name: 'Stub', adapter: 'stub', capabilities: ['text'], params: {}, enabled: true },
    healthCheck: async () => ({ ok: true, message: 'ok' }),
    generate: async (_input: TextInput) => {
      const text = responses[Math.min(call, responses.length - 1)];
      call++;
      return { text, usage: { units: text.length, unit: 'char', costUsd: 0, durationMs: 1 } };
    },
  };
}

const simpleSchema = z.object({ ok: z.boolean() });

describe('generateStructured', () => {
  it('returns parsed value and usage on the first valid response', async () => {
    const provider = stubProvider(['{"ok": true}']);
    const result = await generateStructured(provider, { prompt: 'x' }, simpleSchema, testCallContext());
    expect(result.value).toEqual({ ok: true });
    expect(result.usage.units).toBeGreaterThan(0);
  });

  it('repairs invalid JSON with a second call to the same provider', async () => {
    const provider = stubProvider(['not json at all', '{"ok": false}']);
    const result = await generateStructured(provider, { prompt: 'x' }, simpleSchema, testCallContext());
    expect(result.value).toEqual({ ok: false });
  });

  it('throws after the repair attempt also fails validation', async () => {
    const provider = stubProvider(['nope', 'still nope']);
    await expect(generateStructured(provider, { prompt: 'x' }, simpleSchema, testCallContext())).rejects.toThrow(
      /reintento de reparación/,
    );
  });
});

describe('scriptDraftSchema', () => {
  function validDraft(overrides: Record<string, unknown> = {}) {
    return {
      hook: 'Esto te va a sorprender hoy',
      body: 'Cuerpo del guion.',
      cta: 'Seguinos para más.',
      scenes: [
        { text: 'Escena 1', visualPrompt: 'prompt 1', keywords: ['faith'] },
        { text: 'Escena 2', visualPrompt: 'prompt 2', keywords: ['hope', 'light'] },
        { text: 'Escena 3', visualPrompt: 'prompt 3', keywords: ['love'] },
      ],
      verseRefs: [],
      metadata: {},
      ...overrides,
    };
  }

  it('accepts a valid draft with empty verseRefs', () => {
    expect(() => scriptDraftSchema.parse(validDraft())).not.toThrow();
  });

  it('rejects fewer than 3 scenes', () => {
    expect(() => scriptDraftSchema.parse(validDraft({ scenes: [{ text: 'a', visualPrompt: 'b', keywords: ['c'] }] }))).toThrow();
  });

  it('rejects more than 12 scenes', () => {
    const scenes = Array.from({ length: 13 }, (_, i) => ({ text: `s${i}`, visualPrompt: `p${i}`, keywords: ['k'] }));
    expect(() => scriptDraftSchema.parse(validDraft({ scenes }))).toThrow();
  });

  it('rejects a hook longer than ~12 words', () => {
    const hook = Array.from({ length: 20 }, (_, i) => `palabra${i}`).join(' ');
    expect(() => scriptDraftSchema.parse(validDraft({ hook }))).toThrow();
  });

  it('rejects a scene with more than 4 keywords', () => {
    const scenes = [
      { text: 'a', visualPrompt: 'b', keywords: ['1', '2', '3', '4', '5'] },
      { text: 'c', visualPrompt: 'd', keywords: ['1'] },
      { text: 'e', visualPrompt: 'f', keywords: ['1'] },
    ];
    expect(() => scriptDraftSchema.parse(validDraft({ scenes }))).toThrow();
  });

  it('rejects a scene with zero keywords', () => {
    const scenes = [
      { text: 'a', visualPrompt: 'b', keywords: [] },
      { text: 'c', visualPrompt: 'd', keywords: ['1'] },
      { text: 'e', visualPrompt: 'f', keywords: ['1'] },
    ];
    expect(() => scriptDraftSchema.parse(validDraft({ scenes }))).toThrow();
  });
});
