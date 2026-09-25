import type { ProviderFactory } from '../../contracts';
import { geminiManifest } from './manifest';
import { GeminiProvider } from './provider';

export const geminiProviderFactory: ProviderFactory = {
  manifest: geminiManifest,
  create: (config, env) => new GeminiProvider(config, env),
};
