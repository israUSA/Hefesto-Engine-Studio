/**
 * Runtime migrator: creates/updates the SQLite DB at `paths.db()` on startup.
 * Applies every migration under `apps/api/drizzle/` in order, tracked with
 * drizzle's own `__drizzle_migrations` table — including the hand-written
 * FTS5 setup (0001_bible_fts.sql), which additionally uses `IF NOT EXISTS`
 * everywhere so it is harmless to ever re-run by hand.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type DbInstance = BetterSQLite3Database<typeof schema>;

/** Resolves the `drizzle/` migrations folder both from ts-node (src) and from a webpack bundle (dist). */
function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '../../drizzle'), // src/db -> apps/api/drizzle
    join(__dirname, '../drizzle'), // dist bundle where src is flattened one level
    join(process.cwd(), 'apps/api/drizzle'),
    join(process.cwd(), 'drizzle'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `No se encontró la carpeta de migraciones. Probé: ${candidates.join(', ')}`,
    );
  }
  return found;
}

export function openDatabase(dbFile: string): Database.Database {
  mkdirSync(dirname(dbFile), { recursive: true });
  const sqlite = new Database(dbFile);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function runMigrations(sqlite: Database.Database): void {
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}

/** Opens (creating if needed) the DB at `dbFile`, migrates it and returns a drizzle instance. */
export function createDb(dbFile: string): { db: DbInstance; sqlite: Database.Database } {
  const sqlite = openDatabase(dbFile);
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
