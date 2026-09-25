import { Injectable } from '@nestjs/common';
import type { VerseRef } from '@hefesto/shared-types';
import { BibleService } from '../../bible/bible.service';
import type { BibleLookup } from '../ports';

/**
 * The model may write "Sal", "Salmo" or "salmos": every reference is re-parsed
 * into the canonical book name before reading the local Bible.
 */
@Injectable()
export class LocalBibleLookup implements BibleLookup {
  constructor(private readonly bible: BibleService) {}

  private canonical(ref: VerseRef): VerseRef {
    const end = ref.verseEnd && ref.verseEnd !== ref.verseStart ? `-${ref.verseEnd}` : '';
    return this.bible.parseReference(`${ref.book} ${ref.chapter}:${ref.verseStart}${end}`);
  }

  async passage(ref: VerseRef, translation: string): Promise<string> {
    return this.bible.getPassage(this.canonical(ref), translation).text;
  }

  format(ref: VerseRef): string {
    return this.bible.formatReference(this.canonical(ref));
  }

  async verify(text: string, ref: VerseRef, translation: string): Promise<{ exact: boolean; similarity: number }> {
    const { exact, similarity } = this.bible.verifyQuote(text, this.canonical(ref), translation);
    return { exact, similarity };
  }
}
