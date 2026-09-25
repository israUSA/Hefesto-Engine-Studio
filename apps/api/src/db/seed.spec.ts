import type Database from 'better-sqlite3';
import type { DbInstance } from './migrate';
import { CHANNEL_TEMPLATES } from './channel-templates';
import { ProviderBindingsRepository } from './repositories/provider-bindings.repository';
import { ProviderConfigsRepository } from './repositories/provider-configs.repository';
import { createTestDb } from './test-utils';
import { seedDatabase, seedProviderCatalog } from './seed';
import { channels, providerBindings, providerConfigs } from './schema';

describe('seed', () => {
  let db: DbInstance;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ db, sqlite } = createTestDb());
  });

  afterEach(() => sqlite.close());

  it('ships empty: no channels and no fake provider by default', () => {
    const result = seedDatabase(db);
    expect(result.channels).toEqual([]);
    expect(db.select().from(channels).all()).toHaveLength(0);
    const names = result.providerConfigs.map((c) => c.name).sort();
    expect(names).toEqual(['gemini-flash', 'gemini-tts', 'ollama-local', 'pexels', 'whisper-local']);
  });

  it('creates the default global bindings (text roles with local fallback, tts without)', () => {
    const result = seedDatabase(db);
    const text = result.providerBindings.filter((b) => b.capability === 'text');
    expect(text.map((b) => b.role).sort()).toEqual(['ideas', 'keywords', 'metadata', 'script']);
    for (const b of text) {
      expect(b.channelId).toBeNull();
      expect(b.fallbackIds).toHaveLength(1);
    }
    expect(result.providerBindings.find((b) => b.capability === 'tts')?.fallbackIds).toEqual([]);
  });

  it('never overwrites the user settings on later starts', () => {
    seedProviderCatalog(db);
    const configs = new ProviderConfigsRepository(db);
    const bindings = new ProviderBindingsRepository(db);
    const ollama = configs.findByName('ollama-local');
    const tts = bindings.list().find((b) => b.capability === 'tts');
    if (!ollama || !tts) throw new Error('seed incompleto');
    configs.upsertByName({ ...ollama, model: 'llama3.2:3b', enabled: true });
    bindings.upsert({ ...tts, providerConfigId: ollama.id });

    seedProviderCatalog(db);

    expect(configs.findByName('ollama-local')?.model).toBe('llama3.2:3b');
    expect(bindings.list().find((b) => b.capability === 'tts')?.providerConfigId).toBe(ollama.id);
  });

  it('resetBindings restores the defaults', () => {
    seedProviderCatalog(db);
    const bindings = new ProviderBindingsRepository(db);
    const tts = bindings.list().find((b) => b.capability === 'tts');
    if (!tts) throw new Error('seed incompleto');
    const ollama = new ProviderConfigsRepository(db).findByName('ollama-local');
    bindings.upsert({ ...tts, providerConfigId: ollama?.id ?? '' });
    seedProviderCatalog(db, { resetBindings: true });
    const geminiTts = new ProviderConfigsRepository(db).findByName('gemini-tts');
    expect(bindings.list().find((b) => b.capability === 'tts')?.providerConfigId).toBe(geminiTts?.id);
  });

  it('demo mode adds template-based channels and the fake provider, idempotently', () => {
    seedDatabase(db, { demo: true });
    const result = seedDatabase(db, { demo: true });
    expect(result.channels.length).toBeGreaterThan(0);
    expect(result.channels.every((c) => c.slug.startsWith('demo-'))).toBe(true);
    expect(db.select().from(channels).all()).toHaveLength(result.channels.length);
    expect(db.select().from(providerConfigs).all()).toHaveLength(6);
    expect(db.select().from(providerBindings).all()).toHaveLength(7);
  });

  it('templates are generic and IP-safe', () => {
    for (const t of CHANNEL_TEMPLATES) {
      expect(t.name).not.toMatch(/fe diaria|poké|pokemon/i);
      expect(t.defaults.bible).toBeTruthy();
    }
    const games = CHANNEL_TEMPLATES.find((t) => t.id === 'datos-videojuegos');
    expect(games?.defaults.visualStyle?.negativePrompt).toMatch(/derechos de autor/);
  });
});
