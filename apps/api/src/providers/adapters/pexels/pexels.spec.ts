import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@hefesto/shared-types';
import { expectValidManifest, expectValidUsage, testCallContext } from '../../contract.spec-helper';
import { pexelsManifest } from './manifest';
import { PexelsProvider } from './provider';

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'pexels-1',
    name: 'Pexels',
    adapter: 'pexels',
    capabilities: ['stock'],
    secretRef: 'PEXELS_API_KEY',
    params: {},
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('PexelsProvider', () => {
  let dir: string;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hefesto-pexels-'));
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('declares a valid manifest requiring PEXELS_API_KEY', () => {
    expectValidManifest(pexelsManifest);
    expect(pexelsManifest.secrets).toContain('PEXELS_API_KEY');
  });

  it('throws a clear error naming the secret when calling search without a key', async () => {
    const provider = new PexelsProvider(config(), {});
    await expect(
      provider.search!({ keywords: ['faith'], mediaType: 'photo', orientation: 'portrait' }, testCallContext()),
    ).rejects.toThrow(/PEXELS_API_KEY/);
  });

  it('searches portrait photos and fills attribution fields', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        photos: [
          {
            id: 1,
            width: 1080,
            height: 1920,
            url: 'https://pexels.com/photo/1',
            photographer: 'Jane Doe',
            src: { portrait: 'https://images.pexels.com/1-portrait.jpg', original: 'https://images.pexels.com/1.jpg' },
          },
        ],
      }),
    );
    const provider = new PexelsProvider(config(), { PEXELS_API_KEY: 'key' });

    const items = await provider.search!({ keywords: ['faith', 'hope'], mediaType: 'photo', orientation: 'portrait' }, testCallContext());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: '1',
      provider: 'pexels',
      mediaType: 'photo',
      downloadUrl: 'https://images.pexels.com/1-portrait.jpg',
      author: 'Jane Doe',
      license: 'Pexels License',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.pexels.com/v1/search');
    expect(String(url)).toContain('faith+hope');
    expect(init.headers['authorization']).toBe('key');
  });

  it('searches videos and picks the smallest available file', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        videos: [
          {
            id: 2,
            width: 1080,
            height: 1920,
            duration: 12,
            url: 'https://pexels.com/video/2',
            user: { name: 'John' },
            video_files: [
              { width: 1920, height: 1080, link: 'https://videos.pexels.com/2-hd.mp4' },
              { width: 640, height: 360, link: 'https://videos.pexels.com/2-sd.mp4' },
            ],
          },
        ],
      }),
    );
    const provider = new PexelsProvider(config(), { PEXELS_API_KEY: 'key' });

    const items = await provider.search!({ keywords: ['faith'], mediaType: 'video', orientation: 'portrait' }, testCallContext());
    expect(items[0].downloadUrl).toBe('https://videos.pexels.com/2-sd.mp4');
    expect(items[0].durationSec).toBe(12);
  });

  it('downloads an item and reports $0 cost (free provider)', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = new PexelsProvider(config(), { PEXELS_API_KEY: 'key' });

    const outPath = join(dir, 'photo.jpg');
    const { usage } = await provider.download!(
      { id: '1', provider: 'pexels', mediaType: 'photo', width: 100, height: 100, downloadUrl: 'https://images.pexels.com/1.jpg', pageUrl: 'x', license: 'Pexels License' },
      outPath,
      testCallContext(),
    );
    expect(readFileSync(outPath)).toEqual(Buffer.from([1, 2, 3]));
    expectValidUsage(usage);
    expect(usage.costUsd).toBe(0);
  });

  it('retries a 500 on search and eventually succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ photos: [] }));
    const provider = new PexelsProvider(config(), { PEXELS_API_KEY: 'key' });

    const items = await provider.search!({ keywords: ['faith'], mediaType: 'photo', orientation: 'portrait' }, testCallContext());
    expect(items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('healthCheck reports ok on a successful curated call', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ photos: [] }));
    const provider = new PexelsProvider(config(), { PEXELS_API_KEY: 'key' });
    const result = await provider.healthCheck();
    expect(result.ok).toBe(true);
  });
});
