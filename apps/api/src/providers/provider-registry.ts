import type { Capability, ProviderBinding, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from './adapter-core';
import type { CapabilityMap, Provider, ProviderFactory, ResolvableCapability } from './contracts';
import { ProviderError } from './contracts';

/**
 * Supplies the DB-backed `provider_configs` / `provider_bindings` rows. Implemented for
 * real by the DB agent's repository; `InMemoryBindingSource` below covers tests and the CLI.
 */
export interface BindingSource {
  getConfig(id: string): ProviderConfig | undefined;
  /** Prefers a channel-specific binding over the global one (`channelId === null`). */
  getBinding(capability: Capability, opts: { channelId: string; role?: string }): ProviderBinding | undefined;
  /** Drives the license check (ADR-008): monetized channels reject `license.commercial === false`. */
  isChannelMonetized(channelId: string): boolean;
}

/** In-memory `BindingSource`, for unit tests and the `nest-commander` CLI. */
export class InMemoryBindingSource implements BindingSource {
  private readonly configs = new Map<string, ProviderConfig>();
  private readonly bindings: ProviderBinding[] = [];
  private readonly monetized = new Set<string>();

  addConfig(config: ProviderConfig): this {
    this.configs.set(config.id, config);
    return this;
  }

  addBinding(binding: ProviderBinding): this {
    this.bindings.push(binding);
    return this;
  }

  setMonetized(channelId: string, monetized = true): this {
    if (monetized) this.monetized.add(channelId);
    else this.monetized.delete(channelId);
    return this;
  }

  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.get(id);
  }

  getBinding(capability: Capability, opts: { channelId: string; role?: string }): ProviderBinding | undefined {
    const forChannel = this.bindings.find(
      (b) => b.channelId === opts.channelId && b.capability === capability && b.role === opts.role,
    );
    if (forChannel) return forChannel;
    return this.bindings.find(
      (b) => b.channelId === null && b.capability === capability && b.role === opts.role,
    );
  }

  isChannelMonetized(channelId: string): boolean {
    return this.monetized.has(channelId);
  }
}

export interface ResolveOptions {
  channelId: string;
  role?: string;
}

