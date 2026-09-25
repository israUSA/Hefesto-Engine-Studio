/**
 * Canonical Spanish (Reina-Valera) book names and their common abbreviations,
 * with and without accents, so `parseReference` accepts what a person (or
 * Gemini, when it only picks references — never text, see ADR-009) would
 * naturally type.
 */
export interface BookDef {
  canonical: string;
  aliases: string[];
}

export const BOOKS: BookDef[] = [
  { canonical: 'Génesis', aliases: ['gn', 'gen', 'genesis'] },
  { canonical: 'Éxodo', aliases: ['ex', 'exo', 'exodo'] },
  { canonical: 'Levítico', aliases: ['lv', 'lev', 'levitico'] },
  { canonical: 'Números', aliases: ['nm', 'num', 'numeros'] },
  { canonical: 'Deuteronomio', aliases: ['dt', 'deut', 'deuteronomio'] },
  { canonical: 'Josué', aliases: ['jos', 'josue'] },
  { canonical: 'Jueces', aliases: ['jue', 'jc', 'jueces'] },
  { canonical: 'Rut', aliases: ['rt', 'rut'] },
  { canonical: '1 Samuel', aliases: ['1 sm', '1 sam', '1sam', '1s', '1 samuel', 'i samuel'] },
  { canonical: '2 Samuel', aliases: ['2 sm', '2 sam', '2sam', '2s', '2 samuel', 'ii samuel'] },
  { canonical: '1 Reyes', aliases: ['1 re', '1 rey', '1r', '1 reyes', 'i reyes'] },
  { canonical: '2 Reyes', aliases: ['2 re', '2 rey', '2r', '2 reyes', 'ii reyes'] },
  { canonical: '1 Crónicas', aliases: ['1 cr', '1 cro', '1 cronicas', 'i cronicas'] },
  { canonical: '2 Crónicas', aliases: ['2 cr', '2 cro', '2 cronicas', 'ii cronicas'] },
  { canonical: 'Esdras', aliases: ['esd', 'esdras'] },
  { canonical: 'Nehemías', aliases: ['neh', 'nehemias'] },
  { canonical: 'Ester', aliases: ['est', 'ester'] },
  { canonical: 'Job', aliases: ['job', 'jb'] },
  { canonical: 'Salmos', aliases: ['sal', 'salmo', 'salmos', 'sl', 'ps', 'psa'] },
  { canonical: 'Proverbios', aliases: ['pr', 'prov', 'proverbios'] },
  { canonical: 'Eclesiastés', aliases: ['ec', 'ecl', 'eclesiastes', 'qohelet'] },
  { canonical: 'Cantares', aliases: ['cnt', 'cant', 'cantares', 'canticos', 'cantar de los cantares'] },
  { canonical: 'Isaías', aliases: ['is', 'isa', 'isaias'] },
  { canonical: 'Jeremías', aliases: ['jer', 'jeremias'] },
  { canonical: 'Lamentaciones', aliases: ['lm', 'lam', 'lamentaciones'] },
  { canonical: 'Ezequiel', aliases: ['ez', 'eze', 'ezequiel'] },
  { canonical: 'Daniel', aliases: ['dn', 'dan', 'daniel'] },
  { canonical: 'Oseas', aliases: ['os', 'ose', 'oseas'] },
  { canonical: 'Joel', aliases: ['jl', 'joe', 'joel'] },
  { canonical: 'Amós', aliases: ['am', 'amo', 'amos'] },
  { canonical: 'Abdías', aliases: ['abd', 'abdias'] },
  { canonical: 'Jonás', aliases: ['jon', 'jonas'] },
  { canonical: 'Miqueas', aliases: ['mi', 'miq', 'miqueas'] },
  { canonical: 'Nahúm', aliases: ['na', 'nah', 'nahum'] },
  { canonical: 'Habacuc', aliases: ['hab', 'habacuc'] },
  { canonical: 'Sofonías', aliases: ['sof', 'sofonias'] },
  { canonical: 'Hageo', aliases: ['hag', 'hageo'] },
  { canonical: 'Zacarías', aliases: ['zac', 'zacarias'] },
  { canonical: 'Malaquías', aliases: ['mal', 'malaquias'] },
  { canonical: 'Mateo', aliases: ['mt', 'mat', 'mateo'] },
  { canonical: 'Marcos', aliases: ['mr', 'mc', 'mar', 'marcos'] },
  { canonical: 'Lucas', aliases: ['lc', 'luc', 'lucas'] },
  { canonical: 'Juan', aliases: ['jn', 'juan'] },
  { canonical: 'Hechos', aliases: ['hch', 'hech', 'hechos', 'act', 'actos'] },
  { canonical: 'Romanos', aliases: ['rm', 'ro', 'rom', 'romanos'] },
  { canonical: '1 Corintios', aliases: ['1 co', '1 cor', '1co', '1 corintios', 'i corintios'] },
  { canonical: '2 Corintios', aliases: ['2 co', '2 cor', '2co', '2 corintios', 'ii corintios'] },
  { canonical: 'Gálatas', aliases: ['ga', 'gal', 'galatas'] },
  { canonical: 'Efesios', aliases: ['ef', 'efe', 'efesios'] },
  { canonical: 'Filipenses', aliases: ['fil', 'flp', 'filipenses'] },
  { canonical: 'Colosenses', aliases: ['col', 'colosenses'] },
  {
    canonical: '1 Tesalonicenses',
    aliases: ['1 ts', '1 tes', '1 tesalonicenses', 'i tesalonicenses'],
  },
  {
    canonical: '2 Tesalonicenses',
    aliases: ['2 ts', '2 tes', '2 tesalonicenses', 'ii tesalonicenses'],
  },
  { canonical: '1 Timoteo', aliases: ['1 ti', '1 tim', '1 timoteo', 'i timoteo'] },
  { canonical: '2 Timoteo', aliases: ['2 ti', '2 tim', '2 timoteo', 'ii timoteo'] },
  { canonical: 'Tito', aliases: ['tit', 'tito'] },
  { canonical: 'Filemón', aliases: ['flm', 'fil em', 'filemon'] },
  { canonical: 'Hebreos', aliases: ['he', 'heb', 'hebreos'] },
  { canonical: 'Santiago', aliases: ['stg', 'sant', 'santiago', 'jas'] },
  { canonical: '1 Pedro', aliases: ['1 pe', '1 ped', '1 pedro', 'i pedro'] },
  { canonical: '2 Pedro', aliases: ['2 pe', '2 ped', '2 pedro', 'ii pedro'] },
  { canonical: '1 Juan', aliases: ['1 jn', '1 juan', 'i juan'] },
  { canonical: '2 Juan', aliases: ['2 jn', '2 juan', 'ii juan'] },
  { canonical: '3 Juan', aliases: ['3 jn', '3 juan', 'iii juan'] },
  { canonical: 'Judas', aliases: ['jud', 'judas'] },
  { canonical: 'Apocalipsis', aliases: ['ap', 'apo', 'apocalipsis', 'rev'] },
];

function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** lowercase, no accents, no dots, single spaces — the key both sides of the lookup use. */
export function normalizeBookKey(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const BOOK_LOOKUP = new Map<string, string>();
for (const book of BOOKS) {
  BOOK_LOOKUP.set(normalizeBookKey(book.canonical), book.canonical);
  for (const alias of book.aliases) {
    BOOK_LOOKUP.set(normalizeBookKey(alias), book.canonical);
  }
}

/** Returns the canonical Spanish book name, or undefined if unrecognized. */
export function resolveBookName(input: string): string | undefined {
  return BOOK_LOOKUP.get(normalizeBookKey(input));
}
