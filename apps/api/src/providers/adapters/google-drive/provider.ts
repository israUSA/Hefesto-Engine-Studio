import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { HealthResult, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type { CallContext, PutOptions, StorageLocation, StoredFile } from '../../contracts';
import { ProviderError } from '../../contracts';
import { computeUsage } from '../../cost';
import { httpStatusToProviderError, withBackoff } from '../../retry';
import { APP_FOLDER, md5File, mimeTypeFor, remoteSegments } from '../../storage-util';
import { GOOGLE_SECRETS, googleDriveManifest } from './manifest';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,size,md5Checksum';
/** Resumable chunks must be multiples of 256 KiB. */
const CHUNK_BYTES = 32 * 256 * 1024;
const MAX_RESUMES = 5;

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
}

/** Escapes a value for a Drive `q` string literal. */
function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Google Drive through its REST API (no SDK), with the `drive.file` scope: it only sees
 * the folders and files it created under "Hefesto Engine Studio/". Uploads are resumable
 * in 8 MiB chunks and resume from the last byte Drive confirmed after a network error.
 */
export class GoogleDriveProvider implements AdapterCore {
  readonly manifest: ProviderManifest = googleDriveManifest;
  private access?: { token: string; expiresAt: number };
  private readonly folders = new Map<string, string>();

  constructor(
    readonly config: ProviderConfig,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  // ── Auth ──────────────────────────────────────────────────────────────

  private secret(name: string): string {
    const value = this.env[name];
    if (!value) {
      const hint =
        name === GOOGLE_SECRETS.refreshToken ? 'conectá tu cuenta de Google' : 'cargá el cliente OAuth de Google';
      throw new ProviderError(`Falta ${name}: ${hint} en Ajustes → Cuentas y OAuth`, 'google-drive', false);
    }
    return value;
  }

  private async token(signal?: AbortSignal): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const body = new URLSearchParams({
      client_id: this.secret(GOOGLE_SECRETS.clientId),
      client_secret: this.secret(GOOGLE_SECRETS.clientSecret),
      refresh_token: this.secret(GOOGLE_SECRETS.refreshToken),
      grant_type: 'refresh_token',
    });
    const res = await fetch(TOKEN_URL, { method: 'POST', body, signal });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      if (detail.error === 'invalid_grant') {
        throw new ProviderError(
          'El acceso a Google Drive venció o fue revocado: reconectá la cuenta en Ajustes → Cuentas y OAuth',
          'google-drive',
          false,
        );
      }
      throw httpStatusToProviderError(res.status, 'google-drive', `No se pudo renovar el acceso a Google (HTTP ${res.status})`);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.access = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return json.access_token;
  }

