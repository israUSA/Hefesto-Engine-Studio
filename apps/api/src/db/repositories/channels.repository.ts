import { Inject, Injectable } from '@nestjs/common';
import type { Channel } from '@hefesto/shared-types';
import { eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { channels } from '../schema';
import { newId, nowIso } from '../util';

export type NewChannel = Omit<Channel, 'id'> & { id?: string };

function toDomain(row: typeof channels.$inferSelect): Channel {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    platform: row.platform,
    handle: row.handle,
    language: row.language,
    format: row.format,
    topic: row.topic,
    bible: row.bible,
    bibleTranslation: row.bibleTranslation ?? undefined,
    durationTarget: row.durationTarget,
    aiLabel: row.aiLabel,
    monetized: row.monetized,
    active: row.active,
    voice: row.voiceProfile,
    visualStyle: row.visualStyle,
  };
}

@Injectable()
export class ChannelsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  findBySlug(slug: string): Channel | undefined {
    const row = this.db.select().from(channels).where(eq(channels.slug, slug)).get();
    return row ? toDomain(row) : undefined;
  }

  findById(id: string): Channel | undefined {
    const row = this.db.select().from(channels).where(eq(channels.id, id)).get();
    return row ? toDomain(row) : undefined;
  }

  list(): Channel[] {
    return this.db.select().from(channels).all().map(toDomain);
  }

  create(channel: NewChannel): Channel {
    const id = channel.id ?? newId();
    const timestamp = nowIso();
    this.db
      .insert(channels)
      .values({
        id,
        name: channel.name,
        slug: channel.slug,
        platform: channel.platform,
        handle: channel.handle,
        language: channel.language,
        format: channel.format,
        topic: channel.topic,
        bible: channel.bible,
        bibleTranslation: channel.bibleTranslation ?? null,
        durationTarget: channel.durationTarget,
        voiceProfile: channel.voice,
        visualStyle: channel.visualStyle,
        aiLabel: channel.aiLabel,
        monetized: channel.monetized,
        active: channel.active,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return this.findById(id) as Channel;
  }

  /** Partial update for PATCH /api/channels/:id. */
  update(id: string, patch: Partial<NewChannel>): Channel | undefined {
    if (!this.findById(id)) return undefined;
    const set: Partial<typeof channels.$inferInsert> = { updatedAt: nowIso() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.slug !== undefined) set.slug = patch.slug;
    if (patch.platform !== undefined) set.platform = patch.platform;
    if (patch.handle !== undefined) set.handle = patch.handle;
    if (patch.language !== undefined) set.language = patch.language;
    if (patch.format !== undefined) set.format = patch.format;
    if (patch.topic !== undefined) set.topic = patch.topic;
    if (patch.bible !== undefined) set.bible = patch.bible;
    if (patch.bibleTranslation !== undefined) set.bibleTranslation = patch.bibleTranslation ?? null;
    if (patch.durationTarget !== undefined) set.durationTarget = patch.durationTarget;
    if (patch.voice !== undefined) set.voiceProfile = patch.voice;
    if (patch.visualStyle !== undefined) set.visualStyle = patch.visualStyle;
    if (patch.aiLabel !== undefined) set.aiLabel = patch.aiLabel;
    if (patch.monetized !== undefined) set.monetized = patch.monetized;
    if (patch.active !== undefined) set.active = patch.active;
    this.db.update(channels).set(set).where(eq(channels.id, id)).run();
    return this.findById(id);
  }

  setActive(id: string, active: boolean): void {
    this.db.update(channels).set({ active, updatedAt: nowIso() }).where(eq(channels.id, id)).run();
  }

  /** Insert-or-update by slug, so seeding can run any number of times. */
  upsertBySlug(channel: NewChannel): Channel {
    const existing = this.findBySlug(channel.slug);
    if (!existing) {
      return this.create(channel);
    }
    this.db
      .update(channels)
      .set({
        name: channel.name,
        platform: channel.platform,
        handle: channel.handle,
        language: channel.language,
        format: channel.format,
        topic: channel.topic,
        bible: channel.bible,
        bibleTranslation: channel.bibleTranslation ?? null,
        durationTarget: channel.durationTarget,
        voiceProfile: channel.voice,
        visualStyle: channel.visualStyle,
        aiLabel: channel.aiLabel,
        monetized: channel.monetized,
        active: channel.active,
        updatedAt: nowIso(),
      })
      .where(eq(channels.id, existing.id))
      .run();
    return this.findById(existing.id) as Channel;
  }
}
