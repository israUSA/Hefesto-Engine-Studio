import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DbInstance } from '../db/migrate';
import { createTestDb } from '../db/test-utils';
import { bibleVerses } from '../db/schema';
import { BibleService, BibleTranslationNotFoundError } from './bible.service';

const FIXTURE: Array<{ book: string; chapter: number; verse: number; text: string }> = [
  { book: 'Salmos', chapter: 23, verse: 1, text: 'JEHOVÁ es mi pastor; nada me faltará.' },
  {
    book: 'Salmos',
    chapter: 23,
    verse: 2,
    text: 'En lugares de delicados pastos me hará yacer: junto á aguas de reposo me pastoreará.',
  },
  {
    book: 'Salmos',
    chapter: 23,
    verse: 3,
    text: 'Confortará mi alma; guiaráme por sendas de justicia por amor de su nombre.',
  },
  {
    book: 'Isaías',
    chapter: 41,
    verse: 10,
    text: 'No temas, que yo soy contigo; no desmayes, que yo soy tu Dios que te esfuerzo: siempre te ayudaré, siempre te sustentaré con la diestra de mi justicia.',
  },
  {
    book: 'Juan',
    chapter: 3,
    verse: 16,
    text: 'Porque de tal manera amó Dios al mundo, que ha dado á su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.',
  },
];

function seedFixture(db: DbInstance): void {
  for (const verse of FIXTURE) {
    db.insert(bibleVerses)
      .values({ id: randomUUID(), translation: 'RV1909', ...verse })
      .run();
  }
}

describe('BibleService', () => {
  let db: DbInstance;
  let sqlite: Database.Database;
  let service: BibleService;

  beforeEach(() => {
    ({ db, sqlite } = createTestDb());
    seedFixture(db);
    service = new BibleService(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('gets a single verse by reference', () => {
    const passage = service.getPassageByReference('Salmos 23:1');
    expect(passage.text).toBe('JEHOVÁ es mi pastor; nada me faltará.');
    expect(passage.reference).toBe('Salmos 23:1');
  });

  it('gets a verse range concatenated in order', () => {
    const passage = service.getPassageByReference('Salmos 23:1-3');
    expect(passage.verses).toHaveLength(3);
    expect(passage.text).toBe(
      'JEHOVÁ es mi pastor; nada me faltará. En lugares de delicados pastos me hará yacer: junto á aguas de reposo me pastoreará. Confortará mi alma; guiaráme por sendas de justicia por amor de su nombre.',
    );
  });

  it('matches the known RV1909 checkpoints from docs/08', () => {
    expect(service.getPassageByReference('Isaías 41:10').text).toMatch(/^No temas, que yo soy contigo/);
  });

  it('throws a clear error for a translation that was never imported', () => {
    expect(() => service.getPassage({ book: 'Salmos', chapter: 23, verseStart: 1 }, 'NVI')).toThrow(
      BibleTranslationNotFoundError,
    );
  });

  it('throws when the reference is not in the DB for an imported translation', () => {
    expect(() => service.getPassageByReference('Génesis 1:1')).toThrow();
  });

  describe('verifyQuote', () => {
    it('confirms a literal quote inside a longer script', () => {
      const result = service.verifyQuote(
        'Hoy te comparto algo hermoso: Jehová es mi pastor; nada me faltará. Que tengas fe.',
        { book: 'Salmos', chapter: 23, verseStart: 1 },
      );
      expect(result.exact).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it('flags a paraphrase as not exact', () => {
      const result = service.verifyQuote('El Señor es mi pastor, nada me falta.', {
        book: 'Salmos',
        chapter: 23,
        verseStart: 1,
      });
      expect(result.exact).toBe(false);
      expect(result.similarity).toBeLessThan(1);
    });
  });

  describe('search', () => {
    it('finds verses by full-text search', () => {
      const hits = service.search('pastor');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.book === 'Salmos' && h.verse === 1)).toBe(true);
    });

    it('returns nothing for an empty query', () => {
      expect(service.search('   ')).toEqual([]);
    });
  });
});
