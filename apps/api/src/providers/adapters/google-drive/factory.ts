import type { ProviderFactory } from '../../contracts';
import { googleDriveManifest } from './manifest';
import { GoogleDriveProvider } from './provider';

export const googleDriveProviderFactory: ProviderFactory = {
  manifest: googleDriveManifest,
  create: (config, env) => new GoogleDriveProvider(config, env),
};
