import type { ProviderFactory } from '../../contracts';
import { localFolderManifest } from './manifest';
import { LocalFolderProvider } from './provider';

export const localFolderProviderFactory: ProviderFactory = {
  manifest: localFolderManifest,
  create: (config) => new LocalFolderProvider(config),
};
