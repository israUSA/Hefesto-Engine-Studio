import assert from 'node:assert/strict';
import type { ProviderManifest, Usage } from '@hefesto/shared-types';
import type { CallContext } from './contracts';

/**
 * Shared invariants every adapter manifest / `Usage` must satisfy, reused across
 * `*.spec.ts` files. Uses `node:assert` (not jest's `expect`) so this file compiles
 * under `tsconfig.app.json` too (it isn't excluded like `*.spec.ts` files are).
 */
export function expectValidManifest(manifest: ProviderManifest): void {
  assert.equal(typeof manifest.adapter, 'string');
  assert.ok(manifest.adapter.length > 0);
  assert.ok(manifest.capabilities.length > 0);
  assert.ok(['cloud', 'local', 'manual'].includes(manifest.kind));
  assert.ok(['gpu', 'net', 'cpu'].includes(manifest.resources.lane));
  assert.equal(typeof manifest.license.commercial, 'boolean');
  assert.ok(Array.isArray(manifest.secrets));
}

export function expectValidUsage(usage: Usage): void {
  assert.ok(usage.units >= 0);
  assert.ok(['char', 'token', 'image', 'second', 'request'].includes(usage.unit));
  assert.ok(usage.costUsd >= 0);
  assert.ok(Number.isFinite(usage.costUsd));
  assert.ok(usage.durationMs >= 0);
}

export function testCallContext(overrides: Partial<CallContext> = {}): CallContext {
  return { channelId: 'channel-test', ...overrides };
}
