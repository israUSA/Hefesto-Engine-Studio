import { Body, Controller, Get, Inject, Put, Query } from '@nestjs/common';
import type { BindingDto } from '@hefesto/shared-types';
import { ProviderBindingsRepository } from '../db/repositories';
import { PROVIDER_REGISTRY } from '../providers';
import type { ProviderRegistry } from '../providers';
import { bindingInputSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

@Controller('bindings')
export class BindingsController {
  constructor(
    private readonly bindings: ProviderBindingsRepository,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  @Get()
  list(@Query('channelId') channelId?: string): BindingDto[] {
    const all = this.bindings.list();
    const filtered = channelId ? all.filter((b) => b.channelId === channelId || b.channelId === null) : all;
    return filtered.map(({ id, ...dto }) => dto);
  }

  @Put()
  put(@Body(new ZodValidationPipe(bindingInputSchema)) body: BindingDto): BindingDto {
    const { id, ...dto } = this.bindings.upsert(body);
    this.registry.invalidate(body.providerConfigId);
    return dto;
  }
}
