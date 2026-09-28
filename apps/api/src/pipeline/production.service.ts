import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STAGE_ORDER,
  type ArchivedKind,
  type BrandKit,
  type Channel,
  type ProductionStage,
  type RunStatus,
  type ScriptDraft,
  type StageKey,
  type Usage,
  type WordTiming,
} from '@hefesto/shared-types';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { paths } from '../config/env';
import { generateStructured, md5File, scriptDraftJsonSchema, scriptDraftSchema } from '../providers';
import { inputHash } from './hash';
import {
  BIBLE_LOOKUP,
  type BibleLookup,
  MEDIA_TOOLS,
  type MediaTools,
  PRODUCTION_STORE,
  type ProductionRecord,
  type ProductionStore,
  PROVIDER_GATEWAY,
  type ProviderGateway,
  type RemoteFileRecord,
  type SceneClip,
  type StoredScript,
  type SubtitleStyle,
} from './ports';
import { buildScriptPrompt, materializeScript } from './script-prompt';
import { sceneTimeline } from './timeline';

/** Identifies a production for a single stage run. */
export interface ProductionRef {
  productionId: string;
  /** Required while the production row doesn't exist yet (new production, script stage). */
  channelId?: string;
  channelSlug?: string;
  topic?: string;
  /** Produce from this approved script (script stage copies it instead of generating one). */
  scriptId?: string;
}

export interface RunStageOptions {
  signal?: AbortSignal;
  /** Stage-local progress in 0–1 (render encode, visuals per scene). */
  onProgress?: (value: number) => void;
  onEvent?: (e: ProductionEvent) => void;
  /** Re-run the stage even if its inputs didn't change. */
  force?: boolean;
}

export interface StageResult {
  productionId: string;
  stage: StageKey;
  /** True when the stage was up to date and didn't run. */
  skipped: boolean;
  durationMs: number;
  /** Cost of the calls made by this run of the stage. */
  costUsd: number;
  /** Only for `qa`. */
  qaPassed?: boolean;
}

export interface ProduceOptions {
  topic?: string;
  /** Resume an existing production instead of creating a new one. */
  productionId?: string;
  /** Produce from an existing approved script. */
  scriptId?: string;
  /** Re-run every stage even if its inputs didn't change. */
  force?: boolean;
  signal?: AbortSignal;
  onEvent?: (e: ProductionEvent) => void;
}

export type ProductionEvent =
  | { type: 'stage'; productionId: string; stage: string; state: 'skipped' | 'running' | 'done'; ms?: number }
  | { type: 'progress'; productionId: string; stage: string; value: number }
  | { type: 'info'; productionId: string; message: string };

export interface ProductionResult {
  productionId: string;
  dir: string;
  title: string;
  renderPath: string;
  qaPassed: boolean;
  costUsd: number;
}

interface QaCheck {
  name: string;
  passed: boolean;
  value: number | string;
  threshold: string;
}

/** The channel's brand kit as the subtitles stage sees it (also part of its input hash). */
export function subtitleStyleFor(kit: BrandKit): SubtitleStyle {
  return {
    fontName: kit.subtitleFont,
    fontSize: kit.subtitleSize,
    primaryColor: kit.textColor,
    highlightColor: kit.highlightColor,
    outlineColor: kit.outlineColor,
    uppercase: kit.uppercase,
  };
}

/** What the `archive` stage uploads, and the remote folder of each kind (docs/06). */
export const ARCHIVE_FILES: { kind: ArchivedKind; name: string; folder: string }[] = [
  { kind: 'render', name: 'render.mp4', folder: 'renders' },
  { kind: 'thumb', name: 'thumb.jpg', folder: 'thumbs' },
  { kind: 'voice', name: 'voice.wav', folder: 'audio' },
  { kind: 'script', name: 'script.json', folder: 'scripts' },
];

/** Heavy files "Liberar espacio" deletes once archived; they come back on demand. */
export const FREEABLE_FILES = ['render.mp4', 'voice.wav', 'voice.raw.wav'];

