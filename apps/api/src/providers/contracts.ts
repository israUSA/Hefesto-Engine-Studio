import type {
  Capability,
  HealthResult,
  ProviderConfig,
  ProviderManifest,
  Usage,
  WordTiming,
} from '@hefesto/shared-types';

/**
 * Every adapter implements one or more capability interfaces.
 * Pipeline stages only talk to these interfaces, never to SDKs, binaries or HTTP APIs.
 */
export interface Provider {
  readonly manifest: ProviderManifest;
  readonly config: ProviderConfig;
  healthCheck(): Promise<HealthResult>;
}

/** Context passed to every call: used for cost logging and cancellation. */
export interface CallContext {
  channelId: string;
  productionId?: string;
  signal?: AbortSignal;
}

// ── Text ────────────────────────────────────────────────────────────────

export interface TextInput {
  system?: string;
  prompt: string;
  /** JSON schema for structured output. Adapters without native support embed it in the prompt. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TextResult {
  text: string;
  usage: Usage;
}

export interface TextProvider extends Provider {
  generate(input: TextInput, ctx: CallContext): Promise<TextResult>;
}

// ── Embeddings ──────────────────────────────────────────────────────────

export interface EmbeddingProvider extends Provider {
  embed(texts: string[], ctx: CallContext): Promise<{ vectors: number[][]; usage: Usage }>;
}

// ── TTS ─────────────────────────────────────────────────────────────────

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: 'female' | 'male' | 'neutral';
  sampleUrl?: string;
}

export interface TtsInput {
  text: string;
  voiceId: string;
  language: string;
  stylePrompt?: string;
  speed?: number;
  params?: Record<string, unknown>;
  /** Absolute path where the adapter must write the audio (any format; the stage normalizes it). */
  outPath: string;
}

export interface TtsResult {
  audioPath: string;
  durationMs: number;
  usage: Usage;
}

export interface TtsProvider extends Provider {
  synthesize(input: TtsInput, ctx: CallContext): Promise<TtsResult>;
  listVoices(language: string): Promise<Voice[]>;
}

// ── Transcription ───────────────────────────────────────────────────────

export interface TranscribeInput {
  audioPath: string;
  language: string;
  /** Known script text: lets providers bias recognition. */
  prompt?: string;
}

export interface TranscribeResult {
  text: string;
  words: WordTiming[];
  usage: Usage;
}

export interface TranscriptionProvider extends Provider {
  transcribe(input: TranscribeInput, ctx: CallContext): Promise<TranscribeResult>;
}

// ── Stock media ─────────────────────────────────────────────────────────

export interface StockQuery {
  keywords: string[];
  mediaType: 'photo' | 'video';
  orientation: 'portrait' | 'landscape';
  minDurationSec?: number;
  perPage?: number;
}

export interface StockItem {
  id: string;
  provider: string;
  mediaType: 'photo' | 'video';
  width: number;
  height: number;
  durationSec?: number;
  downloadUrl: string;
  pageUrl: string;
  author?: string;
  license: string;
}

export interface StockMediaProvider extends Provider {
  search(query: StockQuery, ctx: CallContext): Promise<StockItem[]>;
  download(item: StockItem, outPath: string, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
}

// ── Image / video generation ────────────────────────────────────────────

export interface ImageInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  outPath: string;
}

export interface ImageProvider extends Provider {
  generate(input: ImageInput, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
}

export interface VideoInput extends ImageInput {
  durationSec: number;
}

export interface VideoProvider extends Provider {
  generate(input: VideoInput, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
}

// ── Storage ─────────────────────────────────────────────────────────────

export interface StoredFile {
  remoteId: string;
  remotePath: string;
  sizeBytes: number;
  md5?: string;
}

export interface StorageProvider extends Provider {
  put(localPath: string, remotePath: string, ctx: CallContext): Promise<StoredFile>;
  get(remoteId: string, localPath: string, ctx: CallContext): Promise<void>;
  exists(remotePath: string): Promise<StoredFile | null>;
}

// ── Registry ────────────────────────────────────────────────────────────

export interface CapabilityMap {
  text: TextProvider;
  embedding: EmbeddingProvider;
  tts: TtsProvider;
  transcribe: TranscriptionProvider;
  stock: StockMediaProvider;
  image: ImageProvider;
  video: VideoProvider;
  storage: StorageProvider;
}

export type ResolvableCapability = keyof CapabilityMap & Capability;

/** Builds a provider instance from its config. One factory per adapter. */
export interface ProviderFactory {
  readonly manifest: ProviderManifest;
  create(config: ProviderConfig, env: NodeJS.ProcessEnv): Provider;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly adapter: string,
    /** true = worth retrying or falling back (rate limit, timeout, 5xx). */
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
