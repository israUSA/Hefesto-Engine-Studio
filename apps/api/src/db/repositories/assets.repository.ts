import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { assets } from '../schema';
import { newId, nowIso } from '../util';

export type AssetRow = typeof assets.$inferSelect;
export type NewAsset = Omit<typeof assets.$inferInsert, 'id' | 'createdAt'> & { id?: string };

@Injectable()
export class AssetsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  findById(id: string): AssetRow | undefined {
    return this.db.select().from(assets).where(eq(assets.id, id)).get();
  }

  listByProduction(productionId: string): AssetRow[] {
    return this.db.select().from(assets).where(eq(assets.productionId, productionId)).all();
  }

  /** Reusable-bank lookup: same input hash means the same output, no need to regenerate. */
  findByInputHash(inputHash: string): AssetRow | undefined {
    return this.db.select().from(assets).where(eq(assets.inputHash, inputHash)).get();
  }

  create(input: NewAsset): AssetRow {
    const id = input.id ?? newId();
    this.db
      .insert(assets)
      .values({ ...input, id, createdAt: nowIso() })
      .run();
    return this.findById(id) as AssetRow;
  }
}
