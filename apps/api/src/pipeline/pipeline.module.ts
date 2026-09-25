import { Module } from '@nestjs/common';
import { BibleModule } from '../bible/bible.module';
import { DbModule } from '../db/db.module';
import { MediaModule } from '../media/media.module';
import { whisperCppFactory } from '../media/whisper';
import { PROVIDER_REGISTRY, ProviderRegistry } from '../providers';
import { SECRET_VAULT } from '../secrets/secrets.module';
import type { SecretVault } from '../secrets/secret-vault';
import { fakeProviderFactory } from '../providers/adapters/fake';
import { geminiProviderFactory } from '../providers/adapters/gemini';
import { openAiCompatibleProviderFactory } from '../providers/adapters/openai-compatible';
import { pexelsProviderFactory } from '../providers/adapters/pexels';
import { LocalBibleLookup } from './adapters/bible-lookup';
import { DbBindingSource } from './adapters/db-binding-source';
import { DbProductionStore } from './adapters/db-production-store';
import { LocalMediaTools } from './adapters/media-tools';
import { RegistryProviderGateway } from './adapters/provider-gateway';
import { BIBLE_LOOKUP, MEDIA_TOOLS, PRODUCTION_STORE, PROVIDER_GATEWAY } from './ports';
import { ProductionService } from './production.service';

export const PROVIDER_FACTORIES = [
  fakeProviderFactory,
  geminiProviderFactory,
  openAiCompatibleProviderFactory,
  pexelsProviderFactory,
  whisperCppFactory,
];

@Module({
  imports: [DbModule, BibleModule, MediaModule],
  providers: [
    DbBindingSource,
    {
      provide: PROVIDER_REGISTRY,
      useFactory: (bindings: DbBindingSource, vault: SecretVault) => {
        const registry = new ProviderRegistry(bindings, vault.asEnv());
        for (const factory of PROVIDER_FACTORIES) registry.register(factory);
        return registry;
      },
      inject: [DbBindingSource, SECRET_VAULT],
    },
    { provide: PRODUCTION_STORE, useClass: DbProductionStore },
    { provide: PROVIDER_GATEWAY, useClass: RegistryProviderGateway },
    { provide: MEDIA_TOOLS, useClass: LocalMediaTools },
    { provide: BIBLE_LOOKUP, useClass: LocalBibleLookup },
    ProductionService,
  ],
  exports: [ProductionService, PROVIDER_REGISTRY, DbBindingSource],
})
export class PipelineModule {}
