import { Injectable } from '@nestjs/common';
import type { Capability, ProviderBinding, ProviderConfig, TextRole } from '@hefesto/shared-types';
import {
  ChannelsRepository,
  ProviderBindingsRepository,
  ProviderConfigsRepository,
} from '../../db/repositories';
import type { BindingSource } from '../../providers';

/** `BindingSource` backed by the `provider_configs` / `provider_bindings` tables. */
@Injectable()
export class DbBindingSource implements BindingSource {
  constructor(
    private readonly configs: ProviderConfigsRepository,
    private readonly bindings: ProviderBindingsRepository,
    private readonly channels: ChannelsRepository,
  ) {}

  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.findById(id);
  }

  getBinding(capability: Capability, opts: { channelId: string; role?: string }): ProviderBinding | undefined {
    return this.bindings.resolve(opts.channelId, capability, opts.role as TextRole | undefined);
  }

  isChannelMonetized(channelId: string): boolean {
    return this.channels.findById(channelId)?.monetized ?? false;
  }
}
