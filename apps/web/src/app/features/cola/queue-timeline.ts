import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { JobDto, Lane, StageKey } from '@hefesto/shared-types';
import { formatClockTime } from '@hefesto/web-ui';

const STAGE_LABEL: Record<StageKey, string> = {
  script: 'Guion',
  voice: 'Voz',
  transcribe: 'Whisper',
  subtitles: 'Subtítulos',
  visuals: 'Imágenes',
  render: 'Render',
  qa: 'QA',
};

const PX_PER_MIN = 44;
const MIN_BLOCK_PX = 58;
const MAX_VISIBLE_BLOCKS = 6;
const DEFAULT_STAGE_MS = 45_000;
const RULER_TICKS = 6;
const MIN_WINDOW_MS = 5 * 60_000;
const MAX_WINDOW_MS = 30 * 60_000;

export interface LaneRow {
  lane: Lane;
  label: string;
  concurrency: number;
  running: JobDto[];
  queued: JobDto[];
}

interface Block {
  id: string;
  label: string;
  widthPx: number;
  state: 'running' | 'queued' | 'error';
  pct: number;
}

interface LaneVm {
  lane: Lane;
  label: string;
  concurrencyLabel: string;
  blocks: Block[];
  overflowCount: number;
  overflowClock: string;
}

/** Presentational timeline: one horizontal strip per lane (GPU · Red · CPU), scaled by expected duration. */
@Component({
  selector: 'hf-queue-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hf-timeline">
      <div class="hf-timeline__ruler">
        <span class="hf-timeline__now">AHORA</span>
        @for (tick of ticks(); track tick.ms) {
          <span class="hf-timeline__tick">{{ tick.label }}</span>
        }
      </div>

      @for (row of laneVms(); track row.lane) {
        <div class="hf-timeline__lane">
          <div class="hf-timeline__lane-head">
            <span class="hf-timeline__lane-name">{{ row.label }}</span>
            <span class="hf-timeline__lane-conc">{{ row.concurrencyLabel }}</span>
          </div>
          <div class="hf-timeline__track">
            @if (row.blocks.length === 0) {
              <span class="hf-timeline__empty">sin tareas</span>
            }
            @for (block of row.blocks; track block.id) {
              <div
                class="hf-timeline__block"
                [class]="'hf-timeline__block--' + block.state"
                [style.width.px]="block.widthPx"
              >
                @if (block.state === 'running') {
                  <span class="hf-timeline__fill" [style.width.%]="block.pct"></span>
                }
                <span class="hf-timeline__block-label">{{ block.label }}</span>
              </div>
            }
            @if (row.overflowCount > 0) {
              <div class="hf-timeline__overflow">+ {{ row.overflowCount }} más → {{ row.overflowClock }}</div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .hf-timeline {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      padding: var(--space-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      background: var(--surface-2);
    }
    .hf-timeline__ruler {
      display: flex;
      align-items: center;
      gap: var(--space-5);
      padding-left: 108px;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: var(--tracking-label);
      text-transform: uppercase;
      color: var(--text-3);
    }
    .hf-timeline__now {
      color: var(--accent);
    }
    .hf-timeline__lane {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .hf-timeline__lane-head {
      flex: none;
      width: 96px;
      display: flex;
      flex-direction: column;
    }
    .hf-timeline__lane-name {
      font-weight: 500;
      color: var(--text);
      font-size: var(--text-sm);
    }
    .hf-timeline__lane-conc {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-3);
    }
    .hf-timeline__track {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      overflow-x: auto;
      padding: var(--space-1) 0;
    }
    .hf-timeline__empty {
      color: var(--text-3);
      font-size: var(--text-xs);
    }
    .hf-timeline__block {
      position: relative;
      flex: none;
      height: 28px;
      border-radius: var(--radius-sm);
      background: var(--surface-3);
      border: 1px solid var(--line);
      display: flex;
      align-items: center;
      overflow: hidden;
    }
    .hf-timeline__block-label {
      position: relative;
      z-index: 1;
      padding: 0 var(--space-2);
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-2);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hf-timeline__block--running {
      border-color: var(--accent);
    }
    .hf-timeline__block--running .hf-timeline__block-label {
      color: var(--text);
    }
    .hf-timeline__fill {
      position: absolute;
      inset: 0;
      background: var(--accent-soft);
      border-right: 2px solid var(--accent);
    }
    .hf-timeline__block--error {
      border-color: var(--danger);
      background: var(--danger-soft);
    }
    .hf-timeline__block--error .hf-timeline__block-label {
      color: var(--danger);
    }
    .hf-timeline__overflow {
      flex: none;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-3);
      white-space: nowrap;
    }
  `,
})
export class QueueTimeline {
  readonly rows = input.required<LaneRow[]>();

  private readonly windowMs = computed(() => {
    const totals = this.rows().map((row) => this.laneTotalMs(row));
    const max = Math.max(0, ...totals);
    return Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, max));
  });

  readonly ticks = computed(() => {
    const window = this.windowMs();
    const step = window / RULER_TICKS;
    return Array.from({ length: RULER_TICKS }, (_, i) => {
      const ms = step * (i + 1);
      return { ms, label: `+${Math.round(ms / 60000)} min` };
    });
  });

  readonly laneVms = computed<LaneVm[]>(() =>
    this.rows().map((row) => {
      const jobs = [...row.running, ...row.queued];
      const blocks: Block[] = [];
      let overflowCount = 0;
      let overflowMs = 0;
      jobs.forEach((job, index) => {
        const durationMs = job.expectedMs ?? DEFAULT_STAGE_MS;
        if (index < MAX_VISIBLE_BLOCKS) {
          const widthPx = Math.max(MIN_BLOCK_PX, Math.round((durationMs / 60000) * PX_PER_MIN));
          const isRunning = job.status === 'running';
          blocks.push({
            id: job.id,
            label: `${STAGE_LABEL[job.type] ?? job.type}${isRunning ? ' · ' + Math.round(this.pct(job)) + '%' : ''}`,
            widthPx,
            state: job.status === 'failed' ? 'error' : isRunning ? 'running' : 'queued',
            pct: isRunning ? this.pct(job) : 0,
          });
        } else {
          overflowCount += 1;
          overflowMs += durationMs;
        }
      });
      const visibleMs = jobs.slice(0, MAX_VISIBLE_BLOCKS).reduce((sum, j) => sum + (j.expectedMs ?? DEFAULT_STAGE_MS), 0);
      return {
        lane: row.lane,
        label: row.label,
        concurrencyLabel: row.lane === 'gpu' ? '1 a la vez' : `${row.concurrency} en paralelo`,
        blocks,
        overflowCount,
        overflowClock: overflowCount > 0 ? formatClockTime(Date.now() + visibleMs + overflowMs) : '',
      };
    }),
  );

  private pct(job: JobDto): number {
    const raw = job.progress ?? 0;
    return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
  }

  private laneTotalMs(row: LaneRow): number {
    return [...row.running, ...row.queued].reduce((sum, j) => sum + (j.expectedMs ?? DEFAULT_STAGE_MS), 0);
  }
}
