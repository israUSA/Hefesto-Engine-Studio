/**
 * Downloads the Reina-Valera 1909 (public domain, see data/bible/README.md),
 * converts it to `data/bible/rv1909.json`, and can import that JSON into the
 * `bible_verses` table.
 *
 * Run directly with `ts-node` (tsx is not installed in this repo). `tools/`
 * has its own `tsconfig.json` (commonjs, so plain `require()` works); pass it
 * explicitly since ts-node only looks for a tsconfig by walking *up* from the
 * cwd, and the repo root has no root-level tsconfig.json:
 *   npx ts-node --transpile-only --project tools/tsconfig.json tools/import-bible.ts             # re-download + rebuild JSON + import into the DB
 *   npx ts-node --transpile-only --project tools/tsconfig.json tools/import-bible.ts --json-only  # only rebuild data/bible/rv1909.json, skip the DB
 *   npx ts-node --transpile-only --project tools/tsconfig.json tools/import-bible.ts --db-only    # only import the existing JSON into the DB
 *
 * No new dependencies: the ZIP is read with a tiny hand-rolled local-file-header
 * parser + Node's built-in `zlib.inflateRawSync` (the eBible.org USFX package
 * has no data descriptors, so sizes in the local headers are trustworthy).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const RV1909_SOURCE_URL = 'https://ebible.org/Scriptures/spaRV1909_usfx.zip';
export const DEFAULT_JSON_PATH = join(__dirname, '..', 'data', 'bible', 'rv1909.json');

export interface BibleVerseRow {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface BibleJson {
  translation: string;
  verses: BibleVerseRow[];
}

// USFX 3-letter book codes -> canonical Spanish book name (see apps/api/src/bible/books.ts).
const BOOK_MAP: Record<string, string> = {
  GEN: 'Génesis', EXO: 'Éxodo', LEV: 'Levítico', NUM: 'Números', DEU: 'Deuteronomio',
  JOS: 'Josué', JDG: 'Jueces', RUT: 'Rut', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Reyes', '2KI': '2 Reyes', '1CH': '1 Crónicas', '2CH': '2 Crónicas',
  EZR: 'Esdras', NEH: 'Nehemías', EST: 'Ester', JOB: 'Job', PSA: 'Salmos',
  PRO: 'Proverbios', ECC: 'Eclesiastés', SNG: 'Cantares', ISA: 'Isaías', JER: 'Jeremías',
  LAM: 'Lamentaciones', EZK: 'Ezequiel', DAN: 'Daniel', HOS: 'Oseas', JOL: 'Joel',
  AMO: 'Amós', OBA: 'Abdías', JON: 'Jonás', MIC: 'Miqueas', NAM: 'Nahúm', HAB: 'Habacuc',
  ZEP: 'Sofonías', HAG: 'Hageo', ZEC: 'Zacarías', MAL: 'Malaquías',
  MAT: 'Mateo', MRK: 'Marcos', LUK: 'Lucas', JHN: 'Juan', ACT: 'Hechos', ROM: 'Romanos',
  '1CO': '1 Corintios', '2CO': '2 Corintios', GAL: 'Gálatas', EPH: 'Efesios', PHP: 'Filipenses',
  COL: 'Colosenses', '1TH': '1 Tesalonicenses', '2TH': '2 Tesalonicenses', '1TI': '1 Timoteo',
  '2TI': '2 Timoteo', TIT: 'Tito', PHM: 'Filemón', HEB: 'Hebreos', JAS: 'Santiago',
  '1PE': '1 Pedro', '2PE': '2 Pedro', '1JN': '1 Juan', '2JN': '2 Juan', '3JN': '3 Juan',
  JUD: 'Judas', REV: 'Apocalipsis',
};

// ── Minimal ZIP reader ────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  data: Buffer;
}

/** Reads local file headers (sig 0x04034b50) one after another until they stop. */
function readZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < buf.length - 4 && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    entries.push({ name, method, compSize, data: buf.subarray(dataStart, dataStart + compSize) });
    offset = dataStart + compSize;
  }
  return entries;
}

function extractZipEntry(zip: Buffer, entryName: string): string {
  const entry = readZipEntries(zip).find((e) => e.name === entryName);
  if (!entry) {
    throw new Error(`El zip no contiene "${entryName}"`);
  }
  const raw = entry.method === 8 ? inflateRawSync(entry.data) : entry.data;
  return raw.toString('utf8');
}

// ── USFX -> verses ──────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Parses the eBible.org USFX dialect used by spaRV1909, which only uses the
 * tags `usfx, languageCode, book, id, h, toc, p, c, v, ve, w, add` (verified
 * against the downloaded file — no footnotes or cross-references present).
 */
