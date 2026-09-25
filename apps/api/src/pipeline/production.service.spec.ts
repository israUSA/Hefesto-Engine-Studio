import type { Channel, ProductionStage, ProviderConfig, RunStatus, StageKey, WordTiming } from '@hefesto/shared-types';
import { STAGE_ORDER } from '@hefesto/shared-types';
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { InMemoryBindingSource, ProviderRegistry } from '../providers';
import { fakeProviderFactory } from '../providers/adapters/fake';
import { RegistryProviderGateway } from './adapters/provider-gateway';
import type {
  BibleLookup,
  MediaTools,
  ProductionRecord,
  ProductionStore,
  ProviderGateway,
  StoredScript,
} from './ports';
import { ProductionService, type ProductionEvent } from './production.service';

jest.mock('../config/env', () => {
  const actual = jest.requireActual('../config/env');
  const { join: j } = jest.requireActual('node:path');
  const { tmpdir } = jest.requireActual('node:os');
  const home = j(tmpdir(), `hefesto-pipeline-spec-${process.pid}`);
  return {
    ...actual,
    env: { ...actual.env, home },
    paths: {
      ...actual.paths,
      production: (slug: string, id: string) => j(home, 'channels', slug, 'productions', id),
    },
  };
});

const { env } = require('../config/env') as typeof import('../config/env');

const CHANNEL: Channel = {
  id: 'ch1',
  name: 'Canal de prueba',
  slug: 'canal-prueba',
  platform: 'tiktok',
  handle: '@prueba',
  language: 'es',
  format: '9:16',
  topic: 'hábitos',
  bible: 'Tono cálido.',
  durationTarget: { min: 20, max: 40 },
  aiLabel: true,
  monetized: false,
  active: true,
  voice: { voiceId: 'Kore', language: 'es' },
  visualStyle: { source: 'stock', motion: 'kenburns' },
};

type Row = ProductionRecord & { currentStep?: StageKey | null; progress?: number; error?: string; scriptId?: string };

class MemoryStore implements ProductionStore {
  channels = new Map<string, Channel>([[CHANNEL.id, structuredClone(CHANNEL)]]);
  rows = new Map<string, Row>();
  scripts = new Map<string, StoredScript & { channelId: string; status: string }>();
  costs: unknown[] = [];

  async getChannelBySlug(slug: string) {
    return [...this.channels.values()].find((c) => c.slug === slug) ?? null;
  }
  async getChannelById(id: string) {
    return this.channels.get(id) ?? null;
  }
  async recentTopics() {
    return [];
  }
  async createProduction(id: string, channelId: string, script: StoredScript) {
    const scriptId = `s-${id}`;
    this.scripts.set(scriptId, { ...script, channelId, status: 'approved' });
    this.rows.set(id, { id, channelId, scriptId, status: 'pending', inputHashes: {} });
  }
  async createProductionForScript(id: string, channelId: string, scriptId: string) {
    this.rows.set(id, { id, channelId, scriptId, status: 'pending', inputHashes: {} });
  }
  async loadScript(scriptId: string) {
    return this.scripts.get(scriptId) ?? null;
  }
  async getProduction(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r, inputHashes: { ...r.inputHashes } } : null;
  }
  async setProgress(id: string, patch: { currentStep?: StageKey | null; progress?: number }) {
    const r = this.rows.get(id);
    if (r) Object.assign(r, patch);
  }
  async clearStageHashes(id: string, keys: string[]) {
    const r = this.rows.get(id);
    if (r) for (const k of keys) delete r.inputHashes[k];
  }
  async markStage(id: string, key: string, hash: string, stage?: ProductionStage) {
    const r = this.rows.get(id);
    if (!r) return;
    r.inputHashes[key] = hash;
    if (stage) r.stage = stage;
  }
  async setRender() {
    /* not needed */
  }
  async setStatus(id: string, status: RunStatus, error?: string) {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { status, error });
  }
  async recordCost(entry: unknown) {
    this.costs.push(entry);
  }
  async recordAsset() {
    /* not needed */
  }
}

const media: MediaTools = {
  async normalizeVoice(inPath, outPath) {
    copyFileSync(inPath, outPath);
    return { durationMs: 20_000 };
  },
  async measureLoudness() {
    return -14;
  },
  async probeDurationMs() {
    return 25_000;
  },
  align(scriptText) {
    const words: WordTiming[] = scriptText.split(/\s+/).map((word, i) => ({ word, startMs: i * 400, endMs: i * 400 + 380 }));
    return { words, wer: 0 };
  },
  async writeSubtitles(_w, _s, _f, outPath) {
    writeFileSync(outPath, '[Script Info]');
  },
  async render(input, opts) {
    for (const p of [0.25, 0.5, 1]) opts.onProgress?.(p);
    writeFileSync(input.outPath, 'mp4');
    return { encoder: 'libx264', durationMs: 25_000 };
  },
  async thumbnail(_v, outPath) {
    writeFileSync(outPath, 'jpg');
  },
};

const bible: BibleLookup = {
  async passage() {
    return '';
  },
  format: () => '',
  async verify() {
    return { exact: true, similarity: 1 };
  },
};

