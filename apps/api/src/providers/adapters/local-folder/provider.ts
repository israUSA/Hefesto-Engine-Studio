import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { HealthResult, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type { CallContext, PutOptions, StorageLocation, StoredFile } from '../../contracts';
import { ProviderError } from '../../contracts';
import { computeUsage } from '../../cost';
import { APP_FOLDER, md5File, remoteSegments } from '../../storage-util';
import { localFolderManifest } from './manifest';

/**
 * Archives into a folder: an external disk, a NAS share or a folder synced by
 * "Google Drive para escritorio". `config.params.root` is the chosen folder; files go
 * under `<root>/Hefesto Engine Studio/`. The remote id is the path relative to that.
 */
export class LocalFolderProvider implements AdapterCore {
  readonly manifest: ProviderManifest = localFolderManifest;

  constructor(readonly config: ProviderConfig) {}

  private base(): string {
    const root = this.config.params['root'];
    if (typeof root !== 'string' || !root.trim() || !isAbsolute(root.trim())) {
      throw new ProviderError('Elegí una carpeta (ruta completa) para archivar en Drive → Almacenamiento', 'local-folder', false);
    }
    return join(resolve(root.trim()), APP_FOLDER);
  }

  private pathFor(remotePath: string): string {
    const base = this.base();
    const target = resolve(base, ...remoteSegments(remotePath, 'local-folder'));
    if (!target.startsWith(base + sep)) throw new ProviderError(`Ruta remota inválida: ${remotePath}`, 'local-folder', false);
    return target;
  }

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const base = this.base();
      await mkdir(base, { recursive: true });
      const probe = join(base, `.hefesto-${process.pid}.tmp`);
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return { ok: true, message: `Se puede escribir en ${base}`, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async put(localPath: string, remotePath: string, ctx: CallContext, opts: PutOptions = {}) {
    const started = Date.now();
    const target = this.pathFor(remotePath);
    const { size } = await stat(localPath);
    await mkdir(dirname(target), { recursive: true });

    let sent = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        sent += chunk.length;
        opts.onProgress?.(sent, size);
        done(null, chunk);
      },
    });
    const part = `${target}.part`;
    try {
      await pipeline(createReadStream(localPath), counter, createWriteStream(part), { signal: ctx.signal });
      await rename(part, target);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }

    const file: StoredFile = { remoteId: remotePath, remotePath, sizeBytes: size, md5: await md5File(target) };
    return {
      file,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'request', durationMs: Date.now() - started }),
    };
  }

  async get(remoteId: string, localPath: string, ctx: CallContext) {
    const started = Date.now();
    const source = this.pathFor(remoteId);
    if (!existsSync(source)) throw new ProviderError(`No está en la carpeta de archivo: ${remoteId}`, 'local-folder', false);
    await mkdir(dirname(localPath), { recursive: true });
    const part = `${localPath}.part`;
    try {
      await pipeline(createReadStream(source), createWriteStream(part), { signal: ctx.signal });
      await rename(part, localPath);
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
    return {
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'request', durationMs: Date.now() - started }),
    };
  }

  async exists(remotePath: string): Promise<StoredFile | null> {
    const target = this.pathFor(remotePath);
    if (!existsSync(target)) return null;
    const { size } = await stat(target);
    return { remoteId: remotePath, remotePath, sizeBytes: size, md5: await md5File(target) };
  }

  async list(): Promise<StoredFile[]> {
    const base = this.base();
    if (!existsSync(base)) return [];
    const out: StoredFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && !entry.name.endsWith('.part') && !entry.name.startsWith('.hefesto-')) {
          const remotePath = relative(base, full).split(sep).join('/');
          out.push({ remoteId: remotePath, remotePath, sizeBytes: (await stat(full)).size });
        }
      }
    };
    await walk(base);
    return out;
  }

  async location(): Promise<StorageLocation> {
    return { root: this.base() };
  }
}
