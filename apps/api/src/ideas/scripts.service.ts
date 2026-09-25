import { Inject, Injectable } from '@nestjs/common';
import type { Platform, PlatformMetadata, ScriptDraft, ScriptDto, ScriptPatch } from '@hefesto/shared-types';
import {
  ChannelsRepository,
  CostEntriesRepository,
  IdeasRepository,
  ScriptsRepository,
} from '../db/repositories';
import {
  callWithFallback,
  generateStructured,
  PROVIDER_REGISTRY,
  ProviderError,
  scriptDraftJsonSchema,
  scriptDraftSchema,
} from '../providers';
import type { ProviderRegistry } from '../providers';
import { LocalBibleLookup } from '../pipeline/adapters/bible-lookup';
import { buildScriptPrompt, materializeScript } from '../pipeline/script-prompt';

@Injectable()
export class ScriptsService {
  constructor(
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    private readonly channels: ChannelsRepository,
    private readonly ideas: IdeasRepository,
    private readonly scripts: ScriptsRepository,
    private readonly costs: CostEntriesRepository,
    private readonly bible: LocalBibleLookup,
  ) {}

  async generate(channelId: string, ideaId?: string, topic?: string): Promise<ScriptDto> {
    const channel = this.channels.findById(channelId);
    if (!channel) throw new ProviderError(`Canal desconocido: ${channelId}`, 'scripts', false);

    const idea = ideaId ? this.ideas.findById(ideaId) : undefined;
    if (ideaId && !idea) throw new ProviderError(`Idea desconocida: ${ideaId}`, 'scripts', false);
    const effectiveTopic = topic ?? (idea ? `${idea.title}. ${idea.angle}` : undefined);

    const recent = this.scripts.listByChannel(channelId).slice(0, 30).map((s) => s.title);
    const { system, prompt } = buildScriptPrompt(channel, recent, effectiveTopic);

    const { result, servedBy } = await callWithFallback(
      this.registry,
      'text',
      { channelId, role: 'script' },
      (resolved) =>
        generateStructured(
          resolved.provider,
          { system, prompt, jsonSchema: scriptDraftJsonSchema, temperature: 0.9 },
          scriptDraftSchema,
          { channelId },
        ),
    );

    this.costs.insert({
      channelId,
      providerConfigId: servedBy.configId,
      operation: 'script',
      units: result.usage.units,
      unit: result.usage.unit,
      costUsd: result.usage.costUsd,
      durationMs: result.usage.durationMs,
    });

    // The AI only ever chose verse references; the actual text always comes from the local Bible.
    const materialized = await materializeScript(result.value as ScriptDraft, channel, this.bible);

    if (idea) this.ideas.updateStatus(idea.id, 'used');

    return this.scripts.create({
      channelId,
      ideaId: idea?.id,
      title: materialized.title,
      hook: materialized.hook,
      body: materialized.body,
      cta: materialized.cta,
      fullText: materialized.fullText,
      verseRefs: materialized.verseRefs,
      metadata: materialized.metadata as Partial<Record<Platform, PlatformMetadata>>,
      scenes: materialized.scenes.map((s) => ({ order: s.order, text: s.text, visualPrompt: s.visualPrompt })),
      status: 'draft',
    });
  }

  get(id: string): ScriptDto | undefined {
    return this.scripts.findById(id);
  }

  patch(id: string, patch: ScriptPatch): ScriptDto | undefined {
    return this.scripts.patch(id, patch);
  }
}
