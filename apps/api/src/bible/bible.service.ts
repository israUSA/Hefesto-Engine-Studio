import { Inject, Injectable } from '@nestjs/common';
import type { VerseRef } from '@hefesto/shared-types';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { DB, type DbInstance } from '../db/db.token';
import { bibleVerses } from '../db/schema';
import { formatReference, parseReference } from './reference-parser';
import { compareTexts } from './verify-quote';

export class BibleTranslationNotFoundError extends Error {
  constructor(translation: string) {
    super(
      `La traducción "${translation}" no está importada. Corré \`npx ts-node --transpile-only tools/import-bible.ts\` (ver data/bible/README.md).`,
    );
    this.name = 'BibleTranslationNotFoundError';
  }
}

export interface Passage {
  ref: VerseRef;
  reference: string;
  translation: string;
  text: string;
  verses: { verse: number; text: string }[];
}

export interface VerseSearchHit {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

@Injectable()
export class BibleService {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  parseReference(input: string): VerseRef {
    return parseReference(input);
  }

  formatReference(ref: VerseRef): string {
    return formatReference(ref);
  }

  /** True once at least one verse of `translation` has been imported. */
  hasTranslation(translation: string): boolean {
    const row = this.db
      .select({ id: bibleVerses.id })
      .from(bibleVerses)
      .where(eq(bibleVerses.translation, translation))
      .limit(1)
      .get();
    return Boolean(row);
  }

  /** The AI never writes Bible text (ADR-009) — this is the only source of verse text. */
  getPassage(ref: VerseRef, translation = 'RV1909'): Passage {
    if (!this.hasTranslation(translation)) {
      throw new BibleTranslationNotFoundError(translation);
    }
    const verseEnd = ref.verseEnd ?? ref.verseStart;
    const rows = this.db
      .select({ verse: bibleVerses.verse, text: bibleVerses.text })
      .from(bibleVerses)
      .where(
        and(
          eq(bibleVerses.translation, translation),
          eq(bibleVerses.book, ref.book),
          eq(bibleVerses.chapter, ref.chapter),
          gte(bibleVerses.verse, ref.verseStart),
          lte(bibleVerses.verse, verseEnd),
        ),
      )
      .orderBy(asc(bibleVerses.verse))
      .all();

    if (rows.length === 0) {
      throw new Error(
        `No se encontró texto para ${formatReference(ref)} en ${translation}. ¿La referencia es correcta?`,
      );
    }

    return {
      ref,
      reference: formatReference(ref),
      translation,
      text: rows.map((r) => r.text).join(' '),
      verses: rows,
    };
  }

  /** Convenience overload that parses a string reference first. */
  getPassageByReference(reference: string, translation = 'RV1909'): Passage {
    return this.getPassage(parseReference(reference), translation);
  }

  /**
   * QA check: does `text` literally contain the verse for `ref`? Used to
   * verify a script (or an audio transcript segment) really quotes the
   * Bible instead of a paraphrase the AI invented.
   */
  verifyQuote(
    text: string,
    ref: VerseRef,
    translation = 'RV1909',
  ): { exact: boolean; similarity: number; expected: string } {
    const passage = this.getPassage(ref, translation);
    const { exact, similarity } = compareTexts(text, passage.text);
    return { exact, similarity, expected: passage.text };
  }

  /** Full-text search over the FTS5 index (see drizzle/0001_bible_fts.sql). */
  search(query: string, translation?: string, limit = 20): VerseSearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const rows = translation
      ? this.db.all<VerseSearchHit>(sql`
          select bv.translation as translation, bv.book as book, bv.chapter as chapter, bv.verse as verse, bv.text as text
          from bible_verses_fts fts
          join bible_verses bv on bv.rowid = fts.rowid
          where bible_verses_fts match ${trimmed} and bv.translation = ${translation}
          order by rank
          limit ${limit}
        `)
      : this.db.all<VerseSearchHit>(sql`
          select bv.translation as translation, bv.book as book, bv.chapter as chapter, bv.verse as verse, bv.text as text
          from bible_verses_fts fts
          join bible_verses bv on bv.rowid = fts.rowid
          where bible_verses_fts match ${trimmed}
          order by rank
          limit ${limit}
        `);
    return rows;
  }
}
