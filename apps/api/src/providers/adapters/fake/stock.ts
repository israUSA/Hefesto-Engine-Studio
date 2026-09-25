import type { StockItem, StockQuery } from '../../contracts';
import { hashSeed } from './hash';

export function fakeSearchStock(query: StockQuery): StockItem[] {
  const count = query.perPage ?? 5;
  const [width, height] = query.orientation === 'portrait' ? [1080, 1920] : [1920, 1080];

  return Array.from({ length: count }, (_, i) => {
    const id = hashSeed(`${query.keywords.join(',')}::${query.mediaType}::${i}`).toString('hex').slice(0, 10);
    return {
      id: `fake-${id}`,
      provider: 'fake',
      mediaType: query.mediaType,
      width,
      height,
      durationSec: query.mediaType === 'video' ? 8 : undefined,
      downloadUrl: `fake://stock/${id}`,
      pageUrl: `fake://stock/page/${id}`,
      author: 'Fake Studio',
      license: 'fake-cc0',
    };
  });
}