/** "Nombre (TikTok)": the channel's folder in the storage provider. */
export function channelFolderName(channel: Pick<Channel, 'name' | 'platform'>): string {
  const name = channel.name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Canal';
  return `${name} (${channel.platform === 'tiktok' ? 'TikTok' : 'YouTube'})`;
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'video'
  );
}

const MAX_WER = 0.08;
const TARGET_LUFS = -14;
const LUFS_TOLERANCE = 2;
const PROGRESS_WRITE_MS = 500;

/**
 * Runs the Fase 1 stages of a short. Each stage runs on its own (`runStage`, used by the
 * queue) and is idempotent: its input hash chains the previous stage's stored hash, so
 * changing anything upstream re-runs that stage and every stage after it.
 */
@Injectable()
export class ProductionService {
  private readonly log = new Logger(ProductionService.name);

  constructor(
    @Inject(PRODUCTION_STORE) private readonly store: ProductionStore,
    @Inject(PROVIDER_GATEWAY) private readonly providers: ProviderGateway,
    @Inject(MEDIA_TOOLS) private readonly media: MediaTools,
    @Inject(BIBLE_LOOKUP) private readonly bible: BibleLookup,
  ) {}

  /** Runs every stage in order (CLI without queue, tests). */
  async produce(channelSlug: string, opts: ProduceOptions = {}): Promise<ProductionResult> {
    const channel = await this.store.getChannelBySlug(channelSlug);
    if (!channel) throw new Error(`No existe el canal "${channelSlug}"`);

    let productionId = opts.productionId;
    if (productionId && !(await this.store.getProduction(productionId))) {
      throw new Error(`No existe la producción ${productionId}`);
    }
    if (!productionId && opts.scriptId) {
      productionId = (await this.createFromScript(opts.scriptId)).productionId;
    }
    // A new production gets its id up front; the DB row is created by the script stage.
    const ref: ProductionRef = {
      productionId: productionId ?? randomUUID(),
      channelId: channel.id,
      topic: opts.topic,
      scriptId: opts.scriptId,
    };

    let costUsd = 0;
    let qaPassed = false;
    try {
      for (const stage of STAGE_ORDER) {
        const r = await this.runStage(ref, stage, { signal: opts.signal, onEvent: opts.onEvent, force: opts.force });
        costUsd += r.costUsd;
        if (stage === 'qa') qaPassed = Boolean(r.qaPassed);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.setStatus(ref.productionId, opts.signal?.aborted ? 'canceled' : 'failed', message);
      throw err;
    }

    const dir = paths.production(channel.slug, ref.productionId);
    const script = JSON.parse(await readFile(join(dir, 'script.json'), 'utf8')) as StoredScript;
    return {
      productionId: ref.productionId,
      dir,
      title: script.title,
      renderPath: join(dir, 'render.mp4'),
      qaPassed,
      costUsd,
    };
  }

  /** Runs (or skips, if up to date) one stage of a production. */
  async runStage(ref: ProductionRef, stage: StageKey, opts: RunStageOptions = {}): Promise<StageResult> {
    opts.signal?.throwIfAborted();
    const existing = await this.store.getProduction(ref.productionId);
    const channelId = existing?.channelId ?? ref.channelId;
    const channel = channelId
      ? await this.store.getChannelById(channelId)
      : ref.channelSlug
        ? await this.store.getChannelBySlug(ref.channelSlug)
        : null;
    if (!channel) throw new Error(`No existe el canal de la producción ${ref.productionId}`);

    if (!existing && stage !== 'script') {
      throw new Error(`La producción ${ref.productionId} no existe: falta la etapa de guion`);
    }
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx < 0) throw new Error(`Etapa desconocida: ${stage}`);
    if (idx > 0 && !existing?.inputHashes[STAGE_ORDER[idx - 1]]) {
      throw new Error(`La etapa "${STAGE_ORDER[idx - 1]}" todavía no terminó`);
    }

    const production: ProductionRecord = existing ?? {
      id: ref.productionId,
      channelId: channel.id,
      status: 'pending',
      inputHashes: {},
    };
    const dir = paths.production(channel.slug, production.id);
    await mkdir(join(dir, 'scenes'), { recursive: true });

    const run = new StageRun(this.deps, channel, production, dir, ref, opts, Boolean(existing));
    return run.execute(stage, idx);
  }

