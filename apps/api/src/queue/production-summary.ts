import { Inject, Injectable } from '@nestjs/common';
import type { ProductionSummary, StageKey } from '@hefesto/shared-types';
import { eq, inArray, sql } from 'drizzle-orm';
import { DB, type DbInstance } from '../db/db.token';
import { channels, productions, scripts } from '../db/schema';

type Row = {
  p: typeof productions.$inferSelect;
  channelName: string | null;
  platform: string | null;
  scriptTitle: string | null;
  hook: string | null;
  metadata: Record<string, { title?: string } | undefined> | null;
  costUsd: number;
};

/** Reads `ProductionSummary` DTOs straight from the DB (live cost from `cost_entries`). */
@Injectable()
export class ProductionSummaryReader {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  get(id: string): ProductionSummary | null {
    return this.many([id]).get(id) ?? null;
  }

  many(ids: string[]): Map<string, ProductionSummary> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = this.db
      .select({
        p: productions,
        channelName: channels.name,
        platform: channels.platform,
        scriptTitle: scripts.title,
        hook: scripts.hook,
        metadata: scripts.metadata,
        costUsd: sql<number>`(SELECT coalesce(sum(cost_usd), 0) FROM cost_entries WHERE production_id = ${productions.id})`,
      })
      .from(productions)
      .leftJoin(channels, eq(channels.id, productions.channelId))
      .leftJoin(scripts, eq(scripts.id, productions.scriptId))
      .where(inArray(productions.id, unique))
      .all() as Row[];
    return new Map(rows.map((r) => [r.p.id, toSummary(r)]));
  }

  channelNames(): Map<string, string> {
    return new Map(
      this.db
        .select({ id: channels.id, name: channels.name })
        .from(channels)
        .all()
        .map((c) => [c.id, c.name]),
    );
  }
}

function toSummary(r: Row): ProductionSummary {
  const p = r.p;
  const metaTitle = r.platform ? r.metadata?.[r.platform]?.title : undefined;
  const rendered = Boolean(p.renderPath);
  return {
    id: p.id,
    channelId: p.channelId,
    channelName: r.channelName ?? '',
    title: r.scriptTitle ?? metaTitle ?? r.hook ?? 'Sin título',
    stage: p.stage,
    currentStep: (p.currentStep as StageKey | null) ?? undefined,
    status: p.status,
    progress: p.progress,
    durationMs: p.durationMs ?? undefined,
    qaPassed: p.stage === 'qa_passed' ? true : p.stage === 'qa_failed' ? false : undefined,
    costUsd: Number(r.costUsd ?? p.costUsd ?? 0),
    thumbUrl: rendered ? `/api/files/${p.id}/thumb.jpg` : undefined,
    videoUrl: rendered ? `/api/files/${p.id}/render.mp4` : undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    error: p.error ?? undefined,
  };
}
