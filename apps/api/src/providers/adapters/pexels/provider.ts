import { writeFileSync } from 'node:fs';
import type { HealthResult, ProviderConfig, ProviderManifest } from '@hefesto/shared-types';
import type { AdapterCore } from '../../adapter-core';
import type { CallContext, StockItem, StockQuery } from '../../contracts';
import { ProviderError } from '../../contracts';
import { computeUsage } from '../../cost';
import { httpStatusToProviderError, withBackoff } from '../../retry';
import { pexelsManifest } from './manifest';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer?: string;
  src?: { original?: string; portrait?: string; landscape?: string };
}

interface PexelsVideoFile {
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration?: number;
  url: string;
  user?: { name?: string };
  video_files?: PexelsVideoFile[];
}

function pickVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  return [...files].sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

/** Free stock photos and videos. Attribution and license are filled from the API response. */
export class PexelsProvider implements AdapterCore {
  readonly manifest: ProviderManifest = pexelsManifest;

  constructor(
    readonly config: ProviderConfig,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  private apiKey(): string {
    const secretName = this.config.secretRef ?? 'PEXELS_API_KEY';
    const key = this.env[secretName];
    if (!key) {
      throw new ProviderError(`Falta el secreto: definí ${secretName} en .env`, 'pexels', false);
    }
    return key;
  }

  async healthCheck(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await fetch('https://api.pexels.com/v1/curated?per_page=1', { headers: { authorization: this.apiKey() } });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      return { ok: true, message: 'OK', latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async search(query: StockQuery, ctx: CallContext): Promise<StockItem[]> {
    const isVideo = query.mediaType === 'video';
    const url = new URL(isVideo ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search');
    url.searchParams.set('query', query.keywords.join(' '));
    url.searchParams.set('orientation', query.orientation);
    url.searchParams.set('per_page', String(query.perPage ?? 10));

    const res = await withBackoff(
      async () => {
        const r = await fetch(url, { headers: { authorization: this.apiKey() }, signal: ctx.signal });
        if (!r.ok) throw httpStatusToProviderError(r.status, 'pexels', `HTTP ${r.status}`);
        return r;
      },
      { signal: ctx.signal },
    );

    if (isVideo) {
      const json = (await res.json()) as { videos?: PexelsVideo[] };
      return (json.videos ?? []).map((v) => {
        const file = pickVideoFile(v.video_files ?? []);
        return {
          id: String(v.id),
          provider: 'pexels',
          mediaType: 'video' as const,
          width: file?.width ?? v.width,
          height: file?.height ?? v.height,
          durationSec: v.duration,
          downloadUrl: file?.link ?? v.video_files?.[0]?.link ?? '',
          pageUrl: v.url,
          author: v.user?.name,
          license: 'Pexels License',
        };
      });
    }

    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return (json.photos ?? []).map((p) => ({
      id: String(p.id),
      provider: 'pexels',
      mediaType: 'photo' as const,
      width: p.width,
      height: p.height,
      downloadUrl: (query.orientation === 'portrait' ? p.src?.portrait : p.src?.landscape) ?? p.src?.original ?? '',
      pageUrl: p.url,
      author: p.photographer,
      license: 'Pexels License',
    }));
  }

  async download(item: StockItem, outPath: string, ctx: CallContext) {
    const started = Date.now();
    const res = await withBackoff(
      async () => {
        const r = await fetch(item.downloadUrl, { signal: ctx.signal });
        if (!r.ok) throw httpStatusToProviderError(r.status, 'pexels', `HTTP ${r.status}`);
        return r;
      },
      { signal: ctx.signal },
    );
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(outPath, buf);
    return {
      path: outPath,
      usage: computeUsage({ manifest: this.manifest, config: this.config, units: 1, unit: 'request', durationMs: Date.now() - started }),
    };
  }
}
