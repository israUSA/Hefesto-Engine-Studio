/**
 * Idempotent seeds. The product ships with **no channels**:
 * - `seedProviderCatalog` runs on every API start and only inserts what's missing,
 *   so it never overwrites the user's provider settings.
 * - `seedDemoChannels` (setup --demo) creates example channels from the niche
 *   templates, for development and demos only.
 */
import type { Channel, ProviderBinding, ProviderConfig } from '@hefesto/shared-types';
import { CHANNEL_TEMPLATES } from './channel-templates';
import type { DbInstance } from './migrate';
import { ChannelsRepository } from './repositories/channels.repository';
import { ProviderBindingsRepository } from './repositories/provider-bindings.repository';
import { ProviderConfigsRepository } from './repositories/provider-configs.repository';

type SeedProviderConfig = Omit<ProviderConfig, 'id'>;

const PROVIDER_CONFIGS: SeedProviderConfig[] = [
  {
    name: 'gemini-flash',
    adapter: 'gemini',
    capabilities: ['text'],
    model: 'gemini-2.5-flash',
    params: {},
    secretRef: 'GEMINI_API_KEY',
    enabled: true,
  },
  {
    name: 'gemini-tts',
    adapter: 'gemini',
    capabilities: ['tts'],
    model: 'gemini-2.5-flash-preview-tts',
    params: {},
    secretRef: 'GEMINI_API_KEY',
    enabled: true,
  },
  {
    name: 'pexels',
    adapter: 'pexels',
    capabilities: ['stock'],
    params: {},
    secretRef: 'PEXELS_API_KEY',
    enabled: true,
  },
  {
    name: 'whisper-local',
    adapter: 'whisper-cpp',
    capabilities: ['transcribe'],
    params: {},
    enabled: true,
  },
  {
    name: 'ollama-local',
    adapter: 'openai-compatible',
    capabilities: ['text'],
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:4b',
    params: { keepAlive: 0 },
    enabled: false,
  },
];

/** Offline stand-in for every capability. Only seeded for demos and tests. */
const FAKE_PROVIDER: SeedProviderConfig = {
  name: 'fake',
  adapter: 'fake',
  capabilities: ['text', 'tts', 'transcribe', 'stock', 'image'],
  params: {},
  enabled: true,
};

/** Default global bindings: which catalog provider serves each capability. */
const DEFAULT_BINDINGS: { capability: ProviderBinding['capability']; role?: ProviderBinding['role']; provider: string; fallbacks: string[] }[] = [
  ...(['ideas', 'script', 'metadata', 'keywords'] as const).map((role) => ({
    capability: 'text' as const,
    role,
    provider: 'gemini-flash',
    fallbacks: ['ollama-local'],
  })),
  { capability: 'tts', provider: 'gemini-tts', fallbacks: [] },
  { capability: 'stock', provider: 'pexels', fallbacks: [] },
  { capability: 'transcribe', provider: 'whisper-local', fallbacks: [] },
];

/** Example channels for `setup --demo`: names are placeholders, content comes from the templates. */
const DEMO_CHANNELS: { template: string; name: string; slug: string; platform: Channel['platform']; handle: string }[] = [
  { template: 'devocional-cristiano', name: 'Devocional (demo)', slug: 'demo-devocional', platform: 'tiktok', handle: '@demo.devocional' },
  { template: 'salmos', name: 'Salmos (demo)', slug: 'demo-salmos', platform: 'youtube', handle: '@demo.salmos' },
  { template: 'datos-videojuegos', name: 'Videojuegos (demo)', slug: 'demo-videojuegos', platform: 'youtube', handle: '@demo.videojuegos' },
  { template: 'motivacion-ejercicio', name: 'Motivación (demo)', slug: 'demo-motivacion', platform: 'tiktok', handle: '@demo.motivacion' },
];

export interface SeedResult {
  channels: Channel[];
  providerConfigs: ProviderConfig[];
  providerBindings: ProviderBinding[];
}

export interface SeedOptions {
  /** Also create the demo channels and the `fake` provider. */
  demo?: boolean;
  /** Put the global bindings back to the defaults (overwrites user choices). */
  resetBindings?: boolean;
}

/** Provider catalog + default bindings. Inserts only what's missing unless `resetBindings`. */
export function seedProviderCatalog(db: DbInstance, opts: SeedOptions = {}): Omit<SeedResult, 'channels'> {
  const configsRepo = new ProviderConfigsRepository(db);
  const bindingsRepo = new ProviderBindingsRepository(db);

  const catalog = opts.demo ? [...PROVIDER_CONFIGS, FAKE_PROVIDER] : PROVIDER_CONFIGS;
  const byName = new Map<string, ProviderConfig>();
  for (const config of catalog) {
    byName.set(config.name, configsRepo.findByName(config.name) ?? configsRepo.create(config));
  }

  const existing = bindingsRepo.list();
  const bindings: ProviderBinding[] = [];
  for (const b of DEFAULT_BINDINGS) {
    const current = existing.find(
      (e) => e.channelId === null && e.capability === b.capability && (e.role ?? undefined) === b.role,
    );
    if (current && !opts.resetBindings) {
      bindings.push(current);
      continue;
    }
    const provider = byName.get(b.provider) ?? configsRepo.findByName(b.provider);
    if (!provider) continue;
    bindings.push(
      bindingsRepo.upsert({
        channelId: null,
        capability: b.capability,
        role: b.role,
        providerConfigId: provider.id,
        params: {},
        fallbackIds: b.fallbacks.map((f) => byName.get(f)?.id).filter((id): id is string => Boolean(id)),
      }),
    );
  }
  return { providerConfigs: [...byName.values()], providerBindings: bindings };
}

/** Example channels built from the niche templates (demo/dev only). */
export function seedDemoChannels(db: DbInstance): Channel[] {
  const repo = new ChannelsRepository(db);
  return DEMO_CHANNELS.map((demo) => {
    const template = CHANNEL_TEMPLATES.find((t) => t.id === demo.template);
    if (!template) throw new Error(`Plantilla desconocida: ${demo.template}`);
    const d = template.defaults;
    return repo.upsertBySlug({
      name: demo.name,
      slug: demo.slug,
      platform: demo.platform,
      handle: demo.handle,
      language: 'es',
      format: '9:16',
      topic: d.topic ?? '',
      bible: d.bible ?? '',
      bibleTranslation: d.bibleTranslation,
      durationTarget: d.durationTarget ?? { min: 30, max: 60 },
      aiLabel: true,
      monetized: false,
      active: true,
      voice: d.voice ?? { voiceId: 'Kore', language: 'es' },
      visualStyle: d.visualStyle ?? { source: 'stock', motion: 'kenburns' },
    });
  });
}

export function seedDatabase(db: DbInstance, opts: SeedOptions = {}): SeedResult {
  const catalog = seedProviderCatalog(db, opts);
  const channels = opts.demo ? seedDemoChannels(db) : [];
  return { channels, ...catalog };
}

/** `npx ts-node --transpile-only apps/api/src/db/seed.ts` from the repo root. */
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { paths } = require('../config/env');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createDb } = require('./migrate');
  const { db, sqlite } = createDb(paths.db());
  const result = seedDatabase(db, { demo: process.argv.includes('--demo') });
  console.log(`Seed OK: ${result.channels.length} canales, ${result.providerConfigs.length} proveedores, ${result.providerBindings.length} bindings.`);
  sqlite.close();
}
