/**
 * Drizzle schema for SQLite. Fase 1 subset of docs/03-modelo-de-datos.md.
 * Types embedded in JSON columns come from @hefesto/shared-types so the DB
 * shape and the domain contracts never drift apart.
 */
import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  Capability,
  HealthResult,
  Platform,
  PlatformMetadata,
  ProviderPricing,
  TextRole,
  VerseRef,
  VideoFormat,
  VisualStyle,
  VoiceProfile,
} from '@hefesto/shared-types';

const nowIso = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ── Channels ────────────────────────────────────────────────────────────

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  platform: text('platform').$type<Platform>().notNull(),
  handle: text('handle').notNull(),
  language: text('language').notNull().default('es'),
  format: text('format').$type<VideoFormat>().notNull(),
  topic: text('topic').notNull(),
  /** "Biblia del canal": tone, audience, do's and don'ts, examples. */
  bible: text('bible').notNull(),
  bibleTranslation: text('bible_translation'),
  durationTarget: text('duration_target', { mode: 'json' })
    .$type<{ min: number; max: number }>()
    .notNull(),
  voiceProfile: text('voice_profile', { mode: 'json' }).$type<VoiceProfile>().notNull(),
  visualStyle: text('visual_style', { mode: 'json' }).$type<VisualStyle>().notNull(),
  driveFolderId: text('drive_folder_id'),
  /** Marks content as AI-generated when publishing. */
  aiLabel: integer('ai_label', { mode: 'boolean' }).notNull().default(true),
  /** Blocks non-commercial-license providers for this channel (ADR-008). */
  monetized: integer('monetized', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(nowIso()),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

// ── Scripts / scenes ────────────────────────────────────────────────────

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id),
  ideaId: text('idea_id'),
  title: text('title'),
  hook: text('hook').notNull(),
  body: text('body').notNull(),
  cta: text('cta').notNull(),
  fullText: text('full_text').notNull(),
  /** References only — verse text always comes from the local Bible (ADR-009). */
  verseRefs: text('verse_refs', { mode: 'json' }).$type<VerseRef[]>().notNull().default([]),
  metadata: text('metadata', { mode: 'json' })
    .$type<Partial<Record<Platform, PlatformMetadata>>>()
    .notNull()
    .default({}),
  variant: text('variant'),
  status: text('status').$type<'draft' | 'approved' | 'rejected'>().notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull().default(nowIso()),
});

export const scenes = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  scriptId: text('script_id')
    .notNull()
    .references(() => scripts.id),
  order: integer('order').notNull(),
  text: text('text').notNull(),
  visualPrompt: text('visual_prompt').notNull(),
  assetId: text('asset_id'),
  startMs: integer('start_ms'),
  endMs: integer('end_ms'),
});

// ── Productions ─────────────────────────────────────────────────────────

export const productions = sqliteTable('productions', {
  id: text('id').primaryKey(),
  scriptId: text('script_id')
    .notNull()
    .references(() => scripts.id),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id),
  stage: text('stage')
    .$type<
      | 'scripted'
      | 'voiced'
      | 'transcribed'
      | 'visuals_ready'
      | 'rendered'
      | 'qa_passed'
      | 'qa_failed'
      | 'archived'
      | 'scheduled'
      | 'published'
    >()
    .notNull()
    .default('scripted'),
  status: text('status')
    .$type<'pending' | 'running' | 'done' | 'failed' | 'canceled'>()
    .notNull()
    .default('pending'),
  /** Per-stage input hash: the basis for idempotency (docs/13). */
  inputHashes: text('input_hashes', { mode: 'json' })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  renderPath: text('render_path'),
  /** Stage the queue is running or will run next (StageKey). */
  currentStep: text('current_step'),
  /** 0..1 across all stages, for the live bar. */
  progress: real('progress').notNull().default(0),
  error: text('error'),
  durationMs: integer('duration_ms'),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: text('created_at').notNull().default(nowIso()),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

// ── Assets ──────────────────────────────────────────────────────────────

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  productionId: text('production_id').references(() => productions.id),
  kind: text('kind')
    .$type<'voice' | 'words' | 'subs' | 'scene-image' | 'scene-video' | 'music' | 'render' | 'thumb'>()
    .notNull(),
  localPath: text('local_path'),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  providerConfigId: text('provider_config_id'),
  prompt: text('prompt'),
  /** Eligible for the reusable-resource bank. */
  reusable: integer('reusable', { mode: 'boolean' }).notNull().default(false),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  /** Hash of the inputs that produced this asset, for idempotency. */
  inputHash: text('input_hash'),
  createdAt: text('created_at').notNull().default(nowIso()),
});

