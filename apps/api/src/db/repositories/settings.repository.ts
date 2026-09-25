import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { settings } from '../schema';
import { nowIso } from '../util';

/** Small key/value store (queue concurrency, paused flag, budget…). */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  get<T>(key: string): T | undefined {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? (row.value as T) : undefined;
  }

  set<T>(key: string, value: T): void {
    const existing = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (existing) {
      this.db.update(settings).set({ value, updatedAt: nowIso() }).where(eq(settings.key, key)).run();
    } else {
      this.db.insert(settings).values({ key, value, updatedAt: nowIso() }).run();
    }
  }
}
