import type { ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from './adapter-core';
import type { ProviderFactory } from './contracts';
import { ProviderError } from './contracts';
import { InMemoryBindingSource, ProviderRegistry } from './provider-registry';
import { callWithFallback } from './with-fallback';
import { testCallContext } from './contract.spec-helper';

function manifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    adapter: 'stub',
    displayName: 'Stub',
    capabilities: ['text', 'tts'],
    kind: 'cloud',
    resources: { lane: 'net' },
    license: { name: 'Stub', commercial: true },
    secrets: [],
    features: {},
    ...overrides,
  };
}

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'primary',
    name: 'Primary',
    adapter: 'stub',
    capabilities: ['text', 'tts'],
    params: {},
    enabled: true,
    ...overrides,
  };
}

/** A factory whose instance always fails for `failingIds`, and succeeds otherwise. */
function stubFactory(failingIds: Set<string>, calls: string[]): ProviderFactory {
  const m = manifest();
  return {
    manifest: m,
    create: (cfg: ProviderConfig): AdapterCore => ({
      manifest: m,
      config: cfg,
      healthCheck: async () => ({ ok: true, message: 'ok' }),
      generateText: async () => {
        calls.push(cfg.id);
        if (failingIds.has(cfg.id)) {
          throw new ProviderError('falla simulada', 'stub', true);
        }
        return { text: `ok:${cfg.id}`, usage: { units: 1, unit: 'token', costUsd: 0, durationMs: 1 } };
      },
      synthesize: async () => {
        calls.push(cfg.id);
        if (failingIds.has(cfg.id)) {
          throw new ProviderError('falla simulada', 'stub', true);
        }
        return { audioPath: '/tmp/x.wav', durationMs: 100, usage: { units: 1, unit: 'char', costUsd: 0, durationMs: 1 } };
      },
      listVoices: async () => [],
    }),
  };
}

describe('callWithFallback', () => {
  it('falls back to the next provider when the primary fails retryably (text)', async () => {
    const calls: string[] = [];
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'primary' }));
    bindings.addConfig(config({ id: 'backup' }));
    bindings.addBinding({
      id: 'b1',
      channelId: null,
      capability: 'text',
      providerConfigId: 'primary',
      params: {},
      fallbackIds: ['backup'],
    });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory(new Set(['primary']), calls));

    const { result, servedBy } = await callWithFallback(registry, 'text', { channelId: 'ch-1' }, (p) =>
      p.provider.generate({ prompt: 'hola' }, testCallContext()),
    );

    expect(result.text).toBe('ok:backup');
    expect(servedBy.configId).toBe('backup');
    expect(servedBy.fallbackIndex).toBe(1);
    expect(calls).toEqual(['primary', 'backup']);
  });

  it('does not fall back for tts by default, even if a fallback is configured', async () => {
    const calls: string[] = [];
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'primary', capabilities: ['tts'] }));
    bindings.addConfig(config({ id: 'backup', capabilities: ['tts'] }));
    bindings.addBinding({
      id: 'b1',
      channelId: null,
      capability: 'tts',
      providerConfigId: 'primary',
      params: {},
      fallbackIds: ['backup'],
    });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory(new Set(['primary']), calls));

    await expect(
      callWithFallback(registry, 'tts', { channelId: 'ch-1' }, (p) =>
        p.provider.synthesize({ text: 'hola', voiceId: 'v1', language: 'es', outPath: '/tmp/x.wav' }, testCallContext()),
      ),
    ).rejects.toThrow(ProviderError);
    expect(calls).toEqual(['primary']);
  });

  it('allows tts fallback when the binding explicitly sets allowFallback: true', async () => {
    const calls: string[] = [];
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'primary', capabilities: ['tts'] }));
    bindings.addConfig(config({ id: 'backup', capabilities: ['tts'] }));
    bindings.addBinding({
      id: 'b1',
      channelId: null,
      capability: 'tts',
      providerConfigId: 'primary',
      params: { allowFallback: true },
      fallbackIds: ['backup'],
    });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory(new Set(['primary']), calls));

    const { servedBy } = await callWithFallback(registry, 'tts', { channelId: 'ch-1' }, (p) =>
      p.provider.synthesize({ text: 'hola', voiceId: 'v1', language: 'es', outPath: '/tmp/x.wav' }, testCallContext()),
    );
    expect(servedBy.configId).toBe('backup');
  });

  it('does not fall back for a non-retryable error', async () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'primary' }));
    bindings.addConfig(config({ id: 'backup' }));
    bindings.addBinding({
      id: 'b1',
      channelId: null,
      capability: 'text',
      providerConfigId: 'primary',
      params: {},
      fallbackIds: ['backup'],
    });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    const m = manifest();
    registry.register({
      manifest: m,
      create: (cfg: ProviderConfig): AdapterCore => ({
        manifest: m,
        config: cfg,
        healthCheck: async () => ({ ok: true, message: 'ok' }),
        generateText: async () => {
          throw new ProviderError('error fatal', 'stub', false);
        },
      }),
    });

    await expect(
      callWithFallback(registry, 'text', { channelId: 'ch-1' }, (p) => p.provider.generate({ prompt: 'x' }, testCallContext())),
    ).rejects.toThrow(/error fatal/);
  });

  it('reports which provider served the call when the primary succeeds', async () => {
    const calls: string[] = [];
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'primary' }));
    bindings.addBinding({
      id: 'b1',
      channelId: null,
      capability: 'text',
      providerConfigId: 'primary',
      params: {},
      fallbackIds: [],
    });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory(new Set(), calls));

    const { servedBy } = await callWithFallback(registry, 'text', { channelId: 'ch-1' }, (p) =>
      p.provider.generate({ prompt: 'x' }, testCallContext()),
    );
    expect(servedBy).toEqual({ configId: 'primary', adapter: 'stub', name: 'Primary', fallbackIndex: 0 });
  });
});
