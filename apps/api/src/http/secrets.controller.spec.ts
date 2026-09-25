import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SecretCipher } from '../secrets/dpapi';
import { SecretVault } from '../secrets/secret-vault';
import { createTestDb } from '../db/test-utils';
import { ProviderConfigsRepository } from '../db/repositories';
import { InMemoryBindingSource, ProviderRegistry } from '../providers/provider-registry';
import { SecretsController } from './secrets.controller';

/** Identity cipher: no real encryption, so tests don't depend on Windows DPAPI. */
const identityCipher: SecretCipher = {
  encrypt: async (items) => items,
  decrypt: async (items) => items,
};

function buildController() {
  const dir = mkdtempSync(join(tmpdir(), 'hefesto-secrets-'));
  const vault = new SecretVault(join(dir, 'secrets.json'), identityCipher, {});
  const { db } = createTestDb();
  const configs = new ProviderConfigsRepository(db);
  const registry = new ProviderRegistry(new InMemoryBindingSource(), {});
  const controller = new SecretsController(vault, registry, configs);
  return { controller, vault, dir };
}

describe('SecretsController', () => {
  it('never returns the secret value, only last4 and metadata', async () => {
    const { controller, dir } = buildController();
    try {
      await controller.put('GEMINI_API_KEY', { value: 'sk-super-secret-value-123456' });

      const list = controller.list();
      expect(list).toHaveLength(1);
      const entry = list[0];
      expect(entry.name).toBe('GEMINI_API_KEY');
      expect(entry.last4).toBe('3456');
      expect(JSON.stringify(entry)).not.toContain('sk-super-secret-value-123456');

      const putResult = await controller.put('GEMINI_API_KEY', { value: 'another-value-000999' });
      expect(JSON.stringify(putResult)).not.toContain('another-value-000999');
      expect(putResult.last4).toBe('0999');

      await controller.remove('GEMINI_API_KEY');
      expect(controller.list()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
