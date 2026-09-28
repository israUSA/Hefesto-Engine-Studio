import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb } from '../db/test-utils';
import {
  ChannelsRepository,
  CostEntriesRepository,
  ProductionsRepository,
  ProviderBindingsRepository,
  ProviderConfigsRepository,
  RemoteFilesRepository,
  ScriptsRepository,
  SettingsRepository,
} from '../db/repositories';
import { EventsService } from '../events/events.service';
import { DbBindingSource } from '../pipeline/adapters/db-binding-source';
import { ARCHIVE_FILES } from '../pipeline/production.service';
import { ProviderRegistry } from '../providers';
import { localFolderProviderFactory } from '../providers/adapters/local-folder';
import { ProductionSummaryReader } from '../queue/production-summary';
import type { QueueApi } from '../queue/queue.contract';
import { StorageService } from './storage.service';

jest.mock('../config/env', () => {
  const actual = jest.requireActual('../config/env');
  const { join: j } = jest.requireActual('node:path');
  const { tmpdir } = jest.requireActual('node:os');
  const home = j(tmpdir(), `hefesto-storage-spec-${process.pid}`);
  return {
    ...actual,
    env: { ...actual.env, home },
    paths: {
      ...actual.paths,
      logs: () => j(home, 'logs'),
      production: (slug: string, id: string) => j(home, 'channels', slug, 'productions', id),
    },
  };
});

const { env, paths } = require('../config/env') as typeof import('../config/env');

function setup() {
  const { db } = createTestDb();
  const channels = new ChannelsRepository(db);
  const productions = new ProductionsRepository(db);
  const remoteFiles = new RemoteFilesRepository(db);
  const configs = new ProviderConfigsRepository(db);
  const bindings = new ProviderBindingsRepository(db);
  const scripts = new ScriptsRepository(db);
  const registry = new ProviderRegistry(new DbBindingSource(configs, bindings, channels), {});
  registry.register(localFolderProviderFactory);
  const queue = { retryProduction: jest.fn().mockResolvedValue({}) };
  const events = new EventsService();
  const svc = new StorageService(
    registry,
    queue as unknown as QueueApi,
    channels,
    productions,
    remoteFiles,
    configs,
    bindings,
    new SettingsRepository(db),
    new CostEntriesRepository(db),
    new ProductionSummaryReader(db),
    events,
  );

  const channel = channels.create({
    name: 'Canal Test',
    slug: `canal-${Math.random().toString(36).slice(2, 8)}`,
    platform: 'tiktok',
    handle: '@test',
    language: 'es',
    format: '9:16',
    topic: 'pruebas',
    bible: 'Tono.',
    durationTarget: { min: 20, max: 40 },
    aiLabel: true,
    monetized: false,
    active: true,
    voice: { voiceId: 'v1', language: 'es' },
    visualStyle: { source: 'stock', motion: 'kenburns' },
  });
  const script = scripts.create({
    channelId: channel.id,
    title: 'Video',
    hook: 'h',
    body: 'b',
    cta: 'c',
    fullText: 'h b c',
    verseRefs: [],
    metadata: {},
    scenes: [],
    status: 'approved',
  });

  const root = join(env.home, `nas-${channel.slug}`);
  const folder = configs.create({ name: 'carpeta-local', adapter: 'local-folder', capabilities: ['storage'], params: { root }, enabled: true });
  bindings.upsert({ channelId: null, capability: 'storage', providerConfigId: folder.id, params: {}, fallbackIds: [] });

  /** A finished production with its files on disk. */
  const produce = () => {
    const row = productions.create({ scriptId: script.id, channelId: channel.id });
    const dir = paths.production(channel.slug, row.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'render.mp4'), 'render-bytes');
    writeFileSync(join(dir, 'voice.wav'), 'voice');
    writeFileSync(join(dir, 'voice.raw.wav'), 'raw');
    writeFileSync(join(dir, 'thumb.jpg'), 'jpg');
    writeFileSync(join(dir, 'script.json'), '{}');
    productions.setRenderResult(row.id, join(dir, 'render.mp4'), 30_000);
    productions.updateStage(row.id, 'qa_passed', {}, 'done');
    return { id: row.id, dir };
  };

  /** What the `archive` stage does, without the queue. */
  const archive = async (p: { id: string; dir: string }) => {
    const provider = registry.resolve('storage', { channelId: channel.id }).provider;
    for (const f of ARCHIVE_FILES) {
      const { file } = await provider.put(join(p.dir, f.name), `Canal Test (TikTok)/${f.folder}/2026-09/${p.id.slice(0, 8)}-video-${f.name}`, {
        channelId: channel.id,
      });
      remoteFiles.upsert({
        productionId: p.id,
        channelId: channel.id,
        kind: f.kind,
        localName: f.name,
        providerConfigId: folder.id,
        remoteId: file.remoteId,
        remotePath: file.remotePath,
        md5: file.md5 as string,
        sizeBytes: file.sizeBytes,
      });
    }
  };

  return { svc, queue, produce, archive, remoteFiles, productions, root, bindings, summaries: new ProductionSummaryReader(db) };
}

