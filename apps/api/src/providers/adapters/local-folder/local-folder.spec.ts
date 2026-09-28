import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, expectValidUsage, testCallContext } from '../../contract.spec-helper';
import { localFolderManifest } from './manifest';
import { LocalFolderProvider } from './provider';

describe('LocalFolderProvider', () => {
  let dir: string;
  let root: string;
  let provider: LocalFolderProvider;

  const config = (params: Record<string, unknown>): ProviderConfig => ({
    id: 'folder-1',
    name: 'carpeta',
    adapter: 'local-folder',
    capabilities: ['storage'],
    params,
    enabled: true,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-folder-'));
    root = join(dir, 'nas');
    provider = new LocalFolderProvider(config({ root }));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('declares a valid local, free manifest', () => {
    expectValidManifest(localFolderManifest);
    expect(localFolderManifest.kind).toBe('local');
    expect(localFolderManifest.capabilities).toEqual(['storage']);
  });

  it('puts a file under the app folder with its md5, reports progress, and gets it back', async () => {
    const local = join(dir, 'render.mp4');
    writeFileSync(local, 'video-bytes');
    const progress: number[] = [];

    const { file, usage } = await provider.put(local, 'Canal (TikTok)/renders/2026-09/abc-video.mp4', testCallContext(), {
      onProgress: (sent) => progress.push(sent),
    });
    expectValidUsage(usage);
    expect(usage.costUsd).toBe(0);
    expect(file.md5).toBe(createHash('md5').update('video-bytes').digest('hex'));
    expect(file.sizeBytes).toBe(11);
    expect(progress.at(-1)).toBe(11);
    expect(readFileSync(join(root, 'Hefesto Engine Studio', 'Canal (TikTok)', 'renders', '2026-09', 'abc-video.mp4'), 'utf8')).toBe(
      'video-bytes',
    );

    const back = join(dir, 'restored', 'render.mp4');
    await provider.get(file.remoteId, back, testCallContext());
    expect(readFileSync(back, 'utf8')).toBe('video-bytes');
    expect(existsSync(`${back}.part`)).toBe(false);
  });

  it('lists every archived file and answers exists()', async () => {
    const local = join(dir, 'a.json');
    writeFileSync(local, '{}');
    await provider.put(local, 'C/scripts/2026-09/a.json', testCallContext());
    await provider.put(local, 'C/scripts/2026-10/b.json', testCallContext());

    expect((await provider.list()).map((f) => f.remotePath).sort()).toEqual(['C/scripts/2026-09/a.json', 'C/scripts/2026-10/b.json']);
    expect(await provider.exists('C/scripts/2026-09/a.json')).toMatchObject({ sizeBytes: 2 });
    expect(await provider.exists('C/scripts/nope.json')).toBeNull();
    expect((await provider.location()).root).toBe(join(root, 'Hefesto Engine Studio'));
  });

  it('rejects paths that escape the app folder and a missing root', async () => {
    const local = join(dir, 'x.txt');
    writeFileSync(local, 'x');
    await expect(provider.put(local, '../fuera.txt', testCallContext())).rejects.toThrow(/inválida/);
    await expect(provider.put(local, 'C/a:b.txt', testCallContext())).rejects.toThrow(/inválida/);

    const unset = new LocalFolderProvider(config({ root: '' }));
    await expect(unset.list()).rejects.toThrow(/Elegí una carpeta/);
    expect((await unset.healthCheck()).ok).toBe(false);
    expect((await provider.healthCheck()).ok).toBe(true);
  });
});
