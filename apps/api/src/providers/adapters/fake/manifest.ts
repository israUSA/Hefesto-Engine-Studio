import type { ProviderManifest } from '@hefesto/shared-types';

export const fakeManifest: ProviderManifest = {
  adapter: 'fake',
  displayName: 'Fake (desarrollo y pruebas)',
  capabilities: ['text', 'tts', 'transcribe', 'stock', 'image'],
  kind: 'local',
  resources: { lane: 'cpu' },
  license: { name: 'MIT (Hefesto)', commercial: true },
  secrets: [],
  features: {
    jsonSchema: true,
    stylePrompt: true,
    wordTimestamps: true,
    languages: ['es', 'en'],
    aspectRatios: ['9:16', '16:9', '1:1'],
  },
};
