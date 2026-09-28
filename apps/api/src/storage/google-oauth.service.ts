import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { GoogleAccountStatus } from '@hefesto/shared-types';
import { createHash, randomBytes } from 'node:crypto';
import { ProviderBindingsRepository, ProviderConfigsRepository, SettingsRepository } from '../db/repositories';
import { EventsService } from '../events/events.service';
import { PROVIDER_REGISTRY, type ProviderRegistry } from '../providers';
import { DRIVE_SCOPE, GOOGLE_SECRETS } from '../providers/adapters/google-drive';
import { SECRET_VAULT } from '../secrets/secrets.module';
import type { SecretVault } from '../secrets/secret-vault';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const SETTING_EMAIL = 'storage.google.email';
const PENDING_TTL_MS = 10 * 60_000;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * OAuth for a Google Cloud "desktop app" client (docs/06): the browser comes back to the
 * API on the loopback address with a code, exchanged with PKCE for a refresh token that is
 * stored encrypted in the SecretVault. Never the whole Drive: scope `drive.file`.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly pending = new Map<string, { verifier: string; createdAt: number }>();

  constructor(
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    private readonly settings: SettingsRepository,
    private readonly configs: ProviderConfigsRepository,
    private readonly bindings: ProviderBindingsRepository,
    private readonly events: EventsService,
  ) {}

  redirectUri(): string {
    return `http://127.0.0.1:${Number(process.env['PORT'] ?? 3000)}/api/storage/google/callback`;
  }

  status(): GoogleAccountStatus {
    const connected = this.vault.has(GOOGLE_SECRETS.refreshToken);
    return {
      clientConfigured: this.vault.has(GOOGLE_SECRETS.clientId) && this.vault.has(GOOGLE_SECRETS.clientSecret),
      connected,
      email: connected ? this.settings.get<string>(SETTING_EMAIL) : undefined,
      redirectUri: this.redirectUri(),
      scope: DRIVE_SCOPE,
    };
  }

  async setClient(clientId: string, clientSecret: string): Promise<GoogleAccountStatus> {
    if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) {
      throw new BadRequestException('El ID de cliente de Google termina en .apps.googleusercontent.com');
    }
    await this.vault.set(GOOGLE_SECRETS.clientId, clientId);
    await this.vault.set(GOOGLE_SECRETS.clientSecret, clientSecret);
    this.invalidateDrive();
    return this.status();
  }

  /** URL of Google's consent screen; the browser comes back to `callback`. */
  start(): { authUrl: string } {
    const clientId = this.vault.get(GOOGLE_SECRETS.clientId);
    if (!clientId || !this.vault.has(GOOGLE_SECRETS.clientSecret)) {
      throw new BadRequestException('Primero cargá el ID y el secreto del cliente OAuth de Google');
    }
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.createdAt > PENDING_TTL_MS) this.pending.delete(key);

    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    this.pending.set(state, { verifier, createdAt: now });
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      // Always returns a refresh token, also when reconnecting the same account.
      prompt: 'consent',
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      state,
    }).toString();
    return { authUrl: url.toString() };
  }

  /** Exchanges the code; returns the e-mail of the connected account. */
  async callback(query: { code?: string; state?: string; error?: string }): Promise<string | undefined> {
    if (query.error) throw new BadRequestException(`Google no dio acceso: ${query.error}`);
    const pending = query.state ? this.pending.get(query.state) : undefined;
    if (!pending || !query.code || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new BadRequestException('El enlace de conexión venció o no es válido: volvé a tocar "Conectar con Google"');
    }
    this.pending.delete(query.state as string);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        code: query.code,
        client_id: this.vault.get(GOOGLE_SECRETS.clientId) ?? '',
        client_secret: this.vault.get(GOOGLE_SECRETS.clientSecret) ?? '',
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: pending.verifier,
      }),
    });
    const tokens = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
    if (!res.ok || !tokens.refresh_token) {
      throw new BadRequestException(`Google no devolvió el acceso (${tokens.error ?? `HTTP ${res.status}`})`);
    }
    await this.vault.set(GOOGLE_SECRETS.refreshToken, tokens.refresh_token);

    let email: string | undefined;
    if (tokens.access_token) {
      const about = await fetch(ABOUT_URL, { headers: { authorization: `Bearer ${tokens.access_token}` } }).catch(() => undefined);
      if (about?.ok) email = ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress;
    }
    if (email) this.settings.set(SETTING_EMAIL, email);
    this.invalidateDrive();
    this.bindDriveIfUnset();
    this.events.log('info', 'storage', `Google Drive conectado${email ? ` (${email})` : ''}`);
    return email;
  }

  async disconnect(): Promise<GoogleAccountStatus> {
    const token = this.vault.get(GOOGLE_SECRETS.refreshToken);
    if (token) {
      // Best effort: the token is forgotten locally even if Google can't be reached.
      await fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token }) }).catch(() => undefined);
      await this.vault.remove(GOOGLE_SECRETS.refreshToken);
    }
    this.invalidateDrive();
    this.events.log('info', 'storage', 'Google Drive desconectado');
    return this.status();
  }

  private driveConfig() {
    return this.configs.list().find((c) => c.adapter === 'google-drive');
  }

  private invalidateDrive(): void {
    const config = this.driveConfig();
    if (config) this.registry.invalidate(config.id);
  }

  /** The first connection makes Drive the archive, unless another storage is already chosen. */
  private bindDriveIfUnset(): void {
    const config =
      this.driveConfig() ??
      this.configs.create({
        name: 'google-drive',
        adapter: 'google-drive',
        capabilities: ['storage'],
        params: {},
        secretRef: GOOGLE_SECRETS.refreshToken,
        enabled: true,
      });
    const current = this.bindings.list().find((b) => b.channelId === null && b.capability === 'storage');
    if (!current) {
      this.bindings.upsert({ channelId: null, capability: 'storage', providerConfigId: config.id, params: {}, fallbackIds: [] });
    }
  }
}