export function parseUsfx(xml: string): BibleVerseRow[] {
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? [];
  const verses: BibleVerseRow[] = [];

  let currentBook: string | null = null;
  let currentChapter: number | null = null;
  let currentVerse: number | null = null;
  let buffer: string[] = [];

  const flushVerse = () => {
    if (currentBook && currentChapter != null && currentVerse != null) {
      const text = decodeEntities(buffer.join('')).replace(/\s+/g, ' ').trim();
      if (text) {
        verses.push({ book: currentBook, chapter: currentChapter, verse: currentVerse, text });
      }
    }
    buffer = [];
  };

  for (const tok of tokens) {
    if (tok[0] !== '<') {
      if (currentVerse != null) buffer.push(tok);
      continue;
    }
    const tagMatch = tok.match(/^<\/?([a-zA-Z]+)/);
    const tagName = tagMatch ? tagMatch[1] : '';
    const isClose = tok[1] === '/';

    if (tagName === 'book' && !isClose) {
      const idMatch = tok.match(/id="([^"]+)"/);
      currentBook = idMatch ? BOOK_MAP[idMatch[1]] ?? null : null;
      currentChapter = null;
      currentVerse = null;
      buffer = [];
    } else if (tagName === 'c') {
      flushVerse();
      const idMatch = tok.match(/id="([^"]+)"/);
      currentChapter = idMatch ? Number(idMatch[1]) : null;
      currentVerse = null;
    } else if (tagName === 'v' && !isClose) {
      flushVerse();
      const idMatch = tok.match(/id="([^"]+)"/);
      currentVerse = idMatch ? Number(idMatch[1]) : null;
    } else if (tagName === 've') {
      flushVerse();
      currentVerse = null;
    } else if (tagName === 'p' && isClose && currentBook === 'Salmos' && currentVerse === 1) {
      // Psalm superscriptions ("Salmo de David.") are folded into v1 by Hebrew
      // versification but printed as a heading — drop them from the quotable text.
      buffer = [];
    }
    // w, add: inline text-bearing tags, their content is captured as plain tokens.
    // id, h, toc, usfx, languageCode, plain p: structural only, no verse text of their own.
  }
  flushVerse();
  return verses;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function downloadAndBuildBibleJson(
  jsonPath: string = DEFAULT_JSON_PATH,
): Promise<BibleJson> {
  const res = await fetch(RV1909_SOURCE_URL);
  if (!res.ok) {
    throw new Error(`No se pudo descargar ${RV1909_SOURCE_URL}: HTTP ${res.status}`);
  }
  const zipBuffer = Buffer.from(await res.arrayBuffer());
  const xml = extractZipEntry(zipBuffer, 'spaRV1909_usfx.xml');
  const verses = parseUsfx(xml);

  if (verses.length < 30000) {
    throw new Error(
      `Solo se parsearon ${verses.length} versículos; se esperaban ~31000. Abortando para no pisar un JSON bueno.`,
    );
  }
  assertKnownVerses(verses);

  const json: BibleJson = { translation: 'RV1909', verses };
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(json), 'utf8');
  return json;
}

/** Fails loudly if the two verses docs/08 uses to identify RV1909 don't match. */
function assertKnownVerses(verses: BibleVerseRow[]): void {
  const psalm23 = verses.find((v) => v.book === 'Salmos' && v.chapter === 23 && v.verse === 1);
  const isaiah41 = verses.find((v) => v.book === 'Isaías' && v.chapter === 41 && v.verse === 10);
  if (!psalm23 || !/^Jehov[aá] es mi pastor; nada me faltar[aá]\.?$/i.test(psalm23.text)) {
    throw new Error(`Salmos 23:1 no coincide con el RV1909 esperado. Texto obtenido: "${psalm23?.text}"`);
  }
  if (!isaiah41 || !/^No temas, que yo soy contigo/i.test(isaiah41.text)) {
    throw new Error(`Isaías 41:10 no coincide con el RV1909 esperado. Texto obtenido: "${isaiah41?.text}"`);
  }
}

export function loadBibleJson(jsonPath: string = DEFAULT_JSON_PATH): BibleJson {
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

/** Minimal shape the importer needs from a drizzle DB — matches `DbInstance`. */
export interface BibleImportTarget {
  insert(table: unknown): {
    values(rows: unknown[]): {
      onConflictDoUpdate(config: { target: unknown[]; set: Record<string, unknown> }): { run(): void };
    };
  };
  transaction<T>(fn: (tx: BibleImportTarget) => T): T;
}

/**
 * Idempotent import into `bible_verses`: upserts by the
 * `(translation, book, chapter, verse)` unique index, in chunks to stay under
 * SQLite's bound-parameter limit. Pass the drizzle `DbInstance` and the
 * `bibleVerses` table from `apps/api/src/db/schema`.
 */
export function importBibleToDb(
  db: BibleImportTarget,
  table: { translation: unknown; book: unknown; chapter: unknown; verse: unknown; text: unknown; id: unknown },
  newId: () => string,
  json: BibleJson = loadBibleJson(),
  chunkSize = 300,
): { imported: number } {
  db.transaction((tx) => {
    for (let i = 0; i < json.verses.length; i += chunkSize) {
      const chunk = json.verses.slice(i, i + chunkSize);
      tx.insert(table)
        .values(
          chunk.map((v) => ({
            id: newId(),
            translation: json.translation,
            book: v.book,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text,
          })),
        )
        .onConflictDoUpdate({
          target: [table.translation, table.book, table.chapter, table.verse],
          set: { text: sqlExcludedText() },
        })
        .run();
    }
  });
  return { imported: json.verses.length };
}

// drizzle-orm's `sql` import is intentionally deferred to `bin()` below so this
// file has zero hard dependency on the API app when only regenerating the JSON.
function sqlExcludedText(): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sql } = require('drizzle-orm');
  return sql`excluded.text`;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const jsonOnly = args.has('--json-only');
  const dbOnly = args.has('--db-only');

  let json: BibleJson;
  if (!dbOnly) {
    console.log(`Descargando ${RV1909_SOURCE_URL} ...`);
    json = await downloadAndBuildBibleJson();
    console.log(`OK: ${json.verses.length} versículos escritos en ${DEFAULT_JSON_PATH}`);
  } else {
    json = loadBibleJson();
  }

  if (jsonOnly) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { paths } = require('../apps/api/src/config/env');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createDb } = require('../apps/api/src/db/migrate');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bibleVerses } = require('../apps/api/src/db/schema');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require('node:crypto');

  const { db, sqlite } = createDb(paths.db());
  const result = importBibleToDb(db, bibleVerses, randomUUID, json);
  console.log(`Importados ${result.imported} versículos de ${json.translation} en la base.`);
  sqlite.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
