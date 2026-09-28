import type { ProviderManifest } from '@hefesto/shared-types';

/** Vault names of the OAuth client (desktop app) and of the refresh token (docs/06). */
export const GOOGLE_SECRETS = {
  clientId: 'GOOGLE_OAUTH_CLIENT_ID',
  clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET',
  refreshToken: 'GOOGLE_DRIVE_REFRESH_TOKEN',
} as const;

/** Only files the app created (docs/06: never the whole Drive). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const googleDriveManifest: ProviderManifest = {
  adapter: 'google-drive',
  displayName: 'Google Drive',
  capabilities: ['storage'],
  kind: 'cloud',
  resources: { lane: 'net' },
  license: { name: 'Google APIs Terms of Service', commercial: true, url: 'https://developers.google.com/terms' },
  secrets: [GOOGLE_SECRETS.clientId, GOOGLE_SECRETS.clientSecret, GOOGLE_SECRETS.refreshToken],
  features: {},
  pricing: { unit: 'request', usdPerUnit: 0 },
};