  /** Creates a production (DB row included) for an approved script. */
  async createFromScript(scriptId: string, productionId: string = randomUUID()): Promise<{ productionId: string; channelId: string }> {
    const script = await this.store.loadScript(scriptId);
    if (!script) throw new Error(`No existe el guion ${scriptId}`);
    if (script.status !== 'approved') throw new Error(`El guion "${script.title}" no está aprobado`);
    await this.store.createProductionForScript(productionId, script.channelId, scriptId);
    return { productionId, channelId: script.channelId };
  }

  loadScript(scriptId: string) {
    return this.store.loadScript(scriptId);
  }

  getProduction(productionId: string): Promise<ProductionRecord | null> {
    return this.store.getProduction(productionId);
  }

  setStatus(productionId: string, status: RunStatus, error?: string): Promise<void> {
    return this.store.setStatus(productionId, status, error);
  }

  /** Forgets `from` and every later stage so they re-run even if their inputs didn't change. */
  async resetFrom(productionId: string, from: StageKey): Promise<void> {
    const idx = STAGE_ORDER.indexOf(from);
    await this.store.clearStageHashes(productionId, STAGE_ORDER.slice(Math.max(0, idx)));
    await this.store.setProgress(productionId, { currentStep: from, progress: idx / STAGE_ORDER.length });
  }

  private get deps(): StageDeps {
    return { store: this.store, providers: this.providers, media: this.media, bible: this.bible, log: this.log };
  }
}

interface StageDeps {
  store: ProductionStore;
  providers: ProviderGateway;
  media: MediaTools;
  bible: BibleLookup;
  log: Logger;
}

/** One run of one stage. Each stage reads the previous stages' files from `dir`. */
class StageRun {
  private costUsd = 0;
  private scriptCache?: StoredScript;
  private remoteCache?: RemoteFileRecord[];
  private stageIdx = 0;
  private lastProgressWrite = 0;

  constructor(
    private readonly d: StageDeps,
    private readonly channel: Channel,
    private readonly production: ProductionRecord,
    private readonly dir: string,
    private readonly ref: ProductionRef,
    private readonly opts: RunStageOptions,
    /** false until the production row exists (the script stage creates it). */
    private persisted: boolean,
  ) {}

  private get id(): string {
    return this.production.id;
  }

  private file(name: string): string {
    return join(this.dir, name);
  }

  private emit(e: ProductionEvent): void {
    this.opts.onEvent?.(e);
  }

  private scope() {
    return { channelId: this.channel.id };
  }

  private ctx() {
    return { ...this.scope(), productionId: this.id, signal: this.opts.signal };
  }

  private async script(): Promise<StoredScript> {
    this.scriptCache ??= JSON.parse(await readFile(this.file('script.json'), 'utf8')) as StoredScript;
    return this.scriptCache;
  }

  private async remote(): Promise<RemoteFileRecord[]> {
    this.remoteCache ??= await this.d.store.remoteFiles(this.id);
    return this.remoteCache;
  }

  /**
   * Path of a production file; if "Liberar espacio" deleted it, it's brought back from the
   * storage provider first (docs/06: done = on disk or archived, never regenerated).
   */
  private async local(name: string): Promise<string> {
    const path = this.file(name);
    if (existsSync(path)) return path;
    const archived = (await this.remote()).find((r) => r.localName === name && r.present);
    if (!archived) return path;
    const { usage } = await this.d.providers.callConfig('storage', archived.providerConfigId, this.scope(), (p) =>
      p.get(archived.remoteId, path, this.ctx()),
    );
    await this.cost(archived.providerConfigId, 'storage-get', usage);
    this.emit({ type: 'info', productionId: this.id, message: `Traído de vuelta del archivo: ${name}` });
    if (['render.mp4', 'voice.wav'].every((f) => existsSync(this.file(f)))) await this.d.store.setFreed(this.id, false);
    return path;
  }

