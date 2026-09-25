import { Module } from '@nestjs/common';
import { fakeProviderFactory } from './adapters/fake';
import { geminiProviderFactory } from './adapters/gemini';
import { openAiCompatibleProviderFactory } from './adapters/openai-compatible';
import { pexelsProviderFactory } from './adapters/pexels';
import type { BindingSource } from './provider-registry';
import { InMemoryBindingSource, ProviderRegistry } from './provider-registry';

/** Injection token for the `BindingSource`. The DB agent's module should override this
 *  binding with its real `provider_configs`/`provider_bindings` repository (`useClass`
 *  or `useExisting`); until then it falls back to an empty in-memory source. */
export const BINDING_SOURCE = Symbol('BINDING_SOURCE');

/** Injection token for the `ProviderRegistry`, pre-loaded with every adapter factory. */
export const PROVIDER_REGISTRY = Symbol('PROVIDER_REGISTRY');

@Module({
  providers: [
    { provide: BINDING_SOURCE, useClass: InMemoryBindingSource },
    {
      provide: PROVIDER_REGISTRY,
      useFactory: (bindings: BindingSource) => {
        const registry = new ProviderRegistry(bindings);
        registry.register(fakeProviderFactory);
        registry.register(geminiProviderFactory);
        registry.register(openAiCompatibleProviderFactory);
        registry.register(pexelsProviderFactory);
        return registry;
      },
      inject: [BINDING_SOURCE],
    },
  ],
  exports: [PROVIDER_REGISTRY, BINDING_SOURCE],
})
export class ProvidersModule {}
