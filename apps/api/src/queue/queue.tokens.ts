import type { Lane, RunStatus, StageKey } from '@hefesto/shared-types';
import type { ProductionRef, RunStageOptions, StageResult } from '../pipeline/production.service';
import type { ProductionRecord, StoredScript } from '../pipeline/ports';

/** What the queue needs from the pipeline (ProductionService in the app, a fake in tests). */
export const STAGE_RUNNER = Symbol('STAGE_RUNNER');

export interface StageRunner {
  runStage(ref: ProductionRef, stage: StageKey, opts: RunStageOptions): Promise<StageResult>;
  createFromScript(scriptId: string, productionId?: string): Promise<{ productionId: string; channelId: string }>;
  loadScript(scriptId: string): Promise<(StoredScript & { channelId: string; status: string }) | null>;
  getProduction(productionId: string): Promise<ProductionRecord | null>;
  setStatus(productionId: string, status: RunStatus, error?: string): Promise<void>;
  resetFrom(productionId: string, from: StageKey): Promise<void>;
}

/** Decides the lane of a stage job from the provider that will run it. */
export const LANE_RESOLVER = Symbol('LANE_RESOLVER');

export interface LaneContext {
  channelId: string;
  /** Production from an approved script: the script stage is a local copy. */
  scriptId?: string;
}

export interface LaneResolver {
  laneFor(stage: StageKey, ctx: LaneContext): Promise<Lane>;
}

export const QUEUE_OPTIONS = Symbol('QUEUE_OPTIONS');

export interface QueueOptions {
  /**
   * Start the workers (and recover jobs left `running` by a crash) on application
   * bootstrap. The API does; the CLI doesn't, and starts lazily on its first queue call.
   */
  autoStart: boolean;
  /** Retry delay = base × 4^(attempt−1), capped at `backoffMaxMs`. */
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Minimum gap between `queue` events. */
  queueEventThrottleMs: number;
  /** Minimum gap between `progress` events of one job. */
  progressThrottleMs: number;
  /** Heartbeat of the single-process lock in `settings`; also picks up jobs enqueued by another process. */
  lockHeartbeatMs: number;
  /** Poll interval of `waitFor` (covers productions run by another process). */
  waitPollMs: number;
}

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  autoStart: true,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
  queueEventThrottleMs: 250,
  progressThrottleMs: 250,
  lockHeartbeatMs: 5_000,
  waitPollMs: 2_000,
};

/** Lane concurrency limits. GPU is fixed at 1 (rule #2: one GPU task at a time). */
export const LANE_LIMITS: Record<Lane, { min: number; max: number; default: number }> = {
  gpu: { min: 1, max: 1, default: 1 },
  net: { min: 2, max: 4, default: 3 },
  cpu: { min: 1, max: 2, default: 1 },
};

/** Persisted in the `jobs.payload` JSON column. */
export interface JobPayload {
  productionId: string;
  channelId: string;
  topic?: string;
  scriptId?: string;
  /** Ordering key shared by every stage of a production, so videos finish depth-first. */
  seq: number;
  /** Earliest start (epoch ms) after a retryable failure. */
  notBefore?: number;
  /** The stage was up to date and didn't run: excluded from duration averages. */
  cached?: boolean;
}
