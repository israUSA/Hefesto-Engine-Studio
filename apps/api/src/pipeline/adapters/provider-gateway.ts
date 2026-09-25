import { Inject, Injectable } from '@nestjs/common';
import type { Capability, TextRole } from '@hefesto/shared-types';
import {
  callWithFallback,
  PROVIDER_REGISTRY,
  type CapabilityMap,
  type ProviderRegistry,
  type ResolvableCapability,
} from '../../providers';
import type { ProviderCall, ProviderGateway } from '../ports';

@Injectable()
export class RegistryProviderGateway implements ProviderGateway {
  constructor(@Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry) {}

  async call<C extends ResolvableCapability, T>(
    capability: C,
    scope: { channelId: string; role?: TextRole },
    fn: (provider: CapabilityMap[C]) => Promise<T>,
  ): Promise<ProviderCall<T>> {
    const { result, servedBy } = await callWithFallback(this.registry, capability, scope, (r) => fn(r.provider));
    return { result, providerConfigId: servedBy.configId };
  }

  async describe(capability: Capability, scope: { channelId: string; role?: TextRole }): Promise<string> {
    const { config } = this.registry.resolve(capability as ResolvableCapability, scope);
    return [config.adapter, config.model ?? '', config.baseUrl ?? '', JSON.stringify(config.params)].join('|');
  }
}
