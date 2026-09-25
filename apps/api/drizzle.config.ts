import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is only used at dev time to generate SQL migrations from
 * `src/db/schema.ts` (`npx drizzle-kit generate` from `apps/api`). The
 * runtime app never imports this file; it applies the generated .sql files
 * itself (see `src/db/migrate.ts`) against `paths.db()`.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './drizzle/.dev.db',
  },
});