  private async cost(providerConfigId: string, operation: string, usage: Usage): Promise<void> {
    this.costUsd += usage.costUsd;
    await this.d.store.recordCost({
      channelId: this.channel.id,
      productionId: this.id,
      providerConfigId,
      operation,
      units: usage.units,
      unit: usage.unit,
      costUsd: usage.costUsd,
      durationMs: usage.durationMs,
    });
  }

  private progress(stage: StageKey, value: number): void {
    this.opts.onProgress?.(value);
    this.emit({ type: 'progress', productionId: this.id, stage, value });
    const now = Date.now();
    if (this.persisted && (now - this.lastProgressWrite >= PROGRESS_WRITE_MS || value >= 1)) {
      this.lastProgressWrite = now;
      void this.d.store
        .setProgress(this.id, { progress: (this.stageIdx + Math.min(1, value)) / STAGE_ORDER.length })
        .catch(() => undefined);
    }
  }

  async execute(stage: StageKey, idx: number): Promise<StageResult> {
    this.stageIdx = idx;
    const t0 = Date.now();
    if (this.persisted) {
      await this.d.store.setStatus(this.id, 'running');
      await this.d.store.setProgress(this.id, { currentStep: stage, progress: idx / STAGE_ORDER.length });
    }

    let skipped: boolean;
    let qaPassed: boolean | undefined;
    switch (stage) {
      case 'script':
        skipped = await this.scriptStage();
        break;
      case 'voice':
        skipped = await this.voiceStage();
        break;
      case 'transcribe':
        skipped = await this.transcribeStage();
        break;
      case 'subtitles':
        skipped = await this.subtitlesStage();
        break;
      case 'visuals':
        skipped = await this.visualsStage();
        break;
      case 'render':
        skipped = await this.renderStage();
        break;
      case 'qa':
        skipped = false;
        qaPassed = await this.qaStage();
        break;
      case 'archive':
        skipped = await this.archiveStage();
        break;
      default:
        throw new Error(`Etapa desconocida: ${String(stage)}`);
    }

    const last = idx === STAGE_ORDER.length - 1;
    await this.d.store.setProgress(this.id, {
      currentStep: last ? null : STAGE_ORDER[idx + 1],
      progress: (idx + 1) / STAGE_ORDER.length,
    });
    if (last) await this.d.store.setStatus(this.id, 'done');

    return { productionId: this.id, stage, skipped, durationMs: Date.now() - t0, costUsd: this.costUsd, qaPassed };
  }

  /**
   * Idempotent stage: its hash chains the stored hashes of the stages it depends on
   * (by default the previous one), so changing anything upstream re-runs this stage and
   * every stage that depends on it. Returns true if skipped.
   */
  private async stage(
    key: StageKey,
    stage: ProductionStage | null,
    inputs: unknown,
    outputs: string[],
    body: () => Promise<void>,
    deps?: StageKey[],
  ): Promise<boolean> {
    this.opts.signal?.throwIfAborted();
    const after = deps ?? (this.stageIdx > 0 ? [STAGE_ORDER[this.stageIdx - 1]] : []);
    const prev = after.map((k) => this.production.inputHashes[k] ?? '').join('|');
    const hash = inputHash({ prev, key, inputs });
    const archived = new Set((await this.remote()).filter((r) => r.present).map((r) => r.localName));
    const upToDate =
      !this.opts.force &&
      this.production.inputHashes[key] === hash &&
      outputs.every((o) => existsSync(this.file(o)) || archived.has(o));

    if (upToDate) {
      this.emit({ type: 'stage', productionId: this.id, stage: key, state: 'skipped' });
      return true;
    }
    const t0 = Date.now();
    this.emit({ type: 'stage', productionId: this.id, stage: key, state: 'running' });
    await body();
    this.production.inputHashes[key] = hash;
    await this.d.store.markStage(this.id, key, hash, stage ?? undefined);
    this.emit({ type: 'stage', productionId: this.id, stage: key, state: 'done', ms: Date.now() - t0 });
    return false;
  }

  // ── 2 · Guion ───────────────────────────────────────────────────────────

