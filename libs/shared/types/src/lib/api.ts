/**
 * HTTP + WebSocket contract between apps/web and apps/api (Fase 2).
 * REST lives under `/api`, live events under the WebSocket `/ws`.
 * Change this file first, then both sides.
 */
import type { BrandKit, Channel, Platform, ProductionStage, RunStatus, VerseRef } from './domain';
import type {
  Capability,
  HealthResult,
  Lane,
  ProviderConfig,
  ProviderManifest,
  TextRole,
} from './providers';

// ── Channels ────────────────────────────────────────────────────────────
// GET    /api/channels                 → ChannelSummary[]
// GET    /api/channels/:slug           → Channel
// POST   /api/channels                 ChannelInput → Channel
// PATCH  /api/channels/:id             Partial<ChannelInput> → Channel
// DELETE /api/channels/:id             → 204 (soft: active = false)
// POST   /api/channels/:id/voice-preview  VoicePreviewRequest → VoicePreviewResponse

/** `brandKit` and `autoArchive` are optional on input: missing means DEFAULT_BRAND_KIT and `true`. */
export type ChannelInput = Omit<Channel, 'id' | 'brandKit' | 'autoArchive'> & { brandKit?: BrandKit; autoArchive?: boolean };

// GET    /api/fonts                     → FontDto[]   (subtitle fonts available to the renderer)
// GET    /api/fonts/:file               → the font file (for the Identidad preview)
export interface FontDto {
  family: string;
  url: string;
}

// GET    /api/channel-templates         → ChannelTemplateDto[]
// The product ships with no channels: the user starts blank or from a niche template.
export interface ChannelTemplateDto {
  id: string;
  name: string;
  description: string;
  niche: string;
  defaults: Partial<Omit<ChannelInput, 'name' | 'slug' | 'handle' | 'platform'>>;
}

export interface ChannelSummary {
  channel: Channel;
  videosThisMonth: number;
  inQueue: number;
  lastProducedAt?: string;
  costThisMonthUsd: number;
}

export interface VoicePreviewRequest {
  /** Defaults to a short sample in the channel's language. */
  text?: string;
  voice?: Partial<Channel['voice']>;
}

export interface VoicePreviewResponse {
  audioUrl: string;
  durationMs: number;
  costUsd: number;
}

// ── Ideas & scripts (kanban) ────────────────────────────────────────────
// GET    /api/board?channelId=          → Board
// POST   /api/ideas/generate            GenerateIdeasRequest → IdeaDto[]
// PATCH  /api/ideas/:id                 { status } → IdeaDto
// POST   /api/scripts/generate          GenerateScriptRequest → ScriptDto
// PATCH  /api/scripts/:id               ScriptPatch → ScriptDto
// GET    /api/scripts/:id               → ScriptDto

export type IdeaStatus = 'new' | 'accepted' | 'rejected' | 'used';

export interface IdeaDto {
  id: string;
  channelId: string;
  title: string;
  angle: string;
  status: IdeaStatus;
  source: 'ai' | 'manual';
  createdAt: string;
}

export type ScriptStatus = 'draft' | 'approved' | 'rejected';

export interface ScriptDto {
  id: string;
  channelId: string;
  ideaId?: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  fullText: string;
  verseRefs: VerseRef[];
  scenes: { order: number; text: string; visualPrompt: string }[];
  status: ScriptStatus;
  wordCount: number;
  estimatedDurationSec: number;
  createdAt: string;
}

export interface GenerateIdeasRequest {
  channelId: string;
  count: number;
  hint?: string;
}

export interface GenerateScriptRequest {
  channelId: string;
  ideaId?: string;
  topic?: string;
}

export type ScriptPatch = Partial<Pick<ScriptDto, 'status' | 'hook' | 'body' | 'cta' | 'title'>>;

export type BoardColumnId = 'idea' | 'script' | 'approved' | 'produced' | 'reviewed' | 'published';

export interface BoardCard {
  id: string;
  kind: 'idea' | 'script' | 'production';
  column: BoardColumnId;
  channelId: string;
  title: string;
  subtitle?: string;
  durationSec?: number;
  verseRef?: string;
  thumbUrl?: string;
  updatedAt: string;
}

export interface Board {
  columns: { id: BoardColumnId; label: string; cards: BoardCard[] }[];
}

// ── Productions & library ───────────────────────────────────────────────
// POST   /api/productions/estimate      ProduceRequest → ProduceEstimate
// POST   /api/productions               ProduceRequest → ProductionSummary[]   (enqueues)
// GET    /api/productions?channelId=&status=&limit=&offset= → Page<ProductionSummary>
// GET    /api/productions/:id           → ProductionDetail
// POST   /api/productions/:id/retry     { fromStage?: StageKey } → ProductionSummary
// DELETE /api/productions/:id           → 204 (deletes files too)
// GET    /api/files/:productionId/:file → file stream with HTTP Range (render.mp4, thumb.jpg, voice.wav, scenes/00.jpg)

