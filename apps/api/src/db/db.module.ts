import { Module, OnModuleDestroy } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { paths } from '../config/env';
import { DB, type DbInstance } from './db.token';
import { CatalogBootstrap } from './catalog-bootstrap';
import { createDb } from './migrate';
import {
  AssetsRepository,
  ChannelsRepository,
  CostEntriesRepository,
  IdeasRepository,
  ProductionsRepository,
  ProviderBindingsRepository,
  ProviderConfigsRepository,
  ScriptsRepository,
  SettingsRepository,
} from './repositories';

export { DB, type DbInstance };

let sharedSqlite: Database.Database | undefined;

/**
 * Creates (or reuses) the SQLite connection at `paths.db()`, running
 * migrations on first open. WAL mode and foreign keys are enabled in
 * `openDatabase` (see `migrate.ts`).
 */
function dbFactory(): DbInstance {
  const { db, sqlite } = createDb(paths.db());
  sharedSqlite = sqlite;
  return db;
}

const repositories = [
  ChannelsRepository,
  ProductionsRepository,
  AssetsRepository,
  CostEntriesRepository,
  ProviderConfigsRepository,
  ProviderBindingsRepository,
  IdeasRepository,
  ScriptsRepository,
  SettingsRepository,
];

@Module({
  providers: [{ provide: DB, useFactory: dbFactory }, CatalogBootstrap, ...repositories],
  exports: [DB, ...repositories],
})
export class DbModule implements OnModuleDestroy {
  onModuleDestroy(): void {
    sharedSqlite?.close();
    sharedSqlite = undefined;
  }
}
