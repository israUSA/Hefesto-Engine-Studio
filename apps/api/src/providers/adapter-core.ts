import type { HealthResult, ProviderConfig, ProviderManifest, Usage } from '@hefesto/shared-types';
import type {
  CallContext,
  ImageInput,
  StockItem,
  StockQuery,
  StoredFile,
  TextInput,
  TextResult,
  TranscribeInput,
  TranscribeResult,
  TtsInput,
  TtsResult,
  VideoInput,
  Voice,
} from './contracts';

/**
 * What a `ProviderFactory` actually builds: one object per `ProviderConfig`, with one
 * method per capability it implements, each uniquely named.
 *
 * This exists because `TextProvider.generate`, `ImageProvider.generate` and
 * `VideoProvider.generate` share a method name but take incompatible parameter types
 * (`contracts.ts` is fixed and not ours to change). A single adapter instance — `fake`,
 * for example — legitimately supports text *and* image generation, so it cannot
 * structurally implement both interfaces through one `generate` property.
 *
 * `ProviderRegistry.resolve()` adapts an `AdapterCore` into the exact `CapabilityMap[C]`
 * shape the pipeline expects, by wrapping the relevant method under the name the
 * capability interface requires (see `provider-registry.ts#buildFacade`).
 */
export interface AdapterCore {
  readonly manifest: ProviderManifest;
  readonly config: ProviderConfig;
  healthCheck(): Promise<HealthResult>;

  generateText?(input: TextInput, ctx: CallContext): Promise<TextResult>;
  embed?(texts: string[], ctx: CallContext): Promise<{ vectors: number[][]; usage: Usage }>;
  synthesize?(input: TtsInput, ctx: CallContext): Promise<TtsResult>;
  listVoices?(language: string): Promise<Voice[]>;
  transcribe?(input: TranscribeInput, ctx: CallContext): Promise<TranscribeResult>;
  search?(query: StockQuery, ctx: CallContext): Promise<StockItem[]>;
  download?(item: StockItem, outPath: string, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
  generateImage?(input: ImageInput, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
  generateVideo?(input: VideoInput, ctx: CallContext): Promise<{ path: string; usage: Usage }>;
  put?(localPath: string, remotePath: string, ctx: CallContext): Promise<StoredFile>;
  get?(remoteId: string, localPath: string, ctx: CallContext): Promise<void>;
  exists?(remotePath: string): Promise<StoredFile | null>;
}
