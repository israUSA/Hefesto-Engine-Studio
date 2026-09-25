import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretCipher } from './dpapi';

interface VaultEntry {
  blob: string;
  last4: string;
  updatedAt: string;
}

interface VaultFile {
  version: 1;
  secrets: Record<string, VaultEntry>;
}

export interface SecretInfo {
  name: string;
  /** Only the last 4 characters ever leave the vault. */
  last4: string;
  updatedAt: string;
  source: 'vault' | 'env';
}

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * API keys and tokens the user enters in the app. Stored encrypted (DPAPI) in
 * `HEFESTO_HOME/secrets.json`; decrypted once at startup and kept in memory.
 * `process.env` is a fallback for development, never the primary source.
 */
export class SecretVault {
  private readonly values = new Map<string, string>();
  private file: VaultFile = { version: 1, secrets: {} };

  constructor(
    private readonly path: string,
    private readonly cipher: SecretCipher,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async load(): Promise<void> {
    if (!existsSync(this.path)) return;
    this.file = JSON.parse(await readFile(this.path, 'utf8')) as VaultFile;
    const names = Object.keys(this.file.secrets);
    const plain = await this.cipher.decrypt(names.map((n) => this.file.secrets[n].blob));
    names.forEach((n, i) => this.values.set(n, plain[i]));
  }

  /** Vault first, then the environment. */
  get(name: string): string | undefined {
    return this.values.get(name) || this.env[name] || undefined;
  }

  has(name: string): boolean {
    return Boolean(this.get(name));
  }

  async set(name: string, value: string): Promise<void> {
    if (!NAME_PATTERN.test(name)) throw new Error(`Nombre de clave inválido: ${name}`);
    const trimmed = value.trim();
    if (!trimmed) throw new Error('La clave está vacía');
    const [blob] = await this.cipher.encrypt([trimmed]);
    this.file.secrets[name] = { blob, last4: trimmed.slice(-4), updatedAt: new Date().toISOString() };
    this.values.set(name, trimmed);
    await this.persist();
  }

  async remove(name: string): Promise<boolean> {
    if (!this.file.secrets[name]) return false;
    delete this.file.secrets[name];
    this.values.delete(name);
    await this.persist();
    return true;
  }

  list(extraNames: string[] = []): SecretInfo[] {
    const infos: SecretInfo[] = Object.entries(this.file.secrets).map(([name, e]) => ({
      name,
      last4: e.last4,
      updatedAt: e.updatedAt,
      source: 'vault',
    }));
    for (const name of extraNames) {
      const fromEnv = this.env[name];
      if (!this.file.secrets[name] && fromEnv) {
        infos.push({ name, last4: fromEnv.slice(-4), updatedAt: '', source: 'env' });
      }
    }
    return infos.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A read-only view with the `env[name]` shape the provider factories expect. */
  asEnv(): NodeJS.ProcessEnv {
    return new Proxy({} as NodeJS.ProcessEnv, {
      get: (_t, prop) => (typeof prop === 'string' ? this.get(prop) : undefined),
      has: (_t, prop) => typeof prop === 'string' && this.has(prop),
    });
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.file, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, this.path);
  }
}
