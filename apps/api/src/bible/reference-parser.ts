import type { VerseRef } from '@hefesto/shared-types';
import { resolveBookName } from './books';

export class ReferenceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceParseError';
  }
}

/**
 * Parses references like "Salmos 23:1-3", "Sal 23:1", "1 Co 13:4-7" or
 * "Isaías 41:10" (with or without accents) into a `VerseRef`. Gemini only
 * ever picks references like these — the verse text itself always comes
 * from the local Bible (ADR-009).
 */
export function parseReference(input: string): VerseRef {
  const raw = input.trim().replace(/\s+/g, ' ');
  const match = raw.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!match) {
    throw new ReferenceParseError(`No se pudo interpretar la referencia: "${input}"`);
  }
  const [, bookPart, chapterStr, verseStartStr, verseEndStr] = match;
  const book = resolveBookName(bookPart);
  if (!book) {
    throw new ReferenceParseError(`Libro desconocido en la referencia: "${bookPart}"`);
  }
  const chapter = Number(chapterStr);
  const verseStart = Number(verseStartStr);
  const verseEnd = verseEndStr ? Number(verseEndStr) : undefined;
  if (verseEnd !== undefined && verseEnd < verseStart) {
    throw new ReferenceParseError(`Rango de versículos inválido en: "${input}"`);
  }
  return { book, chapter, verseStart, verseEnd };
}

/** Renders a `VerseRef` back as "Libro cap:verso" or "Libro cap:inicio-fin". */
export function formatReference(ref: VerseRef): string {
  const range = ref.verseEnd && ref.verseEnd !== ref.verseStart ? `${ref.verseStart}-${ref.verseEnd}` : `${ref.verseStart}`;
  return `${ref.book} ${ref.chapter}:${range}`;
}
