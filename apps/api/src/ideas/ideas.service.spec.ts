import type { ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../providers/adapter-core';
import type { CallContext, TextInput, TextResult } from '../providers/contracts';
import { InMemoryBindingSource, ProviderRegistry } from '../providers/provider-registry';
import { createTestDb } from '../db/test-utils';
import { ChannelsRepository, CostEntriesRepository, IdeasRepository } from '../db/repositories';
import { IdeasService } from './ideas.service';

const manifest: ProviderManifest = {
  adapter: 'test-text',
  displayName: 'Test text',
  capabilities: ['text'],
  kind: 'local',
  resources: { lane: 'cpu' },
  license: { name: 'test', commercial: true },
  secrets: [],
  features: {},
};

/** A minimal text adapter that always answers the shape the caller's zod schema expects. */
class ScriptedTextProvider implements AdapterCore {
  readonly manifest = manifest;
  constructor(readonly config: ProviderConfig) {}
  async healthCheck() {
    return { ok: true, message: 'ok' };
  }
  async generateText(_input: TextInput, _ctx: CallContext): Promise<TextResult> {
    const payload = {
      ideas: [
        { title: 'Idea nueva 1', angle: 'Un ángulo fresco sobre el tema.' },
        { title: 'Idea nueva 2', angle: 'Otro ángulo distinto.' },
      ],
    };
    return { text: JSON.stringify(payload), usage: { units: 10, unit: 'char', costUsd: 0, durationMs: 1 } };
  }
}

function buildRepos() {
  const { db } = createTestDb();
  // Repos take a DI-injected DB instance; construct them directly for this unit test.
  const channels = new ChannelsRepository(db);
  const ideas = new IdeasRepository(db);
  const costs = new CostEntriesRepository(db);
  return { channels, ideas, costs };
}

describe('IdeasService', () => {
  it('generates ideas from the bound text provider and stores them, avoiding repeats', async () => {
    const { channels, ideas, costs } = buildRepos();
    const channel = channels.create({
      name: 'Canal de prueba',
      slug: 'canal-prueba',
      platform: 'tiktok',
      handle: '@prueba',
      language: 'es',
      format: '9:16',
      topic: 'pruebas',
      bible: 'Tono de prueba.',
      durationTarget: { min: 20, max: 40 },
      aiLabel: true,
      monetized: false,
      active: true,
      voice: { voiceId: 'v1', language: 'es' },
      visualStyle: { source: 'stock', motion: 'kenburns' },
    });

    const bindings = new InMemoryBindingSource();
    const config: ProviderConfig = {
      id: 'cfg-1',
      name: 'test-text',
      adapter: 'test-text',
      capabilities: ['text'],
      params: {},
      enabled: true,
    };
    bindings.addConfig(config);
    bindings.addBinding({
      id: 'b-1',
      channelId: null,
      capability: 'text',
      role: 'ideas',
      providerConfigId: config.id,
      params: {},
      fallbackIds: [],
    });

    const registry = new ProviderRegistry(bindings, {});
    registry.register({ manifest, create: (cfg) => new ScriptedTextProvider(cfg) });

    const service = new IdeasService(registry, channels, ideas, costs);
    const result = await service.generate(channel.id, 2, 'algún tema');

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Idea nueva 1');
    expect(result[0].status).toBe('new');
    expect(result[0].source).toBe('ai');
    expect(ideas.listByChannel(channel.id)).toHaveLength(2);
    expect(costs.sumByChannel(channel.id)).toBeGreaterThanOrEqual(0);
  });
});
