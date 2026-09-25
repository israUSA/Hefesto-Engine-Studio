import { formatReference, parseReference, ReferenceParseError } from './reference-parser';

describe('parseReference', () => {
  it('parses a full book name with a verse range', () => {
    expect(parseReference('Salmos 23:1-3')).toEqual({
      book: 'Salmos',
      chapter: 23,
      verseStart: 1,
      verseEnd: 3,
    });
  });

  it('parses a single verse without a range', () => {
    expect(parseReference('Salmos 23:1')).toEqual({
      book: 'Salmos',
      chapter: 23,
      verseStart: 1,
      verseEnd: undefined,
    });
  });

  it.each([
    ['Sal 23:1', 'Salmos'],
    ['Salmo 23:1', 'Salmos'],
    ['salmos 23:1', 'Salmos'],
    ['Jn 3:16', 'Juan'],
    ['Juan 3:16', 'Juan'],
    ['1 Co 13:4-7', '1 Corintios'],
    ['1co 13:4-7', '1 Corintios'],
    ['I Corintios 13:4', '1 Corintios'],
    ['Is 41:10', 'Isaías'],
    ['Isaias 41:10', 'Isaías'],
    ['Isaías 41:10', 'Isaías'],
    ['Gn 1:1', 'Génesis'],
    ['Ex. 20:3', 'Éxodo'],
    ['Ap 21:4', 'Apocalipsis'],
    ['3 Jn 1:2', '3 Juan'],
  ])('accepts "%s" -> book %s', (input, expectedBook) => {
    expect(parseReference(input).book).toBe(expectedBook);
  });

  it('rejects an unrecognized book', () => {
    expect(() => parseReference('Marciano 1:1')).toThrow(ReferenceParseError);
  });

  it('rejects text with no chapter:verse', () => {
    expect(() => parseReference('Salmos veintitrés')).toThrow(ReferenceParseError);
  });

  it('rejects an inverted verse range', () => {
    expect(() => parseReference('Salmos 23:5-1')).toThrow(ReferenceParseError);
  });
});

describe('formatReference', () => {
  it('formats a single verse', () => {
    expect(formatReference({ book: 'Salmos', chapter: 23, verseStart: 1 })).toBe('Salmos 23:1');
  });

  it('formats a range', () => {
    expect(formatReference({ book: 'Salmos', chapter: 23, verseStart: 1, verseEnd: 3 })).toBe(
      'Salmos 23:1-3',
    );
  });
});