export interface ResolvedProvider<C extends ResolvableCapability> {
  provider: CapabilityMap[C];
  config: ProviderConfig;
  binding?: ProviderBinding;
}

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();
  private readonly instances = new Map<string, Provider>();

  constructor(
    private readonly bindings: BindingSource,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  register(factory: ProviderFactory): void {
    this.factories.set(factory.manifest.adapter, factory);
  }

  getFactory(adapter: string): ProviderFactory | undefined {
    return this.factories.get(adapter);
  }

  /** Generic manifests, one per registered adapter — for the Ajustes "add provider" picker. */
  listManifests(): ProviderManifest[] {
    return [...this.factories.values()].map((f) => f.manifest);
  }

  /** Builds (or reuses a cached) provider instance for a config row. */
  getInstance(config: ProviderConfig): Provider {
    const cached = this.instances.get(config.id);
    if (cached) return cached;

    const factory = this.factories.get(config.adapter);
    if (!factory) {
      throw new ProviderError(`No hay adaptador registrado para "${config.adapter}"`, config.adapter, false);
    }
    const instance = factory.create(config, this.env);
    this.instances.set(config.id, instance);
    return instance;
  }

  /** Drops a cached instance, e.g. after its config changes in Ajustes. */
  invalidate(configId: string): void {
    this.instances.delete(configId);
  }

  /** Resolves the channel's binding for a capability (and optional role), with checks applied. */
  resolve<C extends ResolvableCapability>(capability: C, opts: ResolveOptions): ResolvedProvider<C> {
    const binding = this.bindings.getBinding(capability, opts);
    if (!binding) {
      const roleSuffix = opts.role ? ` (rol "${opts.role}")` : '';
      throw new ProviderError(
        `No hay proveedor asignado para "${capability}"${roleSuffix} en el canal "${opts.channelId}"`,
        'registry',
        false,
      );
    }
    const { config, core } = this.checkedConfig(capability, binding.providerConfigId, opts.channelId);
    return { provider: this.buildFacade(capability, core), config, binding };
  }

  /** Resolves a specific config id directly, applying the same checks — used for fallbacks. */
  resolveConfig<C extends ResolvableCapability>(
    capability: C,
    configId: string,
    opts: ResolveOptions,
  ): ResolvedProvider<C> {
    const { config, core } = this.checkedConfig(capability, configId, opts.channelId);
    return { provider: this.buildFacade(capability, core), config };
  }

  private checkedConfig(
    capability: Capability,
    configId: string,
    channelId: string,
  ): { config: ProviderConfig; core: AdapterCore } {
    const config = this.bindings.getConfig(configId);
    if (!config) {
      throw new ProviderError(`Configuración de proveedor desconocida "${configId}"`, 'registry', false);
    }
    if (!config.enabled) {
      throw new ProviderError(`El proveedor "${config.name}" está deshabilitado`, config.adapter, false);
    }
    if (!config.capabilities.includes(capability)) {
      throw new ProviderError(
        `El proveedor "${config.name}" no declara la capacidad "${capability}"`,
        config.adapter,
        false,
      );
    }
    if (config.secretRef && !this.env[config.secretRef]) {
      throw new ProviderError(
        `Falta el secreto: definí ${config.secretRef} en .env para el proveedor "${config.name}"`,
        config.adapter,
        false,
      );
    }

    const core = this.getInstance(config) as AdapterCore;

    if (this.bindings.isChannelMonetized(channelId) && core.manifest.license.commercial === false) {
      throw new ProviderError(
        `El proveedor "${config.name}" (${config.adapter}) tiene licencia no comercial y el canal "${channelId}" está monetizado (ADR-008)`,
        config.adapter,
        false,
      );
    }

    return { config, core };
  }

  /** Adapts an `AdapterCore` instance into the exact interface `CapabilityMap[C]` expects. */
  private buildFacade<C extends ResolvableCapability>(capability: C, core: AdapterCore): CapabilityMap[C] {
    const base = {
      manifest: core.manifest,
      config: core.config,
      healthCheck: () => core.healthCheck(),
    };

    switch (capability as ResolvableCapability) {
      case 'text':
        this.require(core, 'generateText', capability);
        return { ...base, generate: core.generateText!.bind(core) } as unknown as CapabilityMap[C];
      case 'embedding':
        this.require(core, 'embed', capability);
        return { ...base, embed: core.embed!.bind(core) } as unknown as CapabilityMap[C];
      case 'tts':
        this.require(core, 'synthesize', capability);
        this.require(core, 'listVoices', capability);
        return {
          ...base,
          synthesize: core.synthesize!.bind(core),
          listVoices: core.listVoices!.bind(core),
        } as unknown as CapabilityMap[C];
      case 'transcribe':
        this.require(core, 'transcribe', capability);
        return { ...base, transcribe: core.transcribe!.bind(core) } as unknown as CapabilityMap[C];
      case 'stock':
        this.require(core, 'search', capability);
        this.require(core, 'download', capability);
        return {
          ...base,
          search: core.search!.bind(core),
          download: core.download!.bind(core),
        } as unknown as CapabilityMap[C];
      case 'image':
        this.require(core, 'generateImage', capability);
        return { ...base, generate: core.generateImage!.bind(core) } as unknown as CapabilityMap[C];
      case 'video':
        this.require(core, 'generateVideo', capability);
        return { ...base, generate: core.generateVideo!.bind(core) } as unknown as CapabilityMap[C];
      case 'storage':
        this.require(core, 'put', capability);
        this.require(core, 'get', capability);
        this.require(core, 'exists', capability);
        return {
          ...base,
          put: core.put!.bind(core),
          get: core.get!.bind(core),
          exists: core.exists!.bind(core),
        } as unknown as CapabilityMap[C];
      default:
        throw new ProviderError(`Capacidad no soportada por el registro: "${capability}"`, core.manifest.adapter, false);
    }
  }

  private require(core: AdapterCore, method: keyof AdapterCore, capability: Capability): void {
    if (typeof core[method] !== 'function') {
      throw new ProviderError(
        `El adaptador "${core.manifest.adapter}" no implementa "${String(method)}" para la capacidad "${capability}"`,
        core.manifest.adapter,
        false,
      );
    }
  }
}
