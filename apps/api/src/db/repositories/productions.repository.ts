import { Inject, Injectable } from '@nestjs/common';
import type { ProductionStage, RunStatus } from '@hefesto/shared-types';
import { and, desc, eq, gte } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { productions } from '../schema';
import { newId, nowIso } from '../util';

export type ProductionRow = typeof productions.$inferSelect;

@Injectable()
export class ProductionsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  findById(id: string): ProductionRow | undefined {
    return this.db.select().from(productions).where(eq(productions.id, id)).get();
  }

  listByChannel(channelId: string): ProductionRow[] {
    return this.db.select().from(productions).where(eq(productions.channelId, channelId)).all();
  }

  /** Every production, newest first, for the library/queue listing. */
  listAll(): ProductionRow[] {
    return this.db.select().from(productions).orderBy(desc(productions.createdAt)).all();
  }

  countSince(channelId: string, isoDate: string): number {
    return this.db
      .select()
      .from(productions)
      .where(and(eq(productions.channelId, channelId), gte(productions.createdAt, isoDate)))
      .all().length;
  }

  latest(channelId: string): ProductionRow | undefined {
    return this.db
      .select()
      .from(productions)
      .where(eq(productions.channelId, channelId))
      .orderBy(desc(productions.createdAt))
      .limit(1)
      .get();
  }

  delete(id: string): void {
    this.db.delete(productions).where(eq(productions.id, id)).run();
  }

  create(input: { scriptId: string; channelId: string; id?: string }): ProductionRow {
    const id = input.id ?? newId();
    const timestamp = nowIso();
    this.db
      .insert(productions)
      .values({
        id,
        scriptId: input.scriptId,
        channelId: input.channelId,
        stage: 'scripted',
        status: 'pending',
        inputHashes: {},
        costUsd: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return this.findById(id) as ProductionRow;
  }

  /** Advances (or replays) a stage and merges its input hash, used for idempotency checks. */
  updateStage(
    id: string,
    stage: ProductionStage,
    inputHashes: Record<string, string>,
    status: RunStatus = 'running',
  ): ProductionRow {
    const current = this.findById(id);
    if (!current) {
      throw new Error(`Production no encontrada: ${id}`);
    }
    this.db
      .update(productions)
      .set({
        stage,
        status,
        inputHashes: { ...current.inputHashes, ...inputHashes },
        updatedAt: nowIso(),
      })
      .where(eq(productions.id, id))
      .run();
    return this.findById(id) as ProductionRow;
  }

  updateStatus(id: string, status: RunStatus): ProductionRow {
    this.db
      .update(productions)
      .set({ status, updatedAt: nowIso() })
      .where(eq(productions.id, id))
      .run();
    return this.findById(id) as ProductionRow;
  }

  setRenderResult(id: string, renderPath: string, durationMs: number): ProductionRow {
    this.db
      .update(productions)
      .set({ renderPath, durationMs, updatedAt: nowIso() })
      .where(eq(productions.id, id))
      .run();
    return this.findById(id) as ProductionRow;
  }
}
