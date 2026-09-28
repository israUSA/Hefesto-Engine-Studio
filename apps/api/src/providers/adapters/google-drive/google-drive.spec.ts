import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, testCallContext } from '../../contract.spec-helper';
import { googleDriveManifest } from './manifest';
import { GoogleDriveProvider } from './provider';

const ENV = {
  GOOGLE_OAUTH_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh',
};

const CONFIG: ProviderConfig = {
  id: 'drive-1',
  name: 'google-drive',
  adapter: 'google-drive',
  capabilities: ['storage'],
  params: {},
  secretRef: 'GOOGLE_DRIVE_REFRESH_TOKEN',
  enabled: true,
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * A tiny in-memory Drive: folders and files by id, the list query, resumable sessions
 * (optionally failing one chunk) and downloads. Enough to exercise the adapter end to end.
 */
function fakeDrive(opts: { failChunkOnce?: boolean; tokenError?: string } = {}) {
  const items = new Map<string, { id: string; name: string; parent: string; folder: boolean; data?: Buffer }>();
  const sessions = new Map<string, { name: string; parent: string; total: number; data: Buffer; fileId?: string }>();
  const calls: Call[] = [];
  let seq = 0;
  let failed = false;

  const handler = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, url: url.toString(), headers });

    if (url.hostname === 'oauth2.googleapis.com') {
      if (opts.tokenError) return json({ error: opts.tokenError }, 400);
      return json({ access_token: 'access', expires_in: 3600 });
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const wantFolder = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      const noFolder = q.includes("mimeType != 'application/vnd.google-apps.folder'");
      const files = [...items.values()]
        .filter((i) => i.parent === parent && (!name || i.name === name) && (!wantFolder || i.folder) && (!noFolder || !i.folder))
        .map((i) => ({
          id: i.id,
          name: i.name,
          mimeType: i.folder ? 'application/vnd.google-apps.folder' : 'video/mp4',
          size: i.data ? String(i.data.length) : undefined,
          md5Checksum: i.data ? createHash('md5').update(i.data).digest('hex') : undefined,
        }));
      return json({ files });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; parents: string[] };
      const id = `folder-${++seq}`;
      items.set(id, { id, name: body.name, parent: body.parents[0], folder: true });
      return json({ id });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files') && url.searchParams.get('uploadType') === 'resumable') {
      const sessionId = `s-${++seq}`;
      const existingId = url.pathname.split('/')[5];
      const meta = JSON.parse(String(init.body)) as { name?: string; parents?: string[] };
      const existing = existingId ? items.get(existingId) : undefined;
      sessions.set(sessionId, {
        name: meta.name ?? existing?.name ?? '',
        parent: meta.parents?.[0] ?? existing?.parent ?? '',
        total: Number(headers['x-upload-content-length']),
        data: Buffer.alloc(0),
        fileId: existingId,
      });
      return new Response(null, { status: 200, headers: { location: `https://upload.test/${sessionId}` } });
    }
    if (url.hostname === 'upload.test') {
      const session = sessions.get(url.pathname.slice(1));
      if (!session) return new Response('gone', { status: 404 });
      const range = headers['content-range'] ?? '';
      const status = () =>
        session.data.length
          ? new Response(null, { status: 308, headers: { range: `bytes=0-${session.data.length - 1}` } })
          : new Response(null, { status: 308 });
      if (range.startsWith('bytes */') && range !== 'bytes */0') return status();
      if (opts.failChunkOnce && !failed && session.data.length > 0) {
        failed = true;
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      }
      session.data = Buffer.concat([session.data, Buffer.from(init.body as Uint8Array)]);
      if (session.data.length < session.total) return status();
      const id = session.fileId ?? `file-${++seq}`;
      items.set(id, { id, name: session.name, parent: session.parent, folder: false, data: session.data });
      return json({ id, name: session.name, size: String(session.data.length), md5Checksum: createHash('md5').update(session.data).digest('hex') });
    }
    const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (media && url.searchParams.get('alt') === 'media') {
      const item = items.get(decodeURIComponent(media[1]));
      return item?.data ? new Response(new Uint8Array(item.data), { status: 200 }) : new Response('not found', { status: 404 });
    }
    if (url.pathname === '/drive/v3/about') {
      return json({ user: { emailAddress: 'yo@example.com' }, storageQuota: { usage: '10', limit: '2000' } });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  };

  return { handler, items, calls };
}

