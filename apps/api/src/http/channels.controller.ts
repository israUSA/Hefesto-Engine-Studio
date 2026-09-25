import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Channel, ChannelInput, ChannelSummary, VoicePreviewRequest, VoicePreviewResponse } from '@hefesto/shared-types';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from '../config/env';
import { ChannelsRepository, CostEntriesRepository, ProductionsRepository } from '../db/repositories';
import { FfmpegService } from '../media/services/ffmpeg.service';
import { callWithFallback, PROVIDER_REGISTRY } from '../providers';
import type { ProviderRegistry } from '../providers';
import { channelInputSchema, channelPatchSchema, voicePreviewRequestSchema } from './common/schemas';
import { ZodValidationPipe } from './common/zod-validation.pipe';

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsRepository,
    private readonly productions: ProductionsRepository,
    private readonly costs: CostEntriesRepository,
    private readonly ffmpeg: FfmpegService,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  @Get()
  list(): ChannelSummary[] {
    const since = startOfMonthIso();
    return this.channels.list().map((channel) => {
      const latest = this.productions.latest(channel.id);
      return {
        channel,
        videosThisMonth: this.productions.countSince(channel.id, since),
        inQueue: 0,
        lastProducedAt: latest?.createdAt,
        costThisMonthUsd: this.costs.sumByChannelSince(channel.id, since),
      };
    });
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Channel {
    const channel = this.channels.findBySlug(slug) ?? this.channels.findById(slug);
    if (!channel) throw new NotFoundException(`Canal no encontrado: ${slug}`);
    return channel;
  }

  @Post()
  create(@Body(new ZodValidationPipe(channelInputSchema)) body: ChannelInput): Channel {
    return this.channels.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(channelPatchSchema)) body: Partial<ChannelInput>,
  ): Channel {
    const updated = this.channels.update(id, body);
    if (!updated) throw new NotFoundException(`Canal no encontrado: ${id}`);
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): void {
    const channel = this.channels.findById(id);
    if (!channel) throw new NotFoundException(`Canal no encontrado: ${id}`);
    this.channels.setActive(id, false);
  }

  @Post(':id/voice-preview')
  async voicePreview(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voicePreviewRequestSchema)) body: VoicePreviewRequest,
  ): Promise<VoicePreviewResponse> {
    const channel = this.channels.findById(id);
    if (!channel) throw new NotFoundException(`Canal no encontrado: ${id}`);

    const voice = { ...channel.voice, ...body.voice };
    const text = body.text ?? `Esta es una muestra de la voz del canal ${channel.name}.`;

    await mkdir(paths.previews(), { recursive: true });
    const fileName = `${channel.slug}-${randomUUID()}.wav`;
    const rawPath = join(paths.previews(), `raw-${fileName}`);
    const finalPath = join(paths.previews(), fileName);

    const { result, servedBy } = await callWithFallback(this.registry, 'tts', { channelId: channel.id }, (resolved) =>
      resolved.provider.synthesize(
        {
          text,
          voiceId: voice.voiceId,
          language: voice.language,
          stylePrompt: voice.stylePrompt,
          speed: voice.speed,
          params: voice.params,
          outPath: rawPath,
        },
        { channelId: channel.id },
      ),
    );

    await this.ffmpeg.normalizeAudio(result.audioPath, finalPath);

    this.costs.insert({
      channelId: channel.id,
      providerConfigId: servedBy.configId,
      operation: 'voice-preview',
      units: result.usage.units,
      unit: result.usage.unit,
      costUsd: result.usage.costUsd,
      durationMs: result.usage.durationMs,
    });

    return {
      audioUrl: `/api/files/previews/${fileName}`,
      durationMs: result.durationMs,
      costUsd: result.usage.costUsd,
    };
  }
}
