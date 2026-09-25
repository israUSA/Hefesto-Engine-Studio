/**
 * Pure text-comparison helpers used by `BibleService.verifyQuote` for QA:
 * "does the script/audio really say this verse, literally?" (docs/08).
 * Kept dependency-free (no DB) so they're trivial to unit test.
 */

function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** lowercase, no accents, punctuation removed, whitespace collapsed. */
export function normalizeText(input: string): string {
  return stripAccents(input)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * `exact` is true when the normalized `text` equals or literally contains the
 * normalized `expected` verse (a script usually wraps the verse in a hook
 * and a CTA). `similarity` is 1 - normalized Levenshtein distance, useful for
 * QA thresholds (e.g. WER-like checks) even when it isn't a perfect match.
 */
export function compareTexts(text: string, expected: string): { exact: boolean; similarity: number } {
  const normalizedText = normalizeText(text);
  const normalizedExpected = normalizeText(expected);

  if (normalizedExpected.length === 0) {
    return { exact: normalizedText.length === 0, similarity: normalizedText.length === 0 ? 1 : 0 };
  }

  const exact = normalizedText === normalizedExpected || normalizedText.includes(normalizedExpected);
  if (exact) {
    return { exact: true, similarity: 1 };
  }

  const distance = levenshtein(normalizedText, normalizedExpected);
  const maxLen = Math.max(normalizedText.length, normalizedExpected.length, 1);
  const similarity = Math.max(0, 1 - distance / maxLen);
  return { exact: false, similarity };
}
