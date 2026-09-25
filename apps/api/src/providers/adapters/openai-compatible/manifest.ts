import type { ProviderManifest } from '@hefesto/shared-types';

/**
 * Generic default shown before an instance is configured. The *effective* per-instance
 * manifest (`kind`, `resources.lane`) is computed in `OpenAiCompatibleProvider` from
 * `config.baseUrl` / `config.params`, since the same adapter serves both cloud APIs
 * (OpenAI, OpenRouter, Groq...) and local servers (Ollama, LM Studio, llama.cpp).
 */
export const openAiCompatibleManifest: ProviderManifest = {
  adapter: 'openai-compatible',
  displayName: 'Compatible con OpenAI (nube o local)',
  capabilities: ['text', 'embedding', 'tts', 'transcribe'],
  kind: 'cloud',
  resources: { lane: 'net' },
  license: { name: 'Según el proveedor configurado', commercial: true },
  secrets: [],
  features: {
    jsonSchema: true,
    stylePrompt: false,
    wordTimestamps: true,
    languages: [],
    maxInputChars: 32000,
  },
};
