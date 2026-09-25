import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STAGE_ORDER,
  type Channel,
  type ProductionStage,
  type RunStatus,
  type ScriptDraft,
  type StageKey,
  type Usage,
  type WordTiming,
} from '@hefesto/shared-types';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../config/env';
import { generateStructured, scriptDraftJsonSchema, scriptDraftSchema } from '../providers';
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

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontName: 'Archivo Black',
  fontSize: 84,
  primaryColor: '#FFFFFF',
  highlightColor: '#FFD23F',
  uppercase: true,
};

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
   * Idempotent stage: its hash chains the previous stage's stored hash, so changing
   * anything upstream re-runs this stage and every stage after it. Returns true if skipped.
   */
  private async stage(
    key: StageKey,
    stage: ProductionStage | null,
    inputs: unknown,
    outputs: string[],
    body: () => Promise<void>,
  ): Promise<boolean> {
    this.opts.signal?.throwIfAborted();
    const prev = this.stageIdx > 0 ? (this.production.inputHashes[STAGE_ORDER[this.stageIdx - 1]] ?? '') : '';
    const hash = inputHash({ prev, key, inputs });
    const upToDate =
      !this.opts.force &&
      this.production.inputHashes[key] === hash &&
      outputs.every((o) => existsSync(this.file(o)));

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
      const { result, providerConfigId } = await this.d.providers.call('transcribe', this.scope(), (p) =>
        p.transcribe(
          { audioPath: this.file('voice.wav'), language: this.channel.language, prompt: script.fullText },
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
    const style = DEFAULT_SUBTITLE_STYLE;
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
    const voiceMs = await this.d.media.probeDurationMs(this.file('voice.wav'));
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

    return this.stage('visuals', 'visuals_ready', inputs, sceneFiles, async () => {
      const used = new Set<string>();
      for (const [i, scene] of script.scenes.entries()) {
        this.opts.signal?.throwIfAborted();
        await this.downloadSceneImage(scene.keywords, this.file(sceneFiles[i]), used, scene.visualPrompt);
        this.progress('visuals', (i + 1) / script.scenes.length);
      }
    });
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

    return this.stage('render', 'rendered', inputs, ['render.mp4', 'thumb.jpg'], async () => {
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
      this.emit({ type: 'info', productionId: this.id, message: `Render con ${encoder}` });
      for (const [kind, name] of [['render', 'render.mp4'], ['thumb', 'thumb.jpg']] as const) {
        await this.d.store.recordAsset({
          productionId: this.id,
          kind,
          localPath: this.file(name),
          inputHash: inputHash(inputs),
        });
      }
    });
  }

  // ── 7 · QA (subset de Fase 1) ───────────────────────────────────────────

  private async qaStage(): Promise<boolean> {
    // QA always re-runs: it's cheap and its thresholds may change.
    this.opts.signal?.throwIfAborted();
    const script = await this.script();
    const checks: QaCheck[] = [];

    const durationS = (await this.d.media.probeDurationMs(this.file('render.mp4'))) / 1000;
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
}
