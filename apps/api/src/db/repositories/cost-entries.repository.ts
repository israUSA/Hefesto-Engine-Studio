import { Inject, Injectable } from '@nestjs/common';
import type { CostEntry } from '@hefesto/shared-types';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { costEntries } from '../schema';
import { newId, nowIso } from '../util';

export type NewCostEntry = Omit<CostEntry, 'id' | 'createdAt' | 'unit'> & {
  unit: 'char' | 'token' | 'image' | 'second' | 'request';
};

function toDomain(row: typeof costEntries.$inferSelect): CostEntry {
  return {
    id: row.id,
    productionId: row.productionId ?? undefined,
    channelId: row.channelId,
    providerConfigId: row.providerConfigId,
    operation: row.operation,
    units: row.units,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class CostEntriesRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  insert(entry: NewCostEntry): CostEntry {
    const id = newId();
    this.db
      .insert(costEntries)
      .values({
        id,
        productionId: entry.productionId ?? null,
        channelId: entry.channelId,
        providerConfigId: entry.providerConfigId,
        operation: entry.operation,
        units: entry.units,
        unit: entry.unit,
        costUsd: entry.costUsd,
        durationMs: entry.durationMs,
        createdAt: nowIso(),
      })
      .run();
    const row = this.db.select().from(costEntries).where(eq(costEntries.id, id)).get();
    return toDomain(row as typeof costEntries.$inferSelect);
  }

  listByProduction(productionId: string): CostEntry[] {
    return this.db
      .select()
      .from(costEntries)
      .where(eq(costEntries.productionId, productionId))
      .all()
      .map(toDomain);
  }

  sumByProduction(productionId: string): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${costEntries.costUsd}), 0)` })
      .from(costEntries)
      .where(eq(costEntries.productionId, productionId))
      .get();
    return row?.total ?? 0;
  }

  sumByChannel(channelId: string): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${costEntries.costUsd}), 0)` })
      .from(costEntries)
      .where(eq(costEntries.channelId, channelId))
      .get();
    return row?.total ?? 0;
  }

  sumByChannelSince(channelId: string, isoDate: string): number {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${costEntries.costUsd}), 0)` })
      .from(costEntries)
      .where(and(eq(costEntries.channelId, channelId), gte(costEntries.createdAt, isoDate)))
      .get();
    return row?.total ?? 0;
  }
}