/** `archive` uploads the render, cover, voice and script to the storage provider (docs/06). */
export type StageKey = 'script' | 'voice' | 'transcribe' | 'subtitles' | 'visuals' | 'render' | 'qa' | 'archive';

export const STAGE_ORDER: StageKey[] = ['script', 'voice', 'transcribe', 'subtitles', 'visuals', 'render', 'qa', 'archive'];

export interface ProduceRequest {
  channelIds: string[];
  /** Videos per channel when no scriptIds are given. */
  count: number;
  /** Produce these approved scripts instead of generating new ones. */
  scriptIds?: string[];
  topic?: string;
  priority?: number;
}

export interface ProduceEstimate {
  videos: number;
  jobs: number;
  etaMs: number;
  costUsd: number;
  byStage: { stage: StageKey; lane: Lane; avgMs: number; costUsd: number }[];
  /** Human-readable blockers, e.g. "Falta GEMINI_API_KEY". Empty = ready. */
  blockers: string[];
}

export interface ProductionSummary {
  id: string;
  channelId: string;
  channelName: string;
  title: string;
  stage?: ProductionStage;
  currentStep?: StageKey;
  status: RunStatus;
  progress: number;
  durationMs?: number;
  qaPassed?: boolean;
  costUsd: number;
  thumbUrl?: string;
  /** Only while the render is on disk (not after "Liberar espacio"). */
  videoUrl?: string;
  /** Where the archived files are. Absent until the production has a render. */
  archive?: ArchiveState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/**
 * `remote` = the render is in the storage provider with a verified checksum.
 * `onDisk` = the heavy files (render, voice) are in HEFESTO_HOME; false after freeing space.
 */
export interface ArchiveState {
  remote: boolean;
  onDisk: boolean;
}

export interface QaCheckDto {
  name: string;
  passed: boolean;
  value: number | string;
  threshold: string;
}

export interface ProductionDetail extends ProductionSummary {
  script: ScriptDto;
  scenes: { order: number; text: string; startMs: number; endMs: number; imageUrl?: string }[];
  qa?: { passed: boolean; checks: QaCheckDto[] };
  costs: { providerName: string; operation: string; costUsd: number; durationMs: number }[];
  stages: { key: StageKey; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; durationMs?: number }[];
  platform: Platform;
}

export interface Page<T> {
  items: T[];
  total: number;
}

// ── Queue ───────────────────────────────────────────────────────────────
// GET    /api/queue                     → QueueState
// POST   /api/queue/pause | /api/queue/resume → QueueState
// POST   /api/queue/jobs/:id/skip | /cancel | /retry → JobDto
// POST   /api/queue/retry-failed        → RetryFailedResult
// PATCH  /api/queue/jobs/:id            { priority } → JobDto
// PATCH  /api/queue/lanes/:lane         { concurrency } → QueueState

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'canceled';

export interface JobDto {
  id: string;
  productionId?: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  type: StageKey;
  lane: Lane;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  progress: number;
  error?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Expected duration from history (avg of the last runs of this stage + lane). */
  expectedMs?: number;
}

export interface QueueState {
  paused: boolean;
  lanes: Record<Lane, { concurrency: number; running: JobDto[] }>;
  queued: JobDto[];
  recent: JobDto[];
  etaMs: number;
  /** Productions whose latest job failed: what POST /api/queue/retry-failed would re-queue. */
  retryableCount: number;
}

export interface RetryFailedResult {
  /** Jobs put back in the queue: the latest failed job of each production. */
  retried: JobDto[];
}

// ── Providers & keys ────────────────────────────────────────────────────
// GET    /api/providers                 → ProviderDto[]
// PATCH  /api/providers/:id             Partial<ProviderConfig> → ProviderDto
// POST   /api/providers                 Omit<ProviderConfig,'id'> → ProviderDto
// POST   /api/providers/:id/test        → HealthResult
// GET    /api/bindings?channelId=       → BindingDto[]
// PUT    /api/bindings                  BindingDto → BindingDto
// GET    /api/secrets                   → SecretDto[]                    (never the value)
// PUT    /api/secrets/:name             { value } → SecretDto            (write-only)
// DELETE /api/secrets/:name             → 204

export interface ProviderDto {
  config: ProviderConfig;
  manifest: ProviderManifest;
  /** Secret the config needs and whether it's loaded. */
  secret?: { name: string; present: boolean; last4?: string };
  lastHealth?: HealthResult & { checkedAt: string };
}

export interface BindingDto {
  channelId: string | null;
  capability: Capability;
  role?: TextRole;
  providerConfigId: string;
  fallbackIds: string[];
  params: Record<string, unknown>;
}

export interface SecretDto {
  name: string;
  last4: string;
  updatedAt: string;
  source: 'vault' | 'env';
  usedBy: string[];
}

// ── Storage (Drive) ─────────────────────────────────────────────────────
// GET    /api/storage                   → StorageOverview
// PUT    /api/storage/target            StorageTargetRequest → StorageOverview   (which provider archives)
// POST   /api/storage/sync              → StorageOverview   (reconciles the index with the remote)
// POST   /api/storage/free              { productionIds?: string[] } → FreeSpaceResult
// POST   /api/storage/upload            { productionIds?: string[] } → UploadResult   (enqueues `archive`, even if QA failed; none = every video not archived yet)
// POST   /api/storage/productions/:id/restore  → ProductionSummary   (downloads the freed files back)
// GET    /api/storage/google            → GoogleAccountStatus
// PUT    /api/storage/google/client     GoogleClientRequest → GoogleAccountStatus   (write-only)
// POST   /api/storage/google/connect    → { authUrl: string }   (open it in the browser)
// GET    /api/storage/google/callback   OAuth redirect (loopback) → HTML page
// DELETE /api/storage/google            → GoogleAccountStatus   (forgets the token)

/** Files the `archive` stage uploads for each production (docs/06 · estructura). */
export type ArchivedKind = 'render' | 'thumb' | 'voice' | 'script';

export const ARCHIVED_KINDS: ArchivedKind[] = ['render', 'thumb', 'voice', 'script'];

export interface StorageProviderInfo {
  configId: string;
  name: string;
  adapter: string;
  displayName: string;
  /** Root folder shown to the user ("/Hefesto Engine Studio" or "D:\NAS\Hefesto Engine Studio"). */
  root: string;
  /** Link to open the root folder in the browser (Drive). */
  webUrl?: string;
  /** false when the provider is bound but can't be used (e.g. Google not connected). */
  ready: boolean;
  problem?: string;
}

export interface StorageChannelRow {
  channelId: string;
  channelName: string;
  platform: Platform;
  /** Productions with a render. */
  videos: number;
  /** In the remote (verified) and on disk. */
  both: number;
  /** Only in the remote: freed from disk. */
  remoteOnly: number;
  /** Only on disk: not archived yet. */
  diskOnly: number;
  /** Neither: freed and later missing from the remote (see "Sincronizar"). */
  missing: number;
  freeableBytes: number;
}

export interface StorageOverview {
  /** Absent = nothing is archived: no storage provider bound. */
  provider?: StorageProviderInfo;
  lastSyncAt?: string;
  remote: { bytes: number; byKind: Record<ArchivedKind, { count: number; bytes: number }> };
  /** Heavy production files (render, voice) currently on disk. */
  onDiskBytes: number;
  /** On disk and verified in the remote: what "Liberar espacio" would delete. */
  freeableBytes: number;
  freeableVideos: number;
  channels: StorageChannelRow[];
  /** Latest archived file, to show the folder structure. */
  example?: string;
}

export type StorageTargetRequest = { adapter: 'google-drive' } | { adapter: 'local-folder'; root: string } | { adapter: 'none' };

export interface UploadResult {
  queued: number;
}

export interface FreeSpaceResult {
  productions: number;
  freedBytes: number;
}

export interface GoogleClientRequest {
  clientId: string;
  clientSecret: string;
}

export interface GoogleAccountStatus {
  /** OAuth client (desktop app) loaded in the vault. */
  clientConfigured: boolean;
  connected: boolean;
  email?: string;
  /** Loopback redirect the OAuth client must allow. */
  redirectUri: string;
  scope: string;
}

// ── System ──────────────────────────────────────────────────────────────
// GET    /api/system/telemetry          → Telemetry
// GET    /api/system/info               → SystemInfo
// GET    /api/logs?limit=&level=&source= → LogEntry[]

export interface Telemetry {
  gpu?: { name: string; utilPct: number; tempC?: number; vramUsedMb: number; vramTotalMb: number };
  cpu: { pct: number; threads: number };
  memory: { usedMb: number; totalMb: number };
  disk: { freeGb: number; totalGb: number; path: string };
  capturedAt: string;
}

export interface SystemInfo {
  version: string;
  home: string;
  encoder: { name: string; usesGpu: boolean };
  whisper: { model: string; cuda: boolean };
  ffmpeg: string;
  platform: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: string;
  level: LogLevel;
  source: string;
  message: string;
  productionId?: string;
  jobId?: string;
}

// ── WebSocket /ws (server → client) ─────────────────────────────────────

export type ServerEvent =
  | { type: 'queue'; state: QueueState }
  | { type: 'job'; job: JobDto }
  | { type: 'progress'; jobId: string; productionId?: string; stage: StageKey; value: number }
  | { type: 'production'; production: ProductionSummary }
  | { type: 'log'; entry: LogEntry }
  | { type: 'telemetry'; telemetry: Telemetry };

/** Error body for every non-2xx REST response. */
export interface ApiError {
  statusCode: number;
  message: string;
  details?: unknown;
}
