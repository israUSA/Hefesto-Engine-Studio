import { keywordsFromPrompt } from './keywords';

describe('keywordsFromPrompt', () => {
  it('keeps the first meaningful words, without accents or stopwords', () => {
    expect(keywordsFromPrompt('Un camino de montaña al amanecer, con niebla')).toEqual(['camino', 'montana', 'amanecer']);
    expect(keywordsFromPrompt('a sunrise over the mountains', 2)).toEqual(['sunrise', 'mountains']);
    expect(keywordsFromPrompt('')).toEqual([]);
  });
});