  /** Authorized request with retries; a 401 renews the access token once. */
  private async request(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
    return withBackoff(
      async () => {
        let res = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await this.token(init.signal)}` } });
        if (res.status === 401) {
          this.access = undefined;
          res = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await this.token(init.signal)}` } });
        }
        if (!res.ok && res.status !== 308) {
          const text = await res.text().catch(() => '');
          throw httpStatusToProviderError(res.status, 'google-drive', `Drive: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
        }
        return res;
      },
      { signal: init.signal },
    );
  }

  private async json<T>(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
    return (await (await this.request(url, init)).json()) as T;
  }

  // ── Folders ───────────────────────────────────────────────────────────

  private async children(parentId: string, extra: string, signal?: AbortSignal): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${API}/files`);
      url.searchParams.set('q', `${q(parentId)} in parents and trashed = false${extra}`);
      url.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS},mimeType)`);
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('spaces', 'drive');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(url.toString(), { signal });
      out.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Id of the folder at `segments` (below "My Drive"); creates the missing ones when `create`. */
  private async folder(segments: string[], create: boolean, signal?: AbortSignal): Promise<string | null> {
    let parent = 'root';
    let path = '';
    for (const name of segments) {
      path += `/${name}`;
      const cached = this.folders.get(path);
      if (cached) {
        parent = cached;
        continue;
      }
      const found = await this.children(parent, ` and name = ${q(name)} and mimeType = ${q(FOLDER_MIME)}`, signal);
      let id = found[0]?.id;
      if (!id) {
        if (!create) return null;
        const created = await this.json<DriveFile>(`${API}/files?fields=id`, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
          signal,
        });
        id = created.id;
      }
      this.folders.set(path, id);
      parent = id;
    }
    return parent;
  }

  private async findFile(folderId: string, name: string, signal?: AbortSignal): Promise<DriveFile | undefined> {
    const files = await this.children(folderId, ` and name = ${q(name)} and mimeType != ${q(FOLDER_MIME)}`, signal);
    return files[0];
  }

  private stored(file: DriveFile, remotePath: string): StoredFile {
    return { remoteId: file.id, remotePath, sizeBytes: Number(file.size ?? 0), md5: file.md5Checksum };
  }

  // ── StorageProvider ───────────────────────────────────────────────────

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const about = await this.account();
      return { ok: true, message: `Conectado como ${about.email ?? 'cuenta de Google'}`, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Account e-mail and Drive quota (bytes). */
  async account(): Promise<{ email?: string; usedBytes?: number; limitBytes?: number }> {
    const about = await this.json<{ user?: { emailAddress?: string }; storageQuota?: { usage?: string; limit?: string } }>(
      `${API}/about?fields=user(emailAddress),storageQuota(usage,limit)`,
    );
    return {
      email: about.user?.emailAddress,
      usedBytes: about.storageQuota?.usage ? Number(about.storageQuota.usage) : undefined,
      limitBytes: about.storageQuota?.limit ? Number(about.storageQuota.limit) : undefined,
    };
  }

  async put(localPath: string, remotePath: string, ctx: CallContext, opts: PutOptions = {}) {
    const started = Date.now();
    const segments = remoteSegments(remotePath, 'google-drive');
    const name = segments.pop() as string;
    const folderId = (await this.folder([APP_FOLDER, ...segments], true, ctx.signal)) as string;
    const existing = await this.findFile(folderId, name, ctx.signal);
    const { size } = await stat(localPath);
    const mimeType = opts.mimeType ?? mimeTypeFor(localPath);

    // Replacing keeps the same file id (and any link to it); a new file goes in its folder.
    const init = await this.request(
      existing
        ? `${UPLOAD_API}/files/${existing.id}?uploadType=resumable&fields=${FILE_FIELDS}`
        : `${UPLOAD_API}/files?uploadType=resumable&fields=${FILE_FIELDS}`,
      {
        method: existing ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': mimeType,
          'x-upload-content-length': String(size),
        },
        body: JSON.stringify(existing ? {} : { name, parents: [folderId] }),
        signal: ctx.signal,
      },
    );
    const session = init.headers.get('location');
    if (!session) throw new ProviderError('Drive no devolvió la sesión de subida', 'google-drive', true);

    const uploaded = await this.upload(session, localPath, size, mimeType, ctx.signal, opts.onProgress);
    const localMd5 = await md5File(localPath);
    if (uploaded.md5Checksum && uploaded.md5Checksum !== localMd5) {
      throw new ProviderError(`El checksum de ${name} en Drive no coincide con el local`, 'google-drive', true);
    }
    return {
      file: this.stored(uploaded, remotePath),
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'request', durationMs: Date.now() - started }),
    };
  }

  /** Sends the file in chunks to a resumable session; after a failure asks Drive where to resume. */
  private async upload(
    session: string,
    localPath: string,
    size: number,
    mimeType: string,
    signal?: AbortSignal,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<DriveFile> {
    const handle = await open(localPath, 'r');
    try {
      let offset = 0;
      let resumes = 0;
      for (;;) {
        signal?.throwIfAborted();
        const length = Math.min(CHUNK_BYTES, size - offset);
        const chunk = Buffer.alloc(length);
        if (length > 0) await handle.read(chunk, 0, length, offset);
        const range = size === 0 ? 'bytes */0' : `bytes ${offset}-${offset + length - 1}/${size}`;

        let res: Response;
        try {
          res = await fetch(session, {
            method: 'PUT',
            headers: { 'content-type': mimeType, 'content-range': range },
            body: chunk,
            signal,
          });
          if (res.status >= 500 || res.status === 429) throw httpStatusToProviderError(res.status, 'google-drive', `HTTP ${res.status}`);
        } catch (err) {
          if (signal?.aborted || ++resumes > MAX_RESUMES) throw err;
          offset = await this.confirmedOffset(session, size, signal);
          continue;
        }

        if (res.status === 308) {
          offset = rangeEnd(res.headers.get('range'));
          onProgress?.(offset, size);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (res.status === 404 || res.status === 410) {
            throw new ProviderError('La sesión de subida a Drive expiró: se reintenta desde cero', 'google-drive', true);
          }
          throw httpStatusToProviderError(res.status, 'google-drive', `Drive: HTTP ${res.status} ${text.slice(0, 200)}`.trim());
        }
        onProgress?.(size, size);
        return (await res.json()) as DriveFile;
      }
    } finally {
      await handle.close();
    }
  }

  private async confirmedOffset(session: string, size: number, signal?: AbortSignal): Promise<number> {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(session, { method: 'PUT', headers: { 'content-range': `bytes */${size}` }, signal });
    if (res.status === 308) return rangeEnd(res.headers.get('range'));
    if (res.ok) return size;
    throw httpStatusToProviderError(res.status, 'google-drive', `Drive: no se pudo retomar la subida (HTTP ${res.status})`);
  }

  async get(remoteId: string, localPath: string, ctx: CallContext) {
    const started = Date.now();
    const res = await this.request(`${API}/files/${encodeURIComponent(remoteId)}?alt=media`, { signal: ctx.signal });
    if (!res.body) throw new ProviderError('Drive devolvió un archivo vacío', 'google-drive', true);
    await mkdir(dirname(localPath), { recursive: true });
    const part = `${localPath}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(part), { signal: ctx.signal });
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
    const segments = remoteSegments(remotePath, 'google-drive');
    const name = segments.pop() as string;
    const folderId = await this.folder([APP_FOLDER, ...segments], false);
    if (!folderId) return null;
    const file = await this.findFile(folderId, name);
    return file ? this.stored(file, remotePath) : null;
  }

  async list(): Promise<StoredFile[]> {
    const rootId = await this.folder([APP_FOLDER], false);
    if (!rootId) return [];
    const out: StoredFile[] = [];
    const walk = async (folderId: string, prefix: string): Promise<void> => {
      for (const f of await this.children(folderId, '')) {
        const path = prefix ? `${prefix}/${f.name}` : f.name;
        if (f.mimeType === FOLDER_MIME) await walk(f.id, path);
        else out.push(this.stored(f, path));
      }
    };
    await walk(rootId, '');
    return out;
  }

  async location(): Promise<StorageLocation> {
    const rootId = await this.folder([APP_FOLDER], false).catch(() => null);
    return {
      root: `Mi unidad/${APP_FOLDER}`,
      webUrl: rootId ? `https://drive.google.com/drive/folders/${rootId}` : undefined,
    };
  }
}

/** Next byte to send from a `Range: bytes=0-N` header (none = nothing stored yet). */
function rangeEnd(range: string | null): number {
  const m = range ? /bytes=\d+-(\d+)/.exec(range) : null;
  return m ? Number(m[1]) + 1 : 0;
}
