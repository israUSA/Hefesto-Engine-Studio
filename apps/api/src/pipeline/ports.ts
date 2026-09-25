import type {
  Capability,
  Channel,
  ProductionStage,
  PricingUnit,
  RunStatus,
  StageKey,
  TextRole,
  VerseRef,
  WordTiming,
} from '@hefesto/shared-types';
import type { CapabilityMap, ResolvableCapability } from '../providers/contracts';

/**
 * Ports the pipeline depends on. The pipeline never imports the DB, SDKs or
 * binaries directly; `pipeline.module.ts` binds these to the real services.
 */

export const PRODUCTION_STORE = Symbol('PRODUCTION_STORE');
export const PROVIDER_GATEWAY = Symbol('PROVIDER_GATEWAY');
export const MEDIA_TOOLS = Symbol('MEDIA_TOOLS');
export const BIBLE_LOOKUP = Symbol('BIBLE_LOOKUP');

export interface ProductionRecord {
  id: string;
  channelId: string;
  scriptId?: string;
  stage?: ProductionStage;
  status: RunStatus;
  inputHashes: Record<string, string>;
}

export interface ProductionStore {
  getChannelBySlug(slug: string): Promise<Channel | null>;
  getChannelById(id: string): Promise<Channel | null>;
  /** Recent script titles/hooks of the channel, to avoid repeating topics. */
  recentTopics(channelId: string, limit: number): Promise<string[]>;
  /** Stores the script, its scenes and the production (with a pre-assigned id). */
  createProduction(id: string, channelId: string, script: StoredScript): Promise<void>;
  /** Creates the production row for an existing (approved) script. */
  createProductionForScript(id: string, channelId: string, scriptId: string): Promise<void>;
  /** The stored script with its scenes, or null if it doesn't exist. */
  loadScript(scriptId: string): Promise<(StoredScript & { channelId: string; status: string }) | null>;
  getProduction(id: string): Promise<ProductionRecord | null>;
  /** Live position of the production in the pipeline (currentStep, 0–1 progress). */
  setProgress(productionId: string, patch: { currentStep?: StageKey | null; progress?: number }): Promise<void>;
  /** Forgets the stored input hashes of these stages so they re-run. */
  clearStageHashes(productionId: string, keys: string[]): Promise<void>;
  /** Saves the stage's input hash under `key` and advances `stage` when given. */
  markStage(productionId: string, key: string, hash: string, stage?: ProductionStage): Promise<void>;
  setRender(productionId: string, renderPath: string, durationMs: number): Promise<void>;
  /** Sets the run status; `error` is stored (and cleared when omitted). */
  setStatus(productionId: string, status: RunStatus, error?: string): Promise<void>;
  recordCost(entry: {
    channelId: string;
    productionId?: string;
    providerConfigId: string;
    operation: string;
    units: number;
    unit: PricingUnit;
    costUsd: number;
    durationMs: number;
  }): Promise<void>;
  recordAsset(asset: {
    productionId: string;
    kind: 'voice' | 'words' | 'subs' | 'scene-image' | 'scene-video' | 'render' | 'thumb';
    localPath: string;
    providerConfigId?: string;
    prompt?: string;
    inputHash: string;
  }): Promise<void>;
}

export interface StoredScript {
  title: string;
  hook: string;
  body: string;
  cta: string;
  fullText: string;
  verseRefs: VerseRef[];
  metadata: unknown;
  scenes: { order: number; text: string; visualPrompt: string; keywords: string[] }[];
}

export interface ProviderCall<T> {
  result: T;
  providerConfigId: string;
}

export interface ProviderGateway {
  /** Resolves the channel's binding (with fallbacks) and runs `fn` with the provider. */
  call<C extends ResolvableCapability, T>(
    capability: C,
    scope: { channelId: string; role?: TextRole },
    fn: (provider: CapabilityMap[C]) => Promise<T>,
  ): Promise<ProviderCall<T>>;
  /** Stable identity of the provider that would serve the call (for input hashes). */
  describe(capability: Capability, scope: { channelId: string; role?: TextRole }): Promise<string>;
}

export interface SceneClip {
  path: string;
  kind: 'image' | 'video';
  startMs: number;
  endMs: number;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  uppercase: boolean;
}

export interface MediaTools {
  normalizeVoice(inPath: string, outPath: string): Promise<{ durationMs: number }>;
  measureLoudness(path: string): Promise<number>;
  probeDurationMs(path: string): Promise<number>;
  /** Maps transcript timings onto the script words (one timing per script word) and computes WER (0–1). */
  align(scriptText: string, transcript: WordTiming[]): { words: WordTiming[]; wer: number };
  writeSubtitles(words: WordTiming[], style: SubtitleStyle, format: Channel['format'], outPath: string): Promise<void>;
  render(
    input: { scenes: SceneClip[]; voicePath: string; subsPath: string; format: Channel['format']; outPath: string },
    opts: { onProgress?: (p: number) => void; signal?: AbortSignal },
  ): Promise<{ encoder: string; durationMs: number }>;
  thumbnail(videoPath: string, outPath: string, atMs: number): Promise<void>;
}

export interface BibleLookup {
  /** Exact verse text from the local Bible. Throws if the reference doesn't exist. */
  passage(ref: VerseRef, translation: string): Promise<string>;
  format(ref: VerseRef): string;
  verify(text: string, ref: VerseRef, translation: string): Promise<{ exact: boolean; similarity: number }>;
}