function makeGateway(): { gateway: ProviderGateway; calls: string[] } {
  const fake: ProviderConfig = {
    id: 'fake',
    name: 'fake',
    adapter: 'fake',
    capabilities: ['text', 'tts', 'transcribe', 'stock'],
    params: {},
    enabled: true,
  };
  const source = new InMemoryBindingSource().addConfig(fake);
  for (const [capability, role] of [['text', 'script'], ['tts'], ['transcribe'], ['stock']] as const) {
    source.addBinding({ id: capability, channelId: null, capability, role, providerConfigId: 'fake', params: {}, fallbackIds: [] });
  }
  const registry = new ProviderRegistry(source, {});
  registry.register(fakeProviderFactory);
  const inner = new RegistryProviderGateway(registry);
  const calls: string[] = [];
  const gateway: ProviderGateway = {
    call: (capability, scope, fn) => {
      calls.push(capability);
      return inner.call(capability, scope, fn);
    },
    describe: (capability, scope) => inner.describe(capability, scope),
  };
  return { gateway, calls };
}

describe('ProductionService (per-stage pipeline)', () => {
  let store: MemoryStore;
  let calls: string[];
  let svc: ProductionService;

  beforeEach(() => {
    store = new MemoryStore();
    const g = makeGateway();
    calls = g.calls;
    svc = new ProductionService(store, g.gateway, media, bible);
  });

  afterAll(() => rmSync(env.home, { recursive: true, force: true }));

  it('produce() runs every stage and creates the production row in the script stage', async () => {
    const events: ProductionEvent[] = [];
    const r = await svc.produce(CHANNEL.slug, { onEvent: (e) => events.push(e) });

    expect(existsSync(r.renderPath)).toBe(true);
    const row = store.rows.get(r.productionId) as Row;
    expect(Object.keys(row.inputHashes).sort()).toEqual([...STAGE_ORDER].sort());
    expect(row.status).toBe('done');
    expect(row.progress).toBe(1);
    expect(row.currentStep).toBeNull();
    expect(events.filter((e) => e.type === 'stage' && e.state === 'done').map((e) => (e as { stage: string }).stage)).toEqual(
      STAGE_ORDER.filter((s) => s !== 'qa'),
    );
    expect(events.some((e) => e.type === 'progress' && e.stage === 'render' && e.value === 1)).toBe(true);
  });

  it('re-running stages one by one skips them all when nothing changed (qa always re-runs)', async () => {
    const { productionId } = await svc.produce(CHANNEL.slug);
    calls.length = 0;

    for (const stage of STAGE_ORDER) {
      const r = await svc.runStage({ productionId }, stage);
      expect(r.skipped).toBe(stage !== 'qa');
    }
    expect(calls).toEqual([]);
  });

  it('a change upstream re-runs that stage and every stage after it', async () => {
    const { productionId } = await svc.produce(CHANNEL.slug);
    (store.channels.get(CHANNEL.id) as Channel).voice.speed = 1.1;

    const skipped: Record<string, boolean> = {};
    for (const stage of STAGE_ORDER) skipped[stage] = (await svc.runStage({ productionId }, stage)).skipped;
    expect(skipped).toEqual({
      script: true,
      voice: false,
      transcribe: false,
      subtitles: false,
      visuals: false,
      render: false,
      qa: false,
    });
  });

  it('resetFrom forces a stage and the later ones to re-run', async () => {
    const { productionId } = await svc.produce(CHANNEL.slug);
    await svc.resetFrom(productionId, 'render');
    expect((await svc.runStage({ productionId }, 'visuals')).skipped).toBe(true);
    expect((await svc.runStage({ productionId }, 'render')).skipped).toBe(false);
  });

  it('refuses a stage whose previous stage has not finished', async () => {
    await expect(svc.runStage({ productionId: 'nope', channelId: CHANNEL.id }, 'voice')).rejects.toThrow(/guion/);
    const { productionId } = await svc.produce(CHANNEL.slug);
    await store.clearStageHashes(productionId, ['voice']);
    await expect(svc.runStage({ productionId }, 'transcribe')).rejects.toThrow(/voice/);
  });

  it('produces from an approved script without calling the text provider', async () => {
    store.scripts.set('sc1', {
      channelId: CHANNEL.id,
      status: 'approved',
      title: 'Guion aprobado',
      hook: 'Hola.',
      body: 'Cuerpo.',
      cta: 'Seguinos.',
      fullText: 'Hola. Cuerpo del guion. Seguinos.',
      verseRefs: [],
      metadata: {},
      scenes: [
        { order: 0, text: 'Hola.', visualPrompt: 'amanecer', keywords: ['sunrise'] },
        { order: 1, text: 'Cuerpo del guion. Seguinos.', visualPrompt: 'camino', keywords: ['path'] },
      ],
    });
    const r = await svc.produce(CHANNEL.slug, { scriptId: 'sc1' });
    expect(r.title).toBe('Guion aprobado');
    expect(calls).not.toContain('text');
    expect(store.rows.get(r.productionId)?.scriptId).toBe('sc1');
    // Idempotent too: the copy is skipped next time.
    expect((await svc.runStage({ productionId: r.productionId, scriptId: 'sc1' }, 'script')).skipped).toBe(true);
  });

  it('rejects scripts that are not approved', async () => {
    store.scripts.set('draft', {
      channelId: CHANNEL.id,
      status: 'draft',
      title: 'Borrador',
      hook: 'Hola.',
      body: '',
      cta: '',
      fullText: 'Hola.',
      verseRefs: [],
      metadata: {},
      scenes: [{ order: 0, text: 'Hola.', visualPrompt: 'luz', keywords: ['light'] }],
    });
    await expect(svc.createFromScript('draft')).rejects.toThrow(/no está aprobado/);
  });

  it('stops at the first stage boundary when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelado'));
    await expect(svc.produce(CHANNEL.slug, { signal: controller.signal })).rejects.toThrow('cancelado');
  });
});