  private async scriptStage(): Promise<boolean> {
    if (this.ref.scriptId) return this.scriptFromDb(this.ref.scriptId);

    const topic = this.ref.topic;
    const inputs = {
      bible: this.channel.bible,
      topic: topic ?? this.channel.topic,
      duration: this.channel.durationTarget,
      translation: this.channel.bibleTranslation,
      provider: await this.d.providers.describe('text', { ...this.scope(), role: 'script' }),
    };

    return this.stage('script', 'scripted', inputs, ['script.json'], async () => {
      const recent = await this.d.store.recentTopics(this.channel.id, 30);
      const { system, prompt } = buildScriptPrompt(this.channel, recent, topic);
      const { result, providerConfigId } = await this.d.providers.call(
        'text',
        { ...this.scope(), role: 'script' },
        (p) =>
          generateStructured(p, { system, prompt, jsonSchema: scriptDraftJsonSchema, temperature: 0.9 }, scriptDraftSchema, this.ctx()),
      );
      const script = await materializeScript(result.value as ScriptDraft, this.channel, this.d.bible);
      await writeFile(this.file('script.json'), JSON.stringify(script, null, 2));
      if (!this.persisted) {
        await this.d.store.createProduction(this.id, this.channel.id, script);
        await this.d.store.setStatus(this.id, 'running');
        await this.d.store.setProgress(this.id, { currentStep: 'script', progress: 0 });
        this.persisted = true;
      }
      await this.cost(providerConfigId, 'script', result.usage);
      this.emit({ type: 'info', productionId: this.id, message: `Guion: ${script.title}` });
    });
  }

  /** Approved script from the DB: script.json is a copy, no model call. */
  private async scriptFromDb(scriptId: string): Promise<boolean> {
    const script = await this.d.store.loadScript(scriptId);
    if (!script) throw new Error(`No existe el guion ${scriptId}`);
    if (!this.persisted) throw new Error(`La producción ${this.id} no existe para el guion ${scriptId}`);
    const stored: StoredScript = {
      title: script.title,
      hook: script.hook,
      body: script.body,
      cta: script.cta,
      fullText: script.fullText,
      verseRefs: script.verseRefs,
      metadata: script.metadata,
      scenes: script.scenes,
    };
    const inputs = { source: 'db', scriptId, script: stored };

    return this.stage('script', 'scripted', inputs, ['script.json'], async () => {
      await writeFile(this.file('script.json'), JSON.stringify(stored, null, 2));
      this.emit({ type: 'info', productionId: this.id, message: `Guion aprobado: ${stored.title}` });
    });
  }

  // ── 3 · Voz ─────────────────────────────────────────────────────────────

  private async voiceStage(): Promise<boolean> {
    const script = await this.script();
    const voice = this.channel.voice;
    const inputs = {
      text: script.fullText,
      voice,
      provider: await this.d.providers.describe('tts', this.scope()),
    };

    return this.stage('voice', 'voiced', inputs, ['voice.wav'], async () => {
      const rawPath = this.file('voice.raw.wav');
      const { result, providerConfigId } = await this.d.providers.call('tts', this.scope(), (p) =>
        p.synthesize(
          {
            text: script.fullText,
            voiceId: voice.voiceId,
            language: voice.language,
            stylePrompt: voice.stylePrompt,
            speed: voice.speed,
            params: voice.params,
            outPath: rawPath,
          },
          this.ctx(),
        ),
      );
      await this.cost(providerConfigId, 'tts', result.usage);
      await this.d.media.normalizeVoice(result.audioPath, this.file('voice.wav'));
      await this.d.store.recordAsset({
        productionId: this.id,
        kind: 'voice',
        localPath: this.file('voice.wav'),
        providerConfigId,
        inputHash: inputHash(inputs),
      });
    });
  }

  // ── 4 · Transcripción y alineación ──────────────────────────────────────

