import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import type { SecretDto } from '@hefesto/shared-types';
import { ProviderConfigsRepository } from '../db/repositories';
import { PROVIDER_REGISTRY } from '../providers';
import type { ProviderRegistry } from '../providers';
import { SECRET_VAULT } from '../secrets/secrets.module';
import type { SecretVault } from '../secrets/secret-vault';
import { secretPutSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('secrets')
export class SecretsController {
  constructor(
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    private readonly configs: ProviderConfigsRepository,
  ) {}

  private usedBy(name: string): string[] {
    return this.configs.list().filter((c) => c.secretRef === name).map((c) => c.name);
  }

  @Get()
  list(): SecretDto[] {
    const known = new Set<string>();
    for (const manifest of this.registry.listManifests()) manifest.secrets.forEach((s) => known.add(s));
    for (const config of this.configs.list()) if (config.secretRef) known.add(config.secretRef);

    return this.vault.list([...known]).map((info) => ({
      name: info.name,
      last4: info.last4,
      updatedAt: info.updatedAt,
      source: info.source,
      usedBy: this.usedBy(info.name),
    }));
  }

  @Put(':name')
  async put(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(secretPutSchema)) body: { value: string },
  ): Promise<SecretDto> {
    await this.vault.set(name, body.value);
    for (const config of this.configs.list()) {
      if (config.secretRef === name) this.registry.invalidate(config.id);
    }
    const info = this.vault.list([name]).find((i) => i.name === name);
    if (!info) throw new NotFoundException(`No se pudo guardar la clave: ${name}`);
    return { name: info.name, last4: info.last4, updatedAt: info.updatedAt, source: info.source, usedBy: this.usedBy(name) };
  }

  @Delete(':name')
  @HttpCode(204)
  async remove(@Param('name') name: string): Promise<void> {
    await this.vault.remove(name);
    for (const config of this.configs.list()) {
      if (config.secretRef === name) this.registry.invalidate(config.id);
    }
  }
}
