import { Inject, Injectable } from '@nestjs/common';
import type { IdeaDto } from '@hefesto/shared-types';
import { z } from 'zod';
import { ChannelsRepository, CostEntriesRepository, IdeasRepository } from '../db/repositories';
import {
  callWithFallback,
  generateStructured,
  PROVIDER_REGISTRY,
  ProviderError,
  toProviderJsonSchema,
} from '../providers';
import type { ProviderRegistry } from '../providers';

const ideaSchema = z.object({
  title: z.string().min(1).max(140),
  angle: z.string().min(1),
});
const ideasResultSchema = z.object({ ideas: z.array(ideaSchema).min(1) });
const ideasJsonSchema = toProviderJsonSchema(ideasResultSchema);

@Injectable()
export class IdeasService {
  constructor(
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    private readonly channels: ChannelsRepository,
    private readonly ideas: IdeasRepository,
    private readonly costs: CostEntriesRepository,
  ) {}

  async generate(channelId: string, count: number, hint?: string): Promise<IdeaDto[]> {
    const channel = this.channels.findById(channelId);
    if (!channel) throw new ProviderError(`Canal desconocido: ${channelId}`, 'ideas', false);

    const usedTitles = this.ideas.listTitlesByChannel(channelId, 100);
    const system = [
      `Sos un productor de contenido para el canal "${channel.name}" (${channel.platform}).`,
      `Nicho: ${channel.topic}.`,
      'Biblia del canal (tono, público, qué sí y qué no):',
      channel.bible,
      '',
      `Proponé ${count} ideas de video nuevas, concretas y distintas entre sí.`,
      'Cada idea tiene un `title` corto (gancho) y un `angle` (una o dos frases describiendo el enfoque).',
    ].join('\n');
    const avoid = usedTitles.length
      ? `\nTítulos ya usados por este canal (no los repitas ni los parafrasees):\n${usedTitles.map((t) => `- ${t}`).join('\n')}`
      : '';
    const prompt = [hint ? `Pista temática: ${hint}.` : '', avoid, '\nRespondé solo con el JSON pedido.'].join('\n');

    const { result, servedBy } = await callWithFallback(
      this.registry,
      'text',
      { channelId, role: 'ideas' },
      (resolved) =>
        generateStructured(
          resolved.provider,
          { system, prompt, jsonSchema: ideasJsonSchema, temperature: 1 },
          ideasResultSchema,
          { channelId },
        ),
    );

    this.costs.insert({
      channelId,
      providerConfigId: servedBy.configId,
      operation: 'ideas',
      units: result.usage.units,
      unit: result.usage.unit,
      costUsd: result.usage.costUsd,
      durationMs: result.usage.durationMs,
    });

    return result.value.ideas.slice(0, count).map((idea) =>
      this.ideas.create({ channelId, title: idea.title, angle: idea.angle, source: 'ai' }),
    );
  }
}