describe('GoogleDriveProvider', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-drive-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function withDrive(opts?: Parameters<typeof fakeDrive>[0]) {
    const drive = fakeDrive(opts);
    global.fetch = jest.fn(drive.handler) as unknown as typeof fetch;
    return drive;
  }

  it('declares a cloud manifest on the net lane with the drive.file secrets', () => {
    expectValidManifest(googleDriveManifest);
    expect(googleDriveManifest.resources.lane).toBe('net');
    expect(googleDriveManifest.secrets).toContain('GOOGLE_DRIVE_REFRESH_TOKEN');
  });

  it('creates the folder tree once and uploads in resumable chunks, verifying the md5', async () => {
    const drive = withDrive();
    const provider = new GoogleDriveProvider(CONFIG, ENV);
    const local = join(dir, 'render.mp4');
    // 9 MiB: two chunks of the 8 MiB resumable session.
    writeFileSync(local, Buffer.alloc(9 * 1024 * 1024, 7));
    const progress: number[] = [];

    const { file } = await provider.put(local, 'Canal (TikTok)/renders/2026-09/a-video.mp4', testCallContext(), {
      onProgress: (sent) => progress.push(sent),
    });
    expect(file.sizeBytes).toBe(9 * 1024 * 1024);
    expect(file.md5).toBe(createHash('md5').update(readFileSync(local)).digest('hex'));
    expect(progress).toEqual([8 * 1024 * 1024, 9 * 1024 * 1024]);

    const folders = [...drive.items.values()].filter((i) => i.folder).map((i) => i.name);
    expect(folders).toEqual(['Hefesto Engine Studio', 'Canal (TikTok)', 'renders', '2026-09']);
    expect(drive.calls.every((c) => c.url.includes('oauth2') || c.url.includes('upload.test') || c.headers['authorization'] === 'Bearer access')).toBe(true);

    // A second file in the same folder reuses the cached folder ids.
    const posts = drive.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/files?fields=id')).length;
    writeFileSync(join(dir, 'thumb.jpg'), 'jpg');
    await provider.put(join(dir, 'thumb.jpg'), 'Canal (TikTok)/renders/2026-09/a-video.jpg', testCallContext());
    expect(drive.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/files?fields=id')).length).toBe(posts);
  });

  it('resumes from the last confirmed byte after a dropped connection', async () => {
    const drive = withDrive({ failChunkOnce: true });
    const provider = new GoogleDriveProvider(CONFIG, ENV);
    const local = join(dir, 'voice.wav');
    const data = Buffer.alloc(17 * 1024 * 1024, 3);
    writeFileSync(local, data);

    const { file } = await provider.put(local, 'C/audio/2026-09/v.wav', testCallContext());
    expect(file.md5).toBe(createHash('md5').update(data).digest('hex'));
    expect(drive.calls.some((c) => c.headers['content-range'] === `bytes */${data.length}`)).toBe(true);
  }, 20_000);

  it('replaces an existing file keeping its id, lists the tree and downloads', async () => {
    withDrive();
    const provider = new GoogleDriveProvider(CONFIG, ENV);
    const local = join(dir, 'script.json');
    writeFileSync(local, '{"v":1}');
    const first = await provider.put(local, 'C/scripts/2026-09/s.json', testCallContext());
    writeFileSync(local, '{"v":2}');
    const second = await provider.put(local, 'C/scripts/2026-09/s.json', testCallContext());
    expect(second.file.remoteId).toBe(first.file.remoteId);

    expect(await provider.list()).toEqual([expect.objectContaining({ remotePath: 'C/scripts/2026-09/s.json', sizeBytes: 7 })]);
    expect(await provider.exists('C/scripts/2026-09/s.json')).toMatchObject({ remoteId: first.file.remoteId });
    expect(await provider.exists('C/scripts/2026-09/otro.json')).toBeNull();

    const back = join(dir, 'back', 'script.json');
    await provider.get(first.file.remoteId, back, testCallContext());
    expect(readFileSync(back, 'utf8')).toBe('{"v":2}');
    expect((await provider.location()).webUrl).toMatch(/^https:\/\/drive\.google\.com\/drive\/folders\//);
    expect((await provider.healthCheck()).message).toContain('yo@example.com');
  });

  it('asks to reconnect when the refresh token was revoked, and names missing secrets', async () => {
    withDrive({ tokenError: 'invalid_grant' });
    await expect(new GoogleDriveProvider(CONFIG, ENV).list()).rejects.toThrow(/reconectá la cuenta/);
    await expect(new GoogleDriveProvider(CONFIG, {}).list()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });
});
