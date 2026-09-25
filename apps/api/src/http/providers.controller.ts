import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { HealthResult, ProviderConfig, ProviderDto } from '@hefesto/shared-types';
import { ProviderConfigsRepository } from '../db/repositories';
import { PROVIDER_REGISTRY } from '../providers';
import type { ProviderRegistry } from '../providers';
import { SECRET_VAULT } from '../secrets/secrets.module';
import type { SecretVault } from '../secrets/secret-vault';
import { providerConfigInputSchema, providerConfigPatchSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly configs: ProviderConfigsRepository,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
  ) {}

  private toDto(config: ProviderConfig): ProviderDto {
    const manifest = this.registry.getFactory(config.adapter)?.manifest;
    const secretInfo = config.secretRef ? this.vault.list([config.secretRef])[0] : undefined;
    const health = this.configs.getLastHealth(config.id);
    return {
      config,
      manifest: manifest ?? {
        adapter: config.adapter,
        displayName: config.adapter,
        capabilities: config.capabilities,
        kind: 'cloud',
        resources: { lane: 'net' },
        license: { name: 'desconocida', commercial: false },
        secrets: config.secretRef ? [config.secretRef] : [],
        features: {},
      },
      secret: config.secretRef
        ? { name: config.secretRef, present: this.vault.has(config.secretRef), last4: secretInfo?.last4 }
        : undefined,
      lastHealth: health,
    };
  }

  @Get()
  list(): ProviderDto[] {
    return this.configs.list().map((c) => this.toDto(c));
  }

  @Post()
  create(@Body(new ZodValidationPipe(providerConfigInputSchema)) body: Omit<ProviderConfig, 'id'>): ProviderDto {
    return this.toDto(this.configs.create(body));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(providerConfigPatchSchema)) body: Partial<ProviderConfig>,
  ): ProviderDto {
    const updated = this.configs.update(id, body);
    if (!updated) throw new NotFoundException(`Proveedor no encontrado: ${id}`);
    this.registry.invalidate(id);
    return this.toDto(updated);
  }

  @Post(':id/test')
  async test(@Param('id') id: string): Promise<HealthResult> {
    const config = this.configs.findById(id);
    if (!config) throw new NotFoundException(`Proveedor no encontrado: ${id}`);
    const instance = this.registry.getInstance(config);
    const result = await instance.healthCheck();
    this.configs.setLastHealth(id, result);
    return result;
  }
}