describe('StorageService', () => {
  afterAll(() => rmSync(env.home, { recursive: true, force: true }));

  it('shows where each video is and what can be freed', async () => {
    const t = setup();
    const p = t.produce();
    let o = await t.svc.overview();
    expect(o.provider).toMatchObject({ adapter: 'local-folder', ready: true, root: join(t.root, 'Hefesto Engine Studio') });
    expect(o.channels[0]).toMatchObject({ videos: 1, diskOnly: 1, both: 0 });
    expect(o.freeableBytes).toBe(0);

    await t.archive(p);
    o = await t.svc.overview();
    expect(o.channels[0]).toMatchObject({ videos: 1, both: 1, diskOnly: 0 });
    expect(o.freeableVideos).toBe(1);
    expect(o.freeableBytes).toBe('render-bytes'.length + 'voice'.length + 'raw'.length);
    expect(o.remote.byKind.render).toEqual({ count: 1, bytes: 12 });
    expect(o.example).toMatch(/^Canal Test \(TikTok\)\/renders\//);
  });

  it('frees the heavy files of verified productions and keeps cover and script', async () => {
    const t = setup();
    const p = t.produce();
    await t.archive(p);

    expect(await t.svc.free()).toEqual({ productions: 1, freedBytes: 20 });
    expect(existsSync(join(p.dir, 'render.mp4'))).toBe(false);
    expect(existsSync(join(p.dir, 'voice.raw.wav'))).toBe(false);
    expect(existsSync(join(p.dir, 'thumb.jpg'))).toBe(true);
    expect(existsSync(join(p.dir, 'script.json'))).toBe(true);

    const summary = t.summaries.get(p.id);
    expect(summary?.archive).toEqual({ remote: true, onDisk: false });
    expect(summary?.videoUrl).toBeUndefined();
    expect(summary?.thumbUrl).toBeDefined();
    expect((await t.svc.overview()).channels[0]).toMatchObject({ remoteOnly: 1, both: 0 });
  });

  it('never frees a file whose checksum differs from the archived copy', async () => {
    const t = setup();
    const p = t.produce();
    await t.archive(p);
    // Same size, different content: only the md5 tells them apart.
    writeFileSync(join(p.dir, 'render.mp4'), 'RENDER-BYTES');
    expect(await t.svc.free()).toEqual({ productions: 0, freedBytes: 0 });
    expect(existsSync(join(p.dir, 'render.mp4'))).toBe(true);
  });

  it('brings freed files back from the archive', async () => {
    const t = setup();
    const p = t.produce();
    await t.archive(p);
    await t.svc.free([p.id]);

    const summary = await t.svc.restore(p.id);
    expect(summary.archive).toEqual({ remote: true, onDisk: true });
    expect(summary.videoUrl).toBe(`/api/files/${p.id}/render.mp4`);
    expect(existsSync(join(p.dir, 'render.mp4'))).toBe(true);
    expect(existsSync(join(p.dir, 'voice.wav'))).toBe(true);
  });

  it('sync marks files that disappeared from the remote', async () => {
    const t = setup();
    const p = t.produce();
    await t.archive(p);
    const render = t.remoteFiles.forProduction(p.id).find((f) => f.kind === 'render');
    unlinkSync(join(t.root, 'Hefesto Engine Studio', ...(render?.remotePath ?? '').split('/')));

    const o = await t.svc.sync();
    expect(o.lastSyncAt).toBeDefined();
    expect(t.remoteFiles.forProduction(p.id).find((f) => f.kind === 'render')?.present).toBe(false);
    expect(o.channels[0]).toMatchObject({ diskOnly: 1, both: 0 });
  });

  it('upload enqueues a forced archive for every video not archived yet', async () => {
    const t = setup();
    const done = t.produce();
    await t.archive(done);
    const pending = t.produce();

    expect(await t.svc.upload()).toEqual({ queued: 1 });
    expect(t.queue.retryProduction).toHaveBeenCalledWith(pending.id, 'archive', { force: true });

    await t.svc.setTarget({ adapter: 'none' });
    await expect(t.svc.upload()).rejects.toThrow(BadRequestException);
  });

  it('switches the archive target and validates the folder', async () => {
    const t = setup();
    await expect(t.svc.setTarget({ adapter: 'local-folder', root: 'relativa' })).rejects.toThrow(/ruta completa/);
    const o = await t.svc.setTarget({ adapter: 'local-folder', root: join(t.root, 'otra') });
    expect(o.provider?.root).toBe(join(t.root, 'otra', 'Hefesto Engine Studio'));
    expect((await t.svc.setTarget({ adapter: 'none' })).provider).toBeUndefined();
    expect(t.bindings.list().some((b) => b.capability === 'storage')).toBe(false);
  });
});
