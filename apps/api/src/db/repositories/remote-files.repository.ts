import { Inject, Injectable } from '@nestjs/common';
import type { ArchivedKind } from '@hefesto/shared-types';
import { and, eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { remoteFiles } from '../schema';
import { newId, nowIso } from '../util';

export type RemoteFileRow = typeof remoteFiles.$inferSelect;

export interface NewRemoteFile {
  productionId: string;
  channelId: string;
  kind: ArchivedKind;
  localName: string;
  providerConfigId: string;
  remoteId: string;
  remotePath: string;
  md5: string;
  sizeBytes: number;
}

/** Index of what each production has in the storage provider (docs/06 · índice). */
@Injectable()
export class RemoteFilesRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  list(): RemoteFileRow[] {
    return this.db.select().from(remoteFiles).all();
  }

  forProduction(productionId: string): RemoteFileRow[] {
    return this.db.select().from(remoteFiles).where(eq(remoteFiles.productionId, productionId)).all();
  }

  /** One row per production and kind: archiving again replaces it. */
  upsert(file: NewRemoteFile): RemoteFileRow {
    const existing = this.db
      .select()
      .from(remoteFiles)
      .where(and(eq(remoteFiles.productionId, file.productionId), eq(remoteFiles.kind, file.kind)))
      .get();
    const values = { ...file, present: true, syncedAt: nowIso() };
    if (existing) {
      this.db.update(remoteFiles).set(values).where(eq(remoteFiles.id, existing.id)).run();
      return { ...existing, ...values };
    }
    const row = { id: newId(), ...values };
    this.db.insert(remoteFiles).values(row).run();
    return row;
  }

  setPresent(id: string, present: boolean): void {
    this.db.update(remoteFiles).set({ present, syncedAt: nowIso() }).where(eq(remoteFiles.id, id)).run();
  }

  deleteForProduction(productionId: string): void {
    this.db.delete(remoteFiles).where(eq(remoteFiles.productionId, productionId)).run();
  }
}
