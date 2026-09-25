import { Inject, Injectable } from '@nestjs/common';
import type { Lane, StageKey } from '@hefesto/shared-types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type DbInstance } from '../db/db.token';
import { jobs, settings } from '../db/schema';
import { newId, nowIso } from '../db/util';
import type { JobPayload } from './queue.tokens';

export type JobRow = Omit<typeof jobs.$inferSelect, 'payload' | 'type'> & { type: StageKey; payload: JobPayload };
export type JobPatch = Partial<Omit<typeof jobs.$inferInsert, 'id'>>;

const ACTIVE = ['queued', 'running'] as const;
const FINISHED = ['done', 'failed', 'skipped', 'canceled'] as const;

const byProduction = (productionId: string) =>
  sql`json_extract(${jobs.payload}, '$.productionId') = ${productionId}`;

/** Persistence of the queue: the `jobs` table plus its keys in `settings`. */
@Injectable()
export class JobsStore {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  insert(input: {
    productionId: string | null;
    channelId: string;
    type: StageKey;
    lane: Lane;
    priority: number;
    payload: JobPayload;
    maxAttempts?: number;
  }): JobRow {
    const id = newId();
    this.db
      .insert(jobs)
      .values({
        id,
        productionId: input.productionId,
        channelId: input.channelId,
        type: input.type,
        lane: input.lane,
        status: 'queued',
        priority: input.priority,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        payload: input.payload as unknown as Record<string, unknown>,
        progress: 0,
        createdAt: nowIso(),
      })
      .run();
    return this.get(id) as JobRow;
  }

  get(id: string): JobRow | undefined {
    return this.db.select().from(jobs).where(eq(jobs.id, id)).get() as unknown as JobRow | undefined;
  }

  update(id: string, patch: JobPatch): JobRow | undefined {
    this.db.update(jobs).set(patch).where(eq(jobs.id, id)).run();
    return this.get(id);
  }

  /** Queued jobs in pick order: priority, then production order, then insertion order. */
  queued(): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'queued'))
      .orderBy(desc(jobs.priority), sql`json_extract(${jobs.payload}, '$.seq')`, sql`${jobs}.rowid`)
      .all() as unknown as JobRow[];
  }

  running(): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'running'))
      .orderBy(jobs.startedAt)
      .all() as unknown as JobRow[];
  }

  recent(limit: number): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, [...FINISHED]))
      .orderBy(desc(jobs.finishedAt), desc(sql`${jobs}.rowid`))
      .limit(limit)
      .all() as unknown as JobRow[];
  }

  activeForProduction(productionId: string): JobRow[] {
    return this.db
      .select()
      .from(jobs)
      .where(and(byProduction(productionId), inArray(jobs.status, [...ACTIVE])))
      .all() as unknown as JobRow[];
  }

  latestForProduction(productionId: string): JobRow | undefined {
    return this.db
      .select()
      .from(jobs)
      .where(byProduction(productionId))
      .orderBy(desc(sql`${jobs}.rowid`))
      .limit(1)
      .get() as unknown as JobRow | undefined;
  }

  /** Links the jobs of a new production to its row once the script stage created it. */
  attachProduction(productionId: string): void {
    this.db
      .update(jobs)
      .set({ productionId })
      .where(and(byProduction(productionId), isNull(jobs.productionId)))
      .run();
  }

  /** Removes every job of a production (needed before deleting the production row). */
  deleteForProduction(productionId: string): number {
    return this.db.delete(jobs).where(byProduction(productionId)).run().changes;
  }

  /** Crash recovery: jobs left `running` by a dead process go back to the queue. */
  requeueRunning(): number {
    return this.db
      .update(jobs)
      .set({ status: 'queued', progress: 0, startedAt: null })
      .where(eq(jobs.status, 'running'))
      .run().changes;
  }

  /** Average duration of the last `n` real (not cached) runs per type + lane. */
  averageDurations(n = 20): Map<string, number> {
    const rows = this.db.all<{ type: string; lane: string; avg: number }>(sql`
      SELECT type, lane, avg(duration_ms) AS avg FROM (
        SELECT type, lane, duration_ms,
               row_number() OVER (PARTITION BY type, lane ORDER BY finished_at DESC) AS rn
        FROM jobs
        WHERE status = 'done' AND duration_ms IS NOT NULL
          AND coalesce(json_extract(payload, '$.cached'), 0) = 0
      ) WHERE rn <= ${n} GROUP BY type, lane`);
    return new Map(rows.map((r) => [`${r.type}:${r.lane}`, r.avg]));
  }

  /** Lane of the most recent job of each stage, as a hint for future stages. */
  lastLanes(): Map<StageKey, Lane> {
    const rows = this.db.all<{ type: StageKey; lane: Lane }>(sql`
      SELECT type, lane FROM jobs j
      WHERE rowid = (SELECT max(rowid) FROM jobs WHERE type = j.type)`);
    return new Map(rows.map((r) => [r.type, r.lane]));
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value as T | undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .insert(settings)
      .values({ key, value, updatedAt: nowIso() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: nowIso() } })
      .run();
  }

  deleteSetting(key: string): void {
    this.db.delete(settings).where(eq(settings.key, key)).run();
  }
}
