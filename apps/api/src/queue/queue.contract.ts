import type {
  JobDto,
  Lane,
  ProduceEstimate,
  ProduceRequest,
  ProductionSummary,
  QueueState,
  StageKey,
} from '@hefesto/shared-types';

/**
 * What the REST layer (and the CLI) may ask of the queue. Implemented by
 * QueueService and provided by QueueModule under the QUEUE_API token.
 */
export const QUEUE_API = Symbol('QUEUE_API');

export interface QueueApi {
  state(): QueueState;
  estimate(req: ProduceRequest): Promise<ProduceEstimate>;
  /** Creates one production per video and enqueues its first stage. */
  enqueue(req: ProduceRequest): Promise<ProductionSummary[]>;
  pause(): QueueState;
  resume(): QueueState;
  /** Stops the job and gives up on its production (the "saltar" of the forge bar). */
  skip(jobId: string): Promise<JobDto>;
  /** Kills the running subprocess / request; the job can be retried later. */
  cancel(jobId: string): Promise<JobDto>;
  retry(jobId: string): Promise<JobDto>;
  setPriority(jobId: string, priority: number): JobDto;
  setLaneConcurrency(lane: Lane, concurrency: number): QueueState;
  /** Re-queues a production from a stage (default: the first failed/pending one). */
  retryProduction(productionId: string, fromStage?: StageKey): Promise<ProductionSummary>;
  /** Resolves when the production reaches done/failed/canceled (used by the CLI). */
  waitFor(productionId: string): Promise<ProductionSummary>;
}