  private async transcribeStage(): Promise<boolean> {
    const inputs = { provider: await this.d.providers.describe('transcribe', this.scope()) };

    return this.stage('transcribe', 'transcribed', inputs, ['words.json', 'transcript.json'], async () => {
      const script = await this.script();
      const audio = await this.local('voice.wav');
      const { result, providerConfigId } = await this.d.providers.call('transcribe', this.scope(), (p) =>
        p.transcribe(
          { audioPath: audio, language: this.channel.language, prompt: script.fullText },
          this.ctx(),
        ),
      );
      await this.cost(providerConfigId, 'transcribe', result.usage);
      const { words, wer } = this.d.media.align(script.fullText, result.words);
      await writeFile(
        this.file('transcript.json'),
        JSON.stringify({ text: result.text, wer, words: result.words }, null, 2),
      );
      await writeFile(this.file('words.json'), JSON.stringify(words, null, 2));
    });
  }

  private async words(): Promise<WordTiming[]> {
    return JSON.parse(await readFile(this.file('words.json'), 'utf8')) as WordTiming[];
  }

  // ── 4b · Subtítulos ─────────────────────────────────────────────────────

  private async subtitlesStage(): Promise<boolean> {
    const style = subtitleStyleFor(this.channel.brandKit);
    return this.stage('subtitles', null, { style, format: this.channel.format }, ['subs.ass'], async () =>
      this.d.media.writeSubtitles(await this.words(), style, this.channel.format, this.file('subs.ass')),
    );
  }

  // ── 5 · Visuales ────────────────────────────────────────────────────────

  private sceneFiles(script: StoredScript): string[] {
    return script.scenes.map((s) => `scenes/${String(s.order).padStart(2, '0')}.jpg`);
  }

  /** Scene clips on the voice timeline (deterministic from script, words and voice length). */
  private async clips(): Promise<SceneClip[]> {
    const script = await this.script();
    const voiceMs = await this.d.media.probeDurationMs(await this.local('voice.wav'));
    const timeline = sceneTimeline(
      script.scenes.map((s) => s.text),
      await this.words(),
      voiceMs,
    );
    const files = this.sceneFiles(script);
    return timeline.map((t, i) => ({ path: this.file(files[i]), kind: 'image' as const, ...t }));
  }

  private async visualsStage(): Promise<boolean> {
    const script = await this.script();
    const sceneFiles = this.sceneFiles(script);
    const inputs = {
      style: this.channel.visualStyle,
      scenes: script.scenes.map((s) => s.keywords),
      provider: await this.d.providers.describe('stock', this.scope()),
    };

    // Scene images come from the script alone: a new voice or brand kit must not re-download
    // (or re-pay for) them.
    return this.stage(
      'visuals',
      'visuals_ready',
      inputs,
      sceneFiles,
      async () => {
        const used = new Set<string>();
        for (const [i, scene] of script.scenes.entries()) {
          this.opts.signal?.throwIfAborted();
          await this.downloadSceneImage(scene.keywords, this.file(sceneFiles[i]), used, scene.visualPrompt);
          this.progress('visuals', (i + 1) / script.scenes.length);
        }
      },
      ['script'],
    );
  }

  /** Tries the scene keywords, then fewer keywords, then a generic query. Avoids repeating a photo. */
  private async downloadSceneImage(
    keywords: string[],
    outPath: string,
    used: Set<string>,
    prompt: string,
  ): Promise<void> {
    const attempts = [keywords, keywords.slice(0, 1), ['nature', 'light']].filter((k) => k.length > 0);
    const ctx = this.ctx();

    for (const kw of attempts) {
      const { result: items, providerConfigId } = await this.d.providers.call('stock', this.scope(), (p) =>
        p.search({ keywords: kw, mediaType: 'photo', orientation: 'portrait', perPage: 15 }, ctx),
      );
      const item = items.find((it) => !used.has(`${it.provider}:${it.id}`));
      if (!item) continue;
      used.add(`${item.provider}:${item.id}`);

      const { result } = await this.d.providers.call('stock', this.scope(), (p) => p.download(item, outPath, ctx));
      await this.cost(providerConfigId, 'stock', result.usage);
      await this.d.store.recordAsset({
        productionId: this.id,
        kind: 'scene-image',
        localPath: outPath,
        providerConfigId,
        prompt: `${kw.join(' ')} · ${prompt}`,
        inputHash: inputHash({ item: `${item.provider}:${item.id}` }),
      });
      return;
    }
    throw new Error(`No se encontró ninguna imagen de stock para: ${keywords.join(', ')}`);
  }

