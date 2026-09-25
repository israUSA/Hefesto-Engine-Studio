import { Inject, Injectable } from '@nestjs/common';
import type { Lane, StageKey, TextRole } from '@hefesto/shared-types';
import { EncoderService } from '../media/services/encoder.service';
import { PROVIDER_REGISTRY, type ProviderRegistry, type ResolvableCapability } from '../providers';
import type { LaneContext, LaneResolver } from './queue.tokens';

/**
 * The lane comes from whatever runs the job, not from the stage type (docs/13 §4):
 * provider stages use the resolved provider's manifest (cloud → net, Ollama/Chatterbox → gpu,
 * whisper.cpp → gpu only with the CUDA build), render uses the detected encoder.
 */
@Injectable()
export class ProviderLaneResolver implements LaneResolver {
  constructor(
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    private readonly encoder: EncoderService,
  ) {}

  async laneFor(stage: StageKey, ctx: LaneContext): Promise<Lane> {
    switch (stage) {
      case 'script':
        return ctx.scriptId ? 'cpu' : this.providerLane('text', ctx.channelId, 'net', 'script');
      case 'voice':
        return this.providerLane('tts', ctx.channelId, 'net');
      case 'visuals':
        return this.providerLane('stock', ctx.channelId, 'net');
      case 'transcribe':
        return this.providerLane('transcribe', ctx.channelId, 'cpu');
      case 'render':
        return (await this.encoder.detect()).usesGpu ? 'gpu' : 'cpu';
      default:
        return 'cpu';
    }
  }

  /** Falls back to `fallback` when the binding can't be resolved (the job will report why). */
  private providerLane(capability: ResolvableCapability, channelId: string, fallback: Lane, role?: TextRole): Lane {
    try {
      return this.registry.resolve(capability, { channelId, role }).provider.manifest.resources.lane;
    } catch {
      return fallback;
    }
  }
}
