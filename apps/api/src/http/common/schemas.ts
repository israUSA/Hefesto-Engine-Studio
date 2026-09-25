import { z } from 'zod';

/** Request body / query zod schemas for the REST layer (libs/shared/types/src/lib/api.ts). */

const durationTargetSchema = z.object({ min: z.number().positive(), max: z.number().positive() });
const voiceProfileSchema = z.object({
  providerConfigId: z.string().optional(),
  voiceId: z.string().min(1),
  language: z.string().min(1),
  stylePrompt: z.string().optional(),
  speed: z.number().optional(),
  pauseBeforeAmenMs: z.number().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const visualStyleSchema = z.object({
  source: z.enum(['stock', 'ai-image', 'ai-video', 'mixed']),
  basePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  motion: z.enum(['kenburns', 'parallax', 'static']),
  transition: z.string().optional(),
});

export const channelInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  platform: z.enum(['tiktok', 'youtube']),
  handle: z.string().min(1),
  language: z.string().min(1),
  format: z.enum(['9:16', '16:9']),
  topic: z.string().min(1),
  bible: z.string().min(1),
  bibleTranslation: z.string().optional(),
  durationTarget: durationTargetSchema,
  aiLabel: z.boolean(),
  monetized: z.boolean(),
  active: z.boolean(),
  voice: voiceProfileSchema,
  visualStyle: visualStyleSchema,
});

export const channelPatchSchema = channelInputSchema.partial();

export const voicePreviewRequestSchema = z.object({
  text: z.string().optional(),
  voice: voiceProfileSchema.partial().optional(),
});

export const generateIdeasRequestSchema = z.object({
  channelId: z.string().min(1),
  count: z.number().int().positive().max(20),
  hint: z.string().optional(),
});

export const ideaPatchSchema = z.object({
  status: z.enum(['new', 'accepted', 'rejected', 'used']),
});

export const generateScriptRequestSchema = z.object({
  channelId: z.string().min(1),
  ideaId: z.string().optional(),
  topic: z.string().optional(),
});

export const scriptPatchSchema = z.object({
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
  hook: z.string().optional(),
  body: z.string().optional(),
  cta: z.string().optional(),
  title: z.string().optional(),
});

export const produceRequestSchema = z.object({
  channelIds: z.array(z.string().min(1)).min(1),
  count: z.number().int().min(0),
  scriptIds: z.array(z.string()).optional(),
  topic: z.string().optional(),
  priority: z.number().optional(),
});

export const retryProductionSchema = z.object({
  fromStage: z.enum(['script', 'voice', 'transcribe', 'subtitles', 'visuals', 'render', 'qa']).optional(),
});

export const providerConfigInputSchema = z.object({
  name: z.string().min(1),
  adapter: z.string().min(1),
  capabilities: z.array(z.string()).min(1),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  secretRef: z.string().optional(),
  pricingOverride: z.object({ unit: z.string(), usdPerUnit: z.number() }).optional(),
  enabled: z.boolean().default(true),
});

export const providerConfigPatchSchema = providerConfigInputSchema.partial();

export const bindingInputSchema = z.object({
  channelId: z.string().nullable(),
  capability: z.string(),
  role: z.string().optional(),
  providerConfigId: z.string().min(1),
  fallbackIds: z.array(z.string()).default([]),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const secretPutSchema = z.object({ value: z.string().min(1) });

export const priorityPatchSchema = z.object({ priority: z.number() });
export const laneConcurrencyPatchSchema = z.object({ concurrency: z.number().int().min(1).max(8) });
