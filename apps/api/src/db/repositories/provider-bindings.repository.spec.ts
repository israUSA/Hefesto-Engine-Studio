import type Database from 'better-sqlite3';
import type { DbInstance } from '../migrate';
import { createTestDb } from '../test-utils';
import { ChannelsRepository } from './channels.repository';
import { ProviderConfigsRepository } from './provider-configs.repository';
import { ProviderBindingsRepository } from './provider-bindings.repository';

describe('ProviderBindingsRepository.resolve', () => {
  let db: DbInstance;
  let sqlite: Database.Database;
  let channelsRepo: ChannelsRepository;
  let configsRepo: ProviderConfigsRepository;
  let bindingsRepo: ProviderBindingsRepository;

  beforeEach(() => {
    ({ db, sqlite } = createTestDb());
    channelsRepo = new ChannelsRepository(db);
    configsRepo = new ProviderConfigsRepository(db);
    bindingsRepo = new ProviderBindingsRepository(db);
  });

  afterEach(() => sqlite.close());

  function makeChannel(slug: string) {
    return channelsRepo.create({
      name: slug,
      slug,
      platform: 'tiktok',
      handle: `@${slug}`,
      language: 'es',
      format: '9:16',
      topic: 'test',
      bible: 'test',
      durationTarget: { min: 30, max: 60 },
      aiLabel: true,
      monetized: false,
      active: true,
      voice: { voiceId: 'Kore', language: 'es' },
      visualStyle: { source: 'stock', motion: 'kenburns' },
    });
  }

  it('falls back to the global binding when the channel has none of its own', () => {
    const channel = makeChannel('canal-a');
    const geminiFlash = configsRepo.create({
      name: 'gemini-flash',
      adapter: 'gemini',
      capabilities: ['text'],
      params: {},
      enabled: true,
    });
    bindingsRepo.create({
      channelId: null,
      capability: 'text',
      role: 'script',
      providerConfigId: geminiFlash.id,
      params: {},
      fallbackIds: [],
    });

    const resolved = bindingsRepo.resolve(channel.id, 'text', 'script');
    expect(resolved?.providerConfigId).toBe(geminiFlash.id);
    expect(resolved?.channelId).toBeNull();
  });

  it('prefers a channel-specific binding over the global one', () => {
    const channel = makeChannel('canal-b');
    const geminiFlash = configsRepo.create({
      name: 'gemini-flash',
      adapter: 'gemini',
      capabilities: ['text'],
      params: {},
      enabled: true,
    });
    const elevenLabsLikeText = configsRepo.create({
      name: 'better-for-this-channel',
      adapter: 'openai-compatible',
      capabilities: ['text'],
      params: {},
      enabled: true,
    });
    bindingsRepo.create({
      channelId: null,
      capability: 'text',
      role: 'script',
      providerConfigId: geminiFlash.id,
      params: {},
      fallbackIds: [],
    });
    bindingsRepo.create({
      channelId: channel.id,
      capability: 'text',
      role: 'script',
      providerConfigId: elevenLabsLikeText.id,
      params: {},
      fallbackIds: [],
    });

    const resolved = bindingsRepo.resolve(channel.id, 'text', 'script');
    expect(resolved?.providerConfigId).toBe(elevenLabsLikeText.id);
    expect(resolved?.channelId).toBe(channel.id);
  });

  it('does not mix up bindings between different text roles', () => {
    const channel = makeChannel('canal-c');
    const ideasConfig = configsRepo.create({
      name: 'ideas-provider',
      adapter: 'gemini',
      capabilities: ['text'],
      params: {},
      enabled: true,
    });
    const scriptConfig = configsRepo.create({
      name: 'script-provider',
      adapter: 'gemini',
      capabilities: ['text'],
      params: {},
      enabled: true,
    });
    bindingsRepo.create({
      channelId: null,
      capability: 'text',
      role: 'ideas',
      providerConfigId: ideasConfig.id,
      params: {},
      fallbackIds: [],
    });
    bindingsRepo.create({
      channelId: null,
      capability: 'text',
      role: 'script',
      providerConfigId: scriptConfig.id,
      params: {},
      fallbackIds: [],
    });

    expect(bindingsRepo.resolve(channel.id, 'text', 'ideas')?.providerConfigId).toBe(ideasConfig.id);
    expect(bindingsRepo.resolve(channel.id, 'text', 'script')?.providerConfigId).toBe(scriptConfig.id);
  });

  it('returns undefined when nothing matches (no global, no channel binding)', () => {
    const channel = makeChannel('canal-d');
    expect(bindingsRepo.resolve(channel.id, 'tts')).toBeUndefined();
  });

  it('resolves capability-only bindings (no role) such as tts and stock', () => {
    const channel = makeChannel('canal-e');
    const ttsConfig = configsRepo.create({
      name: 'gemini-tts',
      adapter: 'gemini',
      capabilities: ['tts'],
      params: {},
      enabled: true,
    });
    bindingsRepo.create({
      channelId: null,
      capability: 'tts',
      providerConfigId: ttsConfig.id,
      params: {},
      fallbackIds: [],
    });

    expect(bindingsRepo.resolve(channel.id, 'tts')?.providerConfigId).toBe(ttsConfig.id);
  });
});
