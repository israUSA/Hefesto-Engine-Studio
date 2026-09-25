import type { Capability, StageKey, TextRole } from '@hefesto/shared-types';
import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { env, paths } from '../config/env';
import type { DbInstance } from '../db/db.token';
import type { BindingSource, ProviderRegistry, ResolvableCapability } from '../providers';

/** A video the queue is asked to produce. */
export interface VideoTarget {
  channelId: string;
  channelName: string;
  scriptId?: string;
}

/** Provider capability behind each stage that calls one, and its CostEntry operation. */
const STAGE_PROVIDER: Partial<Record<StageKey, { capability: ResolvableCapability; role?: TextRole; operation: string }>> = {
  script: { capability: 'text', role: 'script', operation: 'script' },
  voice: { capability: 'tts', operation: 'tts' },
  transcribe: { capability: 'transcribe', operation: 'transcribe' },
  visuals: { capability: 'stock', operation: 'stock' },
};

const CAPABILITY_LABEL: Partial<Record<Capability, string>> = {
  text: 'texto',
  tts: 'voz',
  transcribe: 'transcripción',
  stock: 'imágenes de stock',
};

/** Cost averages and blockers for `QueueApi.estimate` (and the enqueue pre-check). */
export class QueueEstimator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly bindings: BindingSource,
    private readonly db: DbInstance,
    private readonly exists: (path: string) => boolean = existsSync,
  ) {}

  /** Human-readable reasons the videos can't be produced right now. Empty = ready. */
  blockers(targets: VideoTarget[]): string[] {
    const out = new Set<string>();

    for (const bin of ['ffmpeg', 'ffprobe']) {
      if (!this.exists(paths.bin(bin))) out.add(`Falta ${bin} (corré tools/fetch-binaries.ts)`);
    }

    const seen = new Set<string>();
    for (const t of targets) {
      for (const [stage, spec] of Object.entries(STAGE_PROVIDER)) {
        if (!spec || (stage === 'script' && t.scriptId)) continue;
        const key = `${t.channelId}:${spec.capability}:${spec.role ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const problem = this.checkCapability(spec.capability, t, spec.role);
        if (problem) out.add(problem);
      }
    }
    return [...out];
  }

  /** Average cost of `stage` per video with the provider the channel would use (0 if unknown). */
  stageCost(stage: StageKey, target: VideoTarget): number {
    const spec = STAGE_PROVIDER[stage];
    if (!spec || (stage === 'script' && target.scriptId)) return 0;
    let configId: string;
    try {
      configId = this.registry.resolve(spec.capability, { channelId: target.channelId, role: spec.role }).config.id;
    } catch {
      return 0;
    }
    const row = this.db.get<{ avg: number | null }>(sql`
      SELECT avg(total) AS avg FROM (
        SELECT sum(cost_usd) AS total FROM cost_entries
        WHERE operation = ${spec.operation} AND provider_config_id = ${configId} AND production_id IS NOT NULL
        GROUP BY production_id ORDER BY max(created_at) DESC LIMIT 20)`);
    return row?.avg ?? 0;
  }

  private checkCapability(capability: ResolvableCapability, t: VideoTarget, role?: TextRole): string | undefined {
    const label = CAPABILITY_LABEL[capability] ?? capability;
    const binding = this.bindings.getBinding(capability, { channelId: t.channelId, role });
    if (!binding) return `Falta asignar un proveedor de ${label} al canal "${t.channelName}"`;

    const allowFallback = capability !== 'tts' || binding.params?.['allowFallback'] === true;
    const ids = [binding.providerConfigId, ...(allowFallback ? binding.fallbackIds : [])];
    let first: string | undefined;
    for (const id of ids) {
      try {
        const resolved = this.registry.resolveConfig(capability, id, { channelId: t.channelId, role });
        const missing = this.missingBinaries(resolved.config.adapter);
        if (!missing) return undefined;
        first ??= missing;
      } catch (err) {
        first ??= describe(err);
      }
    }
    return first;
  }

  private missingBinaries(adapter: string): string | undefined {
    if (adapter !== 'whisper-cpp') return undefined;
    if (!this.exists(paths.bin('whisper-cli'))) return 'Falta whisper-cli (corré tools/fetch-binaries.ts)';
    if (!this.exists(paths.model(env.whisperModel))) return `Falta el modelo de Whisper ${env.whisperModel}`;
    return undefined;
  }
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const secret = /Falta el secreto: definí (\S+)/.exec(message);
  return secret ? `Falta ${secret[1]}` : message;
}
