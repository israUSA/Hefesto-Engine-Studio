const STOPWORDS = new Set(
  (
    'a al algo ante bajo cada como con contra de del desde donde el ella en entre era es esta este esto ' +
    'hacia hasta la las le lo los mas muy no nos o para pero por que se sin sobre su sus tan tu un una unos unas y ya ' +
    'the and with of in on at for from into over under an to by is are this that its their his her'
  ).split(' '),
);

/**
 * Stock keywords for a scene whose script came from the DB (scenes there don't keep
 * the model's keywords): the first few meaningful words of its visual prompt.
 */
export function keywordsFromPrompt(prompt: string, max = 3): string[] {
  const words = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}
