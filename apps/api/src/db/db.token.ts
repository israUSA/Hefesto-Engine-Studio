import type { DbInstance } from './migrate';

/** Injection token for the drizzle instance. Lives apart from db.module.ts to avoid an import cycle with the repositories. */
export const DB = 'DB';
export type { DbInstance };
