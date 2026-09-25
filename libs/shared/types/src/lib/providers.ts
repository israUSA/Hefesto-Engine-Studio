/**
 * Provider contracts shared by the API and the UI.
 * See docs/13-proveedores-intercambiables.md.
 */

export type Capability =
  | 'text'
  | 'embedding'
  | 'tts'
  | 'transcribe'
  | 'stock'
  | 'image'
  | 'video'
  | 'music'
  | 'storage'
  | 'publish'
  | 'notify';

export type ProviderKind = 'cloud' | 'local' | 'manual';

export type Lane = 'gpu' | 'net' | 'cpu';

/** Text roles let a channel use a cheap model for ideas and a better one for scripts. */
export type TextRole = 'ideas' | 'script' | 'metadata' | 'keywords';

export type PricingUnit = 'char' | 'token' | 'image' | 'second' | 'request';

export interface ProviderLicense {
  name: string;
  /** false blocks the provider for monetized channels (ADR-008). */
  commercial: boolean;
  url?: string;
}

export interface ProviderFeatures {
  jsonSchema?: boolean;
  stylePrompt?: boolean;
  voiceCloning?: boolean;
  wordTimestamps?: boolean;
  languages?: string[];
  maxInputChars?: number;
  aspectRatios?: string[];
}

export interface ProviderPricing {
  unit: PricingUnit;
  usdPerUnit: number;
}

/** Static description of an adapter. Declared in code, never stored with secrets. */
export interface ProviderManifest {
  adapter: string;
  displayName: string;
  capabilities: Capability[];
  kind: ProviderKind;
  resources: { lane: Lane; vramMb?: number };
  license: ProviderLicense;
  /** Names of .env variables the adapter needs. Never the values. */
  secrets: string[];
  features: ProviderFeatures;
  pricing?: ProviderPricing;
}

/** A configured instance of an adapter (DB row `provider_configs`). */
export interface ProviderConfig {
  id: string;
  name: string;
  adapter: string;
  capabilities: Capability[];
  baseUrl?: string;
  model?: string;
  params: Record<string, unknown>;
  /** Name of the .env variable holding the key, e.g. "GEMINI_API_KEY". */
  secretRef?: string;
  pricingOverride?: ProviderPricing;
  enabled: boolean;
}

/** Which instance a channel uses for a capability (DB row `provider_bindings`). */
export interface ProviderBinding {
  id: string;
  /** null = global default. */
  channelId: string | null;
  capability: Capability;
  role?: TextRole;
  providerConfigId: string;
  params: Record<string, unknown>;
  fallbackIds: string[];
}

export interface HealthResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  models?: string[];
}

/** Every call reports usage so the caller can write a CostEntry. */
export interface Usage {
  units: number;
  unit: PricingUnit;
  costUsd: number;
  durationMs: number;
}
