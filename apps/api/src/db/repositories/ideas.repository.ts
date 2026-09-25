import { Inject, Injectable } from '@nestjs/common';
import type { IdeaDto, IdeaStatus } from '@hefesto/shared-types';
import { desc, eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { ideas } from '../schema';
import { newId, nowIso } from '../util';

export type NewIdea = { channelId: string; title: string; angle: string; source: 'ai' | 'manual' };

function toDomain(row: typeof ideas.$inferSelect): IdeaDto {
  return {
    id: row.id,
    channelId: row.channelId,
    title: row.title,
    angle: row.angle,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class IdeasRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  findById(id: string): IdeaDto | undefined {
    const row = this.db.select().from(ideas).where(eq(ideas.id, id)).get();
    return row ? toDomain(row) : undefined;
  }

  listByChannel(channelId: string): IdeaDto[] {
    return this.db
      .select()
      .from(ideas)
      .where(eq(ideas.channelId, channelId))
      .orderBy(desc(ideas.createdAt))
      .all()
      .map(toDomain);
  }

  /** Titles already used by the channel (any status), so the AI avoids repeating them. */
  listTitlesByChannel(channelId: string, limit = 100): string[] {
    return this.db
      .select({ title: ideas.title })
      .from(ideas)
      .where(eq(ideas.channelId, channelId))
      .orderBy(desc(ideas.createdAt))
      .limit(limit)
      .all()
      .map((r) => r.title);
  }

  create(input: NewIdea): IdeaDto {
    const id = newId();
    const timestamp = nowIso();
    this.db
      .insert(ideas)
      .values({
        id,
        channelId: input.channelId,
        title: input.title,
        angle: input.angle,
        status: 'new',
        source: input.source,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return this.findById(id) as IdeaDto;
  }

  updateStatus(id: string, status: IdeaStatus): IdeaDto | undefined {
    if (!this.findById(id)) return undefined;
    this.db.update(ideas).set({ status, updatedAt: nowIso() }).where(eq(ideas.id, id)).run();
    return this.findById(id);
  }
}
