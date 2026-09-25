import type { ProviderFactory } from '../../contracts';
import { openAiCompatibleManifest } from './manifest';
import { OpenAiCompatibleProvider } from './provider';

export const openAiCompatibleProviderFactory: ProviderFactory = {
  manifest: openAiCompatibleManifest,
  create: (config, env) => new OpenAiCompatibleProvider(config, env),
};