// ── Costs ───────────────────────────────────────────────────────────────

export const costEntries = sqliteTable('cost_entries', {
  id: text('id').primaryKey(),
  productionId: text('production_id').references(() => productions.id),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id),
  providerConfigId: text('provider_config_id').notNull(),
  operation: text('operation').notNull(),
  units: integer('units').notNull(),
  unit: text('unit').$type<'char' | 'token' | 'image' | 'second' | 'request'>().notNull(),
  /** USD; 0 for local/free providers. */
  costUsd: real('cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: text('created_at').notNull().default(nowIso()),
});

// ── Providers ───────────────────────────────────────────────────────────

export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adapter: text('adapter').notNull(),
  capabilities: text('capabilities', { mode: 'json' }).$type<Capability[]>().notNull().default([]),
  baseUrl: text('base_url'),
  model: text('model'),
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  /** Name of the key in the SecretVault (ADR-012). Never the value. */
  secretRef: text('secret_ref'),
  pricingOverride: text('pricing_override', { mode: 'json' }).$type<ProviderPricing>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastHealth: text('last_health', { mode: 'json' }).$type<HealthResult>(),
  createdAt: text('created_at').notNull().default(nowIso()),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

export const providerBindings = sqliteTable('provider_bindings', {
  id: text('id').primaryKey(),
  /** null = global default. */
  channelId: text('channel_id').references(() => channels.id),
  capability: text('capability').$type<Capability>().notNull(),
  role: text('role').$type<TextRole>(),
  providerConfigId: text('provider_config_id')
    .notNull()
    .references(() => providerConfigs.id),
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  fallbackIds: text('fallback_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  createdAt: text('created_at').notNull().default(nowIso()),
});

// ── Jobs ────────────────────────────────────────────────────────────────

// ── Ideas ───────────────────────────────────────────────────────────────

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id),
  title: text('title').notNull(),
  angle: text('angle').notNull().default(''),
  status: text('status').$type<'new' | 'accepted' | 'rejected' | 'used'>().notNull().default('new'),
  source: text('source').$type<'ai' | 'manual'>().notNull().default('ai'),
  /** Embedding for repeated-topic detection (Fase 4). */
  embedding: text('embedding', { mode: 'json' }).$type<number[]>(),
  createdAt: text('created_at').notNull().default(nowIso()),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

// ── App settings (queue concurrency, paused flag, budget…) ──────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull().default(nowIso()),
});

// ── Jobs ────────────────────────────────────────────────────────────────

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  productionId: text('production_id').references(() => productions.id),
  channelId: text('channel_id').references(() => channels.id),
  type: text('type').notNull(),
  lane: text('lane').$type<'gpu' | 'net' | 'cpu'>().notNull(),
  status: text('status')
    .$type<'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'canceled'>()
    .notNull()
    .default('queued'),
  priority: integer('priority').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  progress: real('progress').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull().default(nowIso()),
});

// ── Bible ───────────────────────────────────────────────────────────────

export const bibleVerses = sqliteTable(
  'bible_verses',
  {
    id: text('id').primaryKey(),
    translation: text('translation').notNull(),
    book: text('book').notNull(),
    chapter: integer('chapter').notNull(),
    verse: integer('verse').notNull(),
    text: text('text').notNull(),
  },
  (table) => [
    uniqueIndex('bible_verses_ref_idx').on(
      table.translation,
      table.book,
      table.chapter,
      table.verse,
    ),
  ],
);

// The FTS5 virtual table (`bible_verses_fts`) and its sync triggers are not
// representable in drizzle-kit's schema diffing, so they live in a hand
// written migration (see apps/api/drizzle/0001_bible_fts.sql) applied with
// `CREATE VIRTUAL TABLE IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS`.