  // ── 6 · Montaje ─────────────────────────────────────────────────────────

  private async renderStage(): Promise<boolean> {
    const clips = await this.clips();
    const inputs = { clips: clips.map((c) => [c.startMs, c.endMs]), format: this.channel.format };

    // Re-renders when the subtitles (voice, words, brand kit) or the scene images change.
    return this.stage(
      'render',
      'rendered',
      inputs,
      ['render.mp4', 'thumb.jpg'],
      async () => {
        const { encoder } = await this.d.media.render(
          {
            scenes: clips,
            voicePath: this.file('voice.wav'),
            subsPath: this.file('subs.ass'),
            format: this.channel.format,
            outPath: this.file('render.mp4'),
          },
          { signal: this.opts.signal, onProgress: (value) => this.progress('render', value) },
        );
        await this.d.media.thumbnail(this.file('render.mp4'), this.file('thumb.jpg'), 1200);
        const durationMs = await this.d.media.probeDurationMs(this.file('render.mp4'));
        await this.d.store.setRender(this.id, this.file('render.mp4'), durationMs);
        // A re-render of a freed production puts the heavy files back on disk.
        await this.d.store.setFreed(this.id, false);
        this.emit({ type: 'info', productionId: this.id, message: `Render con ${encoder}` });
        for (const [kind, name] of [['render', 'render.mp4'], ['thumb', 'thumb.jpg']] as const) {
          await this.d.store.recordAsset({
            productionId: this.id,
            kind,
            localPath: this.file(name),
            inputHash: inputHash(inputs),
          });
        }
      },
      ['subtitles', 'visuals'],
    );
  }

  // ── 7 · QA (subset de Fase 1) ───────────────────────────────────────────

  private async qaStage(): Promise<boolean> {
    // QA always re-runs: it's cheap and its thresholds may change.
    this.opts.signal?.throwIfAborted();
    const script = await this.script();
    const checks: QaCheck[] = [];

    const durationS = (await this.d.media.probeDurationMs(await this.local('render.mp4'))) / 1000;
    const { min, max } = this.channel.durationTarget;
    checks.push({
      name: 'duración',
      passed: durationS >= min - 5 && durationS <= max + 10,
      value: Number(durationS.toFixed(1)),
      threshold: `${min - 5}–${max + 10} s`,
    });

    const transcript = JSON.parse(await readFile(this.file('transcript.json'), 'utf8')) as { wer: number };
    checks.push({
      name: 'WER voz vs guion',
      passed: transcript.wer <= MAX_WER,
      value: Number((transcript.wer * 100).toFixed(1)),
      threshold: `≤ ${MAX_WER * 100} %`,
    });

    const lufs = await this.d.media.measureLoudness(this.file('render.mp4'));
    checks.push({
      name: 'volumen integrado',
      passed: Math.abs(lufs - TARGET_LUFS) <= LUFS_TOLERANCE,
      value: Number(lufs.toFixed(1)),
      threshold: `${TARGET_LUFS} ± ${LUFS_TOLERANCE} LUFS`,
    });

    const translation = this.channel.bibleTranslation;
    if (translation) {
      for (const ref of script.verseRefs) {
        const text = await this.d.bible.passage(ref, translation);
        const { exact } = await this.d.bible.verify(text, ref, translation);
        const inScript = script.fullText.includes(text.trim());
        checks.push({
          name: `versículo ${this.d.bible.format(ref)}`,
          passed: exact && inScript,
          value: !exact ? 'no coincide' : inScript ? 'exacto' : 'no aparece en el guion',
          threshold: 'texto exacto de la Biblia local',
        });
      }
    }

    const passed = checks.every((c) => c.passed);
    await writeFile(this.file('qa.json'), JSON.stringify({ passed, checks }, null, 2));
    await this.d.store.markStage(this.id, 'qa', inputHash(checks), passed ? 'qa_passed' : 'qa_failed');
    this.emit({
      type: 'info',
      productionId: this.id,
      message: `QA ${passed ? 'aprobado' : 'con fallas'}: ${
        checks
          .filter((c) => !c.passed)
          .map((c) => `${c.name} = ${c.value}`)
          .join(', ') || 'todo en orden'
      }`,
    });
    return passed;
  }

