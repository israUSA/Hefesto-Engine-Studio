import type { ProviderFactory } from '../../contracts';
import { fakeManifest } from './manifest';
import { FakeProvider } from './provider';

export const fakeProviderFactory: ProviderFactory = {
  manifest: fakeManifest,
  create: (config) => new FakeProvider(config),
};
