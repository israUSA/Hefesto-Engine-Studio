import type { ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from './adapter-core';
import type { ProviderFactory } from './contracts';
import { ProviderError } from './contracts';
import { InMemoryBindingSource, ProviderRegistry } from './provider-registry';
import { testCallContext } from './contract.spec-helper';

function manifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    adapter: 'stub',
    displayName: 'Stub',
    capabilities: ['text'],
    kind: 'cloud',
    resources: { lane: 'net' },
    license: { name: 'Stub license', commercial: true },
    secrets: [],
    features: {},
    ...overrides,
  };
}

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'cfg-1',
    name: 'Stub config',
    adapter: 'stub',
    capabilities: ['text'],
    params: {},
    enabled: true,
    ...overrides,
  };
}

function stubFactory(overrides: Partial<ProviderManifest> = {}): ProviderFactory {
  const m = manifest(overrides);
  return {
    manifest: m,
    create: (cfg: ProviderConfig): AdapterCore => ({
      manifest: m,
      config: cfg,
      healthCheck: async () => ({ ok: true, message: 'ok' }),
      generateText: async (input) => ({
        text: `echo:${input.prompt}`,
        usage: { units: 1, unit: 'token', costUsd: 0, durationMs: 1 },
      }),
    }),
  };
}

describe('ProviderRegistry', () => {
  it('resolves a channel binding and calls through to the adapter', async () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config());
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    const { provider, config: resolvedConfig } = registry.resolve('text', { channelId: 'ch-1' });
    expect(resolvedConfig.id).toBe('cfg-1');
    const result = await provider.generate({ prompt: 'hola' }, testCallContext());
    expect(result.text).toBe('echo:hola');
  });

  it('prefers a channel-specific binding over the global default', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'global' }));
    bindings.addConfig(config({ id: 'channel-specific' }));
    bindings.addBinding({ id: 'b-global', channelId: null, capability: 'text', providerConfigId: 'global', params: {}, fallbackIds: [] });
    bindings.addBinding({ id: 'b-ch', channelId: 'ch-1', capability: 'text', providerConfigId: 'channel-specific', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    const { config: resolved } = registry.resolve('text', { channelId: 'ch-1' });
    expect(resolved.id).toBe('channel-specific');
  });

  it('throws when no binding exists for the capability', () => {
    const bindings = new InMemoryBindingSource();
    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).toThrow(ProviderError);
  });

  it('throws when the config is disabled', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ enabled: false }));
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).toThrow(/deshabilitado/);
  });

  it('throws when the config does not declare the requested capability', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ capabilities: ['stock'] }));
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).toThrow(/no declara la capacidad/);
  });

  it('throws a clear error naming the missing secret env var', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ secretRef: 'STUB_API_KEY' }));
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, {});
    registry.register(stubFactory());

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).toThrow(/STUB_API_KEY/);
  });

  it('blocks a non-commercial provider on a monetized channel (ADR-008)', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config());
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });
    bindings.setMonetized('ch-1', true);

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory({ license: { name: 'Non-commercial', commercial: false } }));

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).toThrow(/ADR-008/);
  });

  it('allows a non-commercial provider on a non-monetized channel', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config());
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory({ license: { name: 'Non-commercial', commercial: false } }));

    expect(() => registry.resolve('text', { channelId: 'ch-1' })).not.toThrow();
  });

  it('caches provider instances per config id', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config());
    bindings.addBinding({ id: 'b1', channelId: null, capability: 'text', providerConfigId: 'cfg-1', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    let creations = 0;
    const factory = stubFactory();
    const wrapped: ProviderFactory = {
      manifest: factory.manifest,
      create: (cfg: ProviderConfig, env: NodeJS.ProcessEnv) => {
        creations++;
        return factory.create(cfg, env);
      },
    };
    registry.register(wrapped);

    registry.resolve('text', { channelId: 'ch-1' });
    registry.resolve('text', { channelId: 'ch-1' });
    expect(creations).toBe(1);

    registry.invalidate('cfg-1');
    registry.resolve('text', { channelId: 'ch-1' });
    expect(creations).toBe(2);
  });

  it('resolves text roles independently (ideas vs script)', () => {
    const bindings = new InMemoryBindingSource();
    bindings.addConfig(config({ id: 'cheap' }));
    bindings.addConfig(config({ id: 'best' }));
    bindings.addBinding({ id: 'b-ideas', channelId: null, capability: 'text', role: 'ideas', providerConfigId: 'cheap', params: {}, fallbackIds: [] });
    bindings.addBinding({ id: 'b-script', channelId: null, capability: 'text', role: 'script', providerConfigId: 'best', params: {}, fallbackIds: [] });

    const registry = new ProviderRegistry(bindings, { ...process.env });
    registry.register(stubFactory());

    expect(registry.resolve('text', { channelId: 'ch-1', role: 'ideas' }).config.id).toBe('cheap');
    expect(registry.resolve('text', { channelId: 'ch-1', role: 'script' }).config.id).toBe('best');
  });
});
