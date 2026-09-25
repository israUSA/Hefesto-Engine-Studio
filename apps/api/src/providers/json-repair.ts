import { z } from 'zod';
import type { Usage } from '@hefesto/shared-types';
import type { CallContext, TextInput, TextProvider } from './contracts';
import { ProviderError } from './contracts';

/** Strips code fences and returns the first balanced JSON object or array found in `raw`. */
export function extractJson(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const candidates = [objStart, arrStart].filter((i) => i !== -1);
  if (candidates.length === 0) return text;
  const start = Math.min(...candidates);
  const open = text[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string };

function tryParse<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  try {
    const json = JSON.parse(extractJson(text));
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, errors: result.error.message };
  } catch (err) {
    return { ok: false, errors: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Calls a `TextProvider` and validates its output with `schema`. On failure, asks the
 * *same* provider once to repair its own JSON given the validation errors — small local
 * models are the main reason this "reparación" retry exists (docs/13 §5).
 */
export interface StructuredResult<T> {
  value: T;
  usage: Usage;
  raw: string;
}

export async function generateStructured<T>(
  provider: TextProvider,
  input: TextInput,
  schema: z.ZodType<T>,
  ctx: CallContext,
): Promise<StructuredResult<T>> {
  const first = await provider.generate(input, ctx);
  const attempt = tryParse(first.text, schema);
  if (attempt.ok) return { value: attempt.data, usage: first.usage, raw: first.text };

  const repairPrompt = [
    'Tu respuesta anterior no pasó la validación. Corregila y devolvé SOLO JSON válido, sin texto adicional ni bloques de código.',
    `Errores de validación:\n${attempt.errors}`,
    `Respuesta anterior:\n${first.text}`,
  ].join('\n\n');

  const repaired = await provider.generate({ ...input, prompt: repairPrompt }, ctx);
  const second = tryParse(repaired.text, schema);
  if (second.ok) return { value: second.data, usage: repaired.usage, raw: repaired.text };

  throw new ProviderError(
    `La salida estructurada no pasó la validación tras el reintento de reparación: ${second.errors}`,
    provider.manifest.adapter,
    false,
  );
}

const sceneDraftSchema = z.object({
  text: z.string().min(1),
  visualPrompt: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(4),
});

const verseRefSchema = z.object({
  book: z.string().min(1),
  chapter: z.number().int().positive(),
  verseStart: z.number().int().positive(),
  verseEnd: z.number().int().positive().optional(),
});

const platformMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  hashtags: z.array(z.string()),
});

/**
 * Validates a `ScriptDraft` (docs/03): 3–12 scenes, hook ~12 words or fewer, 1–4 keywords
 * per scene, `verseRefs` may be empty (channels without a Bible translation don't use it).
 */
export const scriptDraftSchema = z.object({
  hook: z.string().min(1).refine((s) => s.trim().split(/\s+/).length <= 14, {
    message: 'el hook debe tener 12 palabras o menos (con margen)',
  }),
  body: z.string().min(1),
  cta: z.string().min(1),
  scenes: z.array(sceneDraftSchema).min(3).max(12),
  verseRefs: z.array(verseRefSchema),
  metadata: z.record(z.string(), platformMetadataSchema).default({}),
});

export type ScriptDraftShape = z.infer<typeof scriptDraftSchema>;

/**
 * JSON Schema for providers with native structured output (Gemini, OpenAI-compatible).
 * Drops keywords they reject (`$schema`, JS safe-integer bounds) and spells out the
 * per-platform metadata instead of an open record.
 */
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json['$schema'];
  return JSON.parse(JSON.stringify(json), (key, value) =>
    (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) ||
    (key === 'minimum' && value === Number.MIN_SAFE_INTEGER)
      ? undefined
      : value,
  ) as Record<string, unknown>;
}

const platformMetadataJsonSchema = toProviderJsonSchema(platformMetadataSchema);

export const scriptDraftJsonSchema: Record<string, unknown> = (() => {
  const json = toProviderJsonSchema(scriptDraftSchema);
  const properties = json['properties'] as Record<string, unknown>;
  properties['metadata'] = {
    type: 'object',
    properties: { tiktok: platformMetadataJsonSchema, youtube: platformMetadataJsonSchema },
  };
  json['required'] = ['hook', 'body', 'cta', 'scenes', 'verseRefs', 'metadata'];
  return json;
})();
