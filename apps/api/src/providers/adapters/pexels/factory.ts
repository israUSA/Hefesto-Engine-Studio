import type { ProviderFactory } from '../../contracts';
import { pexelsManifest } from './manifest';
import { PexelsProvider } from './provider';

export const pexelsProviderFactory: ProviderFactory = {
  manifest: pexelsManifest,
  create: (config, env) => new PexelsProvider(config, env),
};
