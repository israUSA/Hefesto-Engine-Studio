import type { ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import { computeUsage } from './cost';

function manifest(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    adapter: 'stub',
    displayName: 'Stub',
    capabilities: ['text'],
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
    id: 'cfg',
    name: 'Config',
    adapter: 'stub',
    capabilities: ['text'],
    params: {},
    enabled: true,
    ...overrides,
  };
}

describe('computeUsage', () => {
  it('reports $0 for local adapters, but a real durationMs', () => {
    const usage = computeUsage({
      manifest: manifest({ kind: 'local', pricing: { unit: 'token', usdPerUnit: 999 } }),
      config: config(),
      units: 1000,
      unit: 'token',
      durationMs: 250,
    });
    expect(usage.costUsd).toBe(0);
    expect(usage.durationMs).toBe(250);
    expect(usage.units).toBe(1000);
  });

  it('multiplies units by manifest pricing for cloud adapters', () => {
    const usage = computeUsage({
      manifest: manifest({ pricing: { unit: 'token', usdPerUnit: 0.000001 } }),
      config: config(),
      units: 1000,
      unit: 'token',
      durationMs: 10,
    });
    expect(usage.costUsd).toBeCloseTo(0.001, 6);
  });

  it('prefers config.pricingOverride over manifest.pricing', () => {
    const usage = computeUsage({
      manifest: manifest({ pricing: { unit: 'token', usdPerUnit: 1 } }),
      config: config({ pricingOverride: { unit: 'token', usdPerUnit: 0.5 } }),
      units: 10,
      unit: 'token',
      durationMs: 10,
    });
    expect(usage.costUsd).toBe(5);
  });

  it('returns $0 when pricing unit does not match the call unit, instead of guessing', () => {
    const usage = computeUsage({
      manifest: manifest({ pricing: { unit: 'char', usdPerUnit: 1 } }),
      config: config(),
      units: 10,
      unit: 'token',
      durationMs: 10,
    });
    expect(usage.costUsd).toBe(0);
  });

  it('returns $0 when the cloud manifest has no pricing at all', () => {
    const usage = computeUsage({ manifest: manifest({ pricing: undefined }), config: config(), units: 10, unit: 'token', durationMs: 5 });
    expect(usage.costUsd).toBe(0);
  });
});
