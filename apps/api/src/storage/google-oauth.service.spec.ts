import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../db/test-utils';
import { ChannelsRepository, ProviderBindingsRepository, ProviderConfigsRepository, SettingsRepository } from '../db/repositories';
import { EventsService } from '../events/events.service';
import { DbBindingSource } from '../pipeline/adapters/db-binding-source';
import { ProviderRegistry } from '../providers';
import type { SecretCipher } from '../secrets/dpapi';
import { SecretVault } from '../secrets/secret-vault';
import { GoogleOAuthService } from './google-oauth.service';

jest.mock('../config/env', () => {
  const actual = jest.requireActual('../config/env');
  const { join: j } = jest.requireActual('node:path');
  const { tmpdir } = jest.requireActual('node:os');
  return { ...actual, paths: { ...actual.paths, logs: () => j(tmpdir(), `hefesto-oauth-spec-${process.pid}`) } };
});

const fakeCipher: SecretCipher = {
  encrypt: async (p) => p.map((s) => `enc:${Buffer.from(s).toString('base64')}`),
  decrypt: async (b) => b.map((s) => Buffer.from(s.slice(4), 'base64').toString()),
};

function setup() {
  const { db } = createTestDb();
  const vault = new SecretVault(join(mkdtempSync(join(tmpdir(), 'hefesto-oauth-')), 'secrets.json'), fakeCipher, {});
  const configs = new ProviderConfigsRepository(db);
  const bindings = new ProviderBindingsRepository(db);
  const registry = new ProviderRegistry(new DbBindingSource(configs, bindings, new ChannelsRepository(db)), vault.asEnv());
  const svc = new GoogleOAuthService(vault, registry, new SettingsRepository(db), configs, bindings, new EventsService());
  return { svc, vault, bindings };
}

const CLIENT_ID = '123-abc.apps.googleusercontent.com';

describe('GoogleOAuthService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('needs the desktop OAuth client before connecting', async () => {
    const { svc } = setup();
    expect(svc.status()).toMatchObject({ clientConfigured: false, connected: false, scope: 'https://www.googleapis.com/auth/drive.file' });
    expect(() => svc.start()).toThrow(/cliente OAuth/);
    await expect(svc.setClient('no-es-un-id', 'secret')).rejects.toThrow(/googleusercontent/);
    expect((await svc.setClient(CLIENT_ID, 'GOCSPX-secret')).clientConfigured).toBe(true);
  });

  it('builds a PKCE consent URL for drive.file on the loopback redirect', async () => {
    const { svc } = setup();
    await svc.setClient(CLIENT_ID, 'GOCSPX-secret');
    const url = new URL(svc.start().authUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/storage\/google\/callback$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('exchanges the code, stores the refresh token encrypted and makes Drive the archive', async () => {
    const { svc, vault, bindings } = setup();
    await svc.setClient(CLIENT_ID, 'GOCSPX-secret');
    const url = new URL(svc.start().authUrl);
    const bodies: URLSearchParams[] = [];
    global.fetch = jest.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://oauth2.googleapis.com/token')) {
        bodies.push(init?.body as URLSearchParams);
        return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r-123' }), { status: 200 });
      }
      return new Response(JSON.stringify({ user: { emailAddress: 'yo@example.com' } }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(svc.callback({ code: 'c', state: 'otro' })).rejects.toThrow(/venció o no es válido/);
    expect(await svc.callback({ code: 'c', state: url.searchParams.get('state') ?? '' })).toBe('yo@example.com');

    const verifier = bodies[0].get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(url.searchParams.get('code_challenge'));
    expect(vault.get('GOOGLE_DRIVE_REFRESH_TOKEN')).toBe('r-123');
    expect(svc.status()).toMatchObject({ connected: true, email: 'yo@example.com' });
    expect(bindings.list().find((b) => b.capability === 'storage')).toBeDefined();
    // The state is single use.
    await expect(svc.callback({ code: 'c', state: url.searchParams.get('state') ?? '' })).rejects.toThrow();
  });

  it('disconnects: revokes at Google and forgets the token', async () => {
    const { svc, vault } = setup();
    await vault.set('GOOGLE_DRIVE_REFRESH_TOKEN', 'r-123');
    const fetchMock = jest.fn(async () => new Response('', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    expect((await svc.disconnect()).connected).toBe(false);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/revoke');
    expect(vault.has('GOOGLE_DRIVE_REFRESH_TOKEN')).toBe(false);
  });
});
