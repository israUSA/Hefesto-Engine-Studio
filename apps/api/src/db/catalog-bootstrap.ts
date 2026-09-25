import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DB, type DbInstance } from './db.token';
import { importBundledBible } from './bundled-bible';
import { seedProviderCatalog } from './seed';

/** A fresh install gets the provider catalog and the bundled Bible on first start; existing settings are left alone. */
@Injectable()
export class CatalogBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger('Setup');

  constructor(@Inject(DB) private readonly db: DbInstance) {}

  onApplicationBootstrap(): void {
    seedProviderCatalog(this.db);
    const bible = importBundledBible(this.db);
    if (bible.imported) this.log.log(`RV1909 importada (${bible.verses} versículos)`);
  }
}