  // ── 8 · Archivo (Drive u otro StorageProvider) ─────────────────────────

  private async qaPassed(): Promise<boolean> {
    try {
      return (JSON.parse(await readFile(this.file('qa.json'), 'utf8')) as { passed: boolean }).passed;
    } catch {
      return false;
    }
  }

  /**
   * Uploads render, cover, voice and script. Automatic only after a passing QA and when the
   * channel archives automatically; `force` (the "Subir" button) uploads anyway. Files whose
   * checksum is already in the remote are not sent again.
   */
  private async archiveStage(): Promise<boolean> {
    const configId = await this.d.providers.boundConfigId('storage', this.scope());
    const skipReason = !configId
      ? 'no hay almacenamiento configurado'
      : this.opts.force
        ? undefined
        : !this.channel.autoArchive
          ? 'el canal no archiva automáticamente'
          : !(await this.qaPassed())
            ? 'el QA tiene fallas'
            : undefined;
    if (skipReason) {
      const hash = inputHash({ key: 'archive', skip: skipReason });
      this.production.inputHashes['archive'] = hash;
      await this.d.store.markStage(this.id, 'archive', hash);
      this.emit({ type: 'info', productionId: this.id, message: `Archivo: no se sube (${skipReason})` });
      this.emit({ type: 'stage', productionId: this.id, stage: 'archive', state: 'skipped' });
      return true;
    }

    const files: { kind: ArchivedKind; name: string; folder: string; path: string; md5: string; size: number }[] = [];
    for (const f of ARCHIVE_FILES) {
      const path = await this.local(f.name);
      if (!existsSync(path)) continue;
      files.push({ ...f, path, md5: await md5File(path), size: statSync(path).size });
    }
    const remote = await this.remote();
    const inputs = {
      provider: await this.d.providers.describe('storage', this.scope()),
      files: files.map((f) => [f.kind, f.md5]),
      // A file "Sincronizar" found missing in the remote makes the stage upload again.
      missing: remote.filter((r) => !r.present).map((r) => r.kind),
    };

    return this.stage('archive', null, inputs, [], async () => {
      const script = await this.script();
      const month = (this.production.createdAt ?? new Date().toISOString()).slice(0, 7);
      const base = `${this.id.slice(0, 8)}-${slugify(script.title)}`;
      const total = files.reduce((sum, f) => sum + f.size, 0) || 1;
      let done = 0;
      let uploaded = 0;

      for (const f of files) {
        const prev = remote.find((r) => r.kind === f.kind && r.providerConfigId === configId);
        if (prev?.present && prev.md5 === f.md5) {
          done += f.size;
          continue;
        }
        const remotePath =
          prev?.remotePath ?? `${channelFolderName(this.channel)}/${f.folder}/${month}/${base}${extname(f.name)}`;
        const { result, providerConfigId } = await this.d.providers.call('storage', this.scope(), (p) =>
          p.put(f.path, remotePath, this.ctx(), {
            onProgress: (sent) => this.progress('archive', Math.min(1, (done + sent) / total)),
          }),
        );
        if (result.file.md5 && result.file.md5 !== f.md5) {
          throw new Error(`El checksum de ${f.name} en el archivo no coincide con el local`);
        }
        await this.cost(providerConfigId, 'storage', result.usage);
        await this.d.store.recordRemoteFile(this.id, this.channel.id, {
          kind: f.kind,
          localName: f.name,
          providerConfigId,
          remoteId: result.file.remoteId,
          remotePath: result.file.remotePath,
          md5: result.file.md5 ?? f.md5,
          sizeBytes: result.file.sizeBytes,
        });
        done += f.size;
        uploaded++;
      }
      this.progress('archive', 1);
      this.emit({
        type: 'info',
        productionId: this.id,
        message: uploaded ? `Archivado: ${uploaded} archivo(s) verificados` : 'Archivo: ya estaba todo subido',
      });
    });
  }
}
