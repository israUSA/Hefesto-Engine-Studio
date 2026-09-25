/** Test-only helper: an in-memory SQLite DB with every migration applied. */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { runMigrations } from './migrate';
import type { DbInstance } from './migrate';

export function createTestDb(): { db: DbInstance; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  return { db: drizzle(sqlite, { schema }), sqlite };
}
