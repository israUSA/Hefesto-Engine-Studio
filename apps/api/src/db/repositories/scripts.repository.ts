import { Inject, Injectable } from '@nestjs/common';
import type { Platform, PlatformMetadata, ScriptDto, ScriptPatch, VerseRef } from '@hefesto/shared-types';
import { desc, eq, inArray } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { scenes, scripts } from '../schema';
import { newId, nowIso } from '../util';

/** Spanish narration pace used to estimate a script's duration (docs/04 §2). */
const WORDS_PER_SECOND = 2.5;

export interface NewScriptScene {
  order: number;
  text: string;
  visualPrompt: string;
}

export interface NewScript {
  channelId: string;
  ideaId?: string;
  title: string;
  hook: string;
  body: string;
  cta: string;
  fullText: string;
  verseRefs: VerseRef[];
  metadata: Partial<Record<Platform, PlatformMetadata>>;
  scenes: NewScriptScene[];
  status?: 'draft' | 'approved' | 'rejected';
}

type ScriptRow = typeof scripts.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;

function toDomain(row: ScriptRow, sceneRows: SceneRow[]): ScriptDto {
  const wordCount = row.fullText.trim().split(/\s+/).filter(Boolean).length;
  return {
    id: row.id,
    channelId: row.channelId,
    ideaId: row.ideaId ?? undefined,
    title: row.title ?? row.hook,
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    fullText: row.fullText,
    verseRefs: row.verseRefs,
    scenes: sceneRows
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ order: s.order, text: s.text, visualPrompt: s.visualPrompt })),
    status: row.status,
    wordCount,
    estimatedDurationSec: Math.round(wordCount / WORDS_PER_SECOND),
    createdAt: row.createdAt,
  };
}

@Injectable()
export class ScriptsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  private scenesFor(scriptId: string): SceneRow[] {
    return this.db.select().from(scenes).where(eq(scenes.scriptId, scriptId)).all();
  }

  findById(id: string): ScriptDto | undefined {
    const row = this.db.select().from(scripts).where(eq(scripts.id, id)).get();
    return row ? toDomain(row, this.scenesFor(id)) : undefined;
  }

  findByIds(ids: string[]): ScriptDto[] {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(scripts)
      .where(inArray(scripts.id, ids))
      .all()
      .map((row) => toDomain(row, this.scenesFor(row.id)));
  }

  listByChannel(channelId: string): ScriptDto[] {
    return this.db
      .select()
      .from(scripts)
      .where(eq(scripts.channelId, channelId))
      .orderBy(desc(scripts.createdAt))
      .all()
      .map((row) => toDomain(row, this.scenesFor(row.id)));
  }

  /** Every script across every channel, for the board when no channel filter is given. */
  listAll(): ScriptDto[] {
    return this.db
      .select()
      .from(scripts)
      .orderBy(desc(scripts.createdAt))
      .all()
      .map((row) => toDomain(row, this.scenesFor(row.id)));
  }

  create(input: NewScript): ScriptDto {
    const id = newId();
    const timestamp = nowIso();
    this.db.transaction((tx) => {
      tx.insert(scripts)
        .values({
          id,
          channelId: input.channelId,
          ideaId: input.ideaId ?? null,
          title: input.title,
          hook: input.hook,
          body: input.body,
          cta: input.cta,
          fullText: input.fullText,
          verseRefs: input.verseRefs,
          metadata: input.metadata,
          status: input.status ?? 'draft',
          createdAt: timestamp,
        })
        .run();
      for (const s of input.scenes) {
        tx.insert(scenes)
          .values({ id: newId(), scriptId: id, order: s.order, text: s.text, visualPrompt: s.visualPrompt })
          .run();
      }
    });
    return this.findById(id) as ScriptDto;
  }

  patch(id: string, patch: ScriptPatch): ScriptDto | undefined {
    if (!this.findById(id)) return undefined;
    const set: Partial<ScriptRow> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.hook !== undefined) set.hook = patch.hook;
    if (patch.body !== undefined) set.body = patch.body;
    if (patch.cta !== undefined) set.cta = patch.cta;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.hook !== undefined || patch.body !== undefined || patch.cta !== undefined) {
      const current = this.db.select().from(scripts).where(eq(scripts.id, id)).get() as ScriptRow;
      const hook = patch.hook ?? current.hook;
      const body = patch.body ?? current.body;
      const cta = patch.cta ?? current.cta;
      set.fullText = [hook, body, cta].filter(Boolean).join(' ');
    }
    this.db.update(scripts).set(set).where(eq(scripts.id, id)).run();
    return this.findById(id);
  }
}
