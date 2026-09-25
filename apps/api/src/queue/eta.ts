import type { Lane, StageKey } from '@hefesto/shared-types';

/** Fallback durations while a stage has no history. */
export const DEFAULT_STAGE_MS: Record<StageKey, number> = {
  script: 20_000,
  voice: 25_000,
  transcribe: 40_000,
  subtitles: 500,
  visuals: 15_000,
  render: 90_000,
  qa: 8_000,
};

/** Lane guess for stages that aren't enqueued yet (no job, no provider resolved). */
export const DEFAULT_STAGE_LANE: Record<StageKey, Lane> = {
  script: 'net',
  voice: 'net',
  transcribe: 'cpu',
  subtitles: 'cpu',
  visuals: 'net',
  render: 'cpu',
  qa: 'cpu',
};

export interface SimStep {
  lane: Lane;
  ms: number;
}

/** One production: its remaining stages in order. */
export interface SimChain {
  steps: SimStep[];
  priority: number;
  seq: number;
  /** The first step is already running with this much left. */
  runningRemainingMs?: number;
}

/**
 * Time until every chain finishes, simulating the lanes' concurrency with the same
 * pick order as the scheduler (priority, then production order). A production runs one
 * stage at a time; different productions overlap across lanes.
 */
export function simulateEta(chains: SimChain[], concurrency: Record<Lane, number>): number {
  interface State {
    chain: SimChain;
    next: number;
    readyAt: number;
    busyUntil?: number;
  }
  const states: State[] = chains
    .filter((c) => c.steps.length > 0)
    .map((chain) => ({ chain, next: 0, readyAt: 0 }));
  const busy: Record<Lane, number> = { gpu: 0, net: 0, cpu: 0 };

  // Jobs already running hold their slot even if the limit changed meanwhile.
  for (const s of states) {
    if (s.chain.runningRemainingMs === undefined) continue;
    s.busyUntil = Math.max(0, s.chain.runningRemainingMs);
    busy[s.chain.steps[0].lane]++;
  }

  const order = (a: State, b: State) => b.chain.priority - a.chain.priority || a.chain.seq - b.chain.seq;
  let now = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    const waiting = states
      .filter((s) => s.busyUntil === undefined && s.next < s.chain.steps.length && s.readyAt <= now)
      .sort(order);
    for (const s of waiting) {
      const step = s.chain.steps[s.next];
      if (busy[step.lane] >= Math.max(1, concurrency[step.lane])) continue;
      busy[step.lane]++;
      s.busyUntil = now + step.ms;
    }

    const running = states.filter((s) => s.busyUntil !== undefined);
    if (running.length === 0) break;
    now = Math.min(...running.map((s) => s.busyUntil as number));
    for (const s of running) {
      if (s.busyUntil !== now) continue;
      busy[s.chain.steps[s.next].lane]--;
      s.busyUntil = undefined;
      s.next++;
      s.readyAt = now;
    }
  }
  return Math.round(now);
}
