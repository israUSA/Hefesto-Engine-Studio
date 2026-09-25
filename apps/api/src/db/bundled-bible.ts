import { sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../config/env';
import type { DbInstance } from './migrate';
import { bibleVerses } from './schema';
import { newId } from './util';

interface BibleJson {
  translation: string;
  verses: { book: string; chapter: number; verse: number; text: string }[];
}

/**
 * Imports the public-domain RV1909 shipped in data/bible (see data/bible/README.md).
 * No-op when it's already there. Returns how many verses the translation has.
 */
export function importBundledBible(db: DbInstance, file = join(env.dataDir, 'bible', 'rv1909.json')): {
  imported: boolean;
  verses: number;
} {
  const { count } = db
    .select({ count: sql<number>`count(*)` })
    .from(bibleVerses)
    .where(sql`${bibleVerses.translation} = 'RV1909'`)
    .get() ?? { count: 0 };
  if (count > 30000) return { imported: false, verses: count };

  if (!existsSync(file)) throw new Error(`No se encontró la Biblia en ${file}`);
  const bible = JSON.parse(readFileSync(file, 'utf8')) as BibleJson;

  db.transaction((tx) => {
    for (let i = 0; i < bible.verses.length; i += 300) {
      tx.insert(bibleVerses)
        .values(bible.verses.slice(i, i + 300).map((v) => ({ id: newId(), translation: bible.translation, ...v })))
        .onConflictDoUpdate({
          target: [bibleVerses.translation, bibleVerses.book, bibleVerses.chapter, bibleVerses.verse],
          set: { text: sql`excluded.text` },
        })
        .run();
    }
  });
  return { imported: true, verses: bible.verses.length };
}
