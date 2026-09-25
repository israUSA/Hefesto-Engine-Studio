import type { ProviderManifest } from '@hefesto/shared-types';

export const pexelsManifest: ProviderManifest = {
  adapter: 'pexels',
  displayName: 'Pexels',
  capabilities: ['stock'],
  kind: 'cloud',
  resources: { lane: 'net' },
  license: { name: 'Pexels License', commercial: true, url: 'https://www.pexels.com/license/' },
  secrets: ['PEXELS_API_KEY'],
  features: { languages: [], aspectRatios: ['9:16', '16:9'] },
  pricing: { unit: 'request', usdPerUnit: 0 },
};
