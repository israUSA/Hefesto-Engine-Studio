import type { ProviderManifest } from '@hefesto/shared-types';

export const geminiManifest: ProviderManifest = {
  adapter: 'gemini',
  displayName: 'Gemini (nativo)',
  capabilities: ['text', 'tts'],
  kind: 'cloud',
  resources: { lane: 'net' },
  license: { name: 'Google AI Studio / Gemini API', commercial: true, url: 'https://ai.google.dev/gemini-api/terms' },
  secrets: ['GEMINI_API_KEY'],
  features: {
    jsonSchema: true,
    stylePrompt: true,
    wordTimestamps: false,
    languages: ['es', 'en'],
    maxInputChars: 32000,
  },
};
