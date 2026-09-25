import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dpapiCipher, type SecretCipher } from './dpapi';
import { SecretVault } from './secret-vault';

/** Reversible stand-in for DPAPI so the vault logic runs on any OS. */
const fakeCipher: SecretCipher = {
  encrypt: async (p) => p.map((s) => `enc:${Buffer.from(s).toString('base64')}`),
  decrypt: async (b) => b.map((s) => Buffer.from(s.slice(4), 'base64').toString()),
};

const vaultPath = () => join(mkdtempSync(join(tmpdir(), 'hefesto-vault-')), 'secrets.json');

describe('SecretVault', () => {
  it('stores keys encrypted and reloads them', async () => {
    const path = vaultPath();
    const vault = new SecretVault(path, fakeCipher, {});
    await vault.set('GEMINI_API_KEY', '  AIzaTEST1234  ');

    const onDisk = readFileSync(path, 'utf8');
    expect(onDisk).not.toContain('AIzaTEST1234');
    expect(JSON.parse(onDisk).secrets.GEMINI_API_KEY.last4).toBe('1234');

    const reloaded = new SecretVault(path, fakeCipher, {});
    await reloaded.load();
    expect(reloaded.get('GEMINI_API_KEY')).toBe('AIzaTEST1234');
  });

  it('prefers the vault over the environment and falls back to it', async () => {
    const vault = new SecretVault(vaultPath(), fakeCipher, { PEXELS_API_KEY: 'from-env', GEMINI_API_KEY: 'env-gem' });
    await vault.set('GEMINI_API_KEY', 'vault-gem');
    expect(vault.get('GEMINI_API_KEY')).toBe('vault-gem');
    expect(vault.get('PEXELS_API_KEY')).toBe('from-env');
    expect(vault.asEnv()['GEMINI_API_KEY']).toBe('vault-gem');
    expect(vault.asEnv()['MISSING']).toBeUndefined();
  });

  it('lists only the last 4 characters and removes keys', async () => {
    const vault = new SecretVault(vaultPath(), fakeCipher, { PEXELS_API_KEY: 'abcdefgh' });
    await vault.set('GEMINI_API_KEY', 'secret-9876');
    expect(vault.list(['PEXELS_API_KEY'])).toEqual([
      expect.objectContaining({ name: 'GEMINI_API_KEY', last4: '9876', source: 'vault' }),
      expect.objectContaining({ name: 'PEXELS_API_KEY', last4: 'efgh', source: 'env' }),
    ]);
    expect(JSON.stringify(vault.list())).not.toContain('secret-9876');
    expect(await vault.remove('GEMINI_API_KEY')).toBe(true);
    expect(vault.get('GEMINI_API_KEY')).toBeUndefined();
  });

  it('rejects invalid names and empty values', async () => {
    const vault = new SecretVault(vaultPath(), fakeCipher, {});
    await expect(vault.set('bad name', 'x')).rejects.toThrow(/inválido/);
    await expect(vault.set('GEMINI_API_KEY', '   ')).rejects.toThrow(/vacía/);
  });

  (process.platform === 'win32' ? it : it.skip)('round-trips through real Windows DPAPI', async () => {
    const [blob] = await dpapiCipher.encrypt(['clave-ñ-ü-🔑']);
    expect(blob).not.toContain('clave');
    expect(await dpapiCipher.decrypt([blob])).toEqual(['clave-ñ-ü-🔑']);
  }, 30000);
});
