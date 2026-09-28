import type { ProviderManifest } from '@hefesto/shared-types';

export const localFolderManifest: ProviderManifest = {
  adapter: 'local-folder',
  displayName: 'Carpeta local o NAS',
  capabilities: ['storage'],
  kind: 'local',
  resources: { lane: 'cpu' },
  license: { name: 'MIT (Hefesto)', commercial: true },
  secrets: [],
  features: {},
};
