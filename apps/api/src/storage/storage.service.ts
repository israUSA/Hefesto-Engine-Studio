import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ARCHIVED_KINDS,
  type ArchivedKind,
  type Channel,
  type FreeSpaceResult,
  type ProductionSummary,
  type StorageChannelRow,
  type StorageOverview,
  type StorageProviderInfo,
  type StorageTargetRequest,
  type UploadResult,
} from '@hefesto/shared-types';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { paths } from '../config/env';
import {
  ChannelsRepository,
  CostEntriesRepository,
  type ProductionRow,
  ProductionsRepository,
  ProviderBindingsRepository,
  ProviderConfigsRepository,
  type RemoteFileRow,
  RemoteFilesRepository,
  SettingsRepository,
} from '../db/repositories';
import { nowIso } from '../db/util';
import { EventsService } from '../events/events.service';
import { FREEABLE_FILES } from '../pipeline/production.service';
import { md5File, PROVIDER_REGISTRY, type ProviderRegistry, type StorageProvider } from '../providers';
import { ProductionSummaryReader } from '../queue/production-summary';
import { QUEUE_API, type QueueApi } from '../queue/queue.contract';

const SETTING_LAST_SYNC = 'storage.lastSyncAt';
/** Files that must be verified in the remote before their local copy is deleted. */
const VERIFY_BEFORE_FREE: { kind: ArchivedKind; name: string }[] = [
  { kind: 'render', name: 'render.mp4' },
  { kind: 'voice', name: 'voice.wav' },
];

interface ProductionFiles {
  row: ProductionRow;
  channel: Channel;
  dir: string;
  remote: Map<ArchivedKind, RemoteFileRow>;
  onDisk: boolean;
  heavyBytes: number;
}

/**
 * Drive view (docs/06): where each video is, "Sincronizar", "Liberar espacio" and "Traer de
 * vuelta". Uploads themselves are the pipeline's `archive` stage, run by the queue.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(QUEUE_API) private readonly queue: QueueApi,
    private readonly channels: ChannelsRepository,
    private readonly productions: ProductionsRepository,
    private readonly remoteFiles: RemoteFilesRepository,
    private readonly configs: ProviderConfigsRepository,
    private readonly bindings: ProviderBindingsRepository,
    private readonly settings: SettingsRepository,
    private readonly costs: CostEntriesRepository,
    private readonly summaries: ProductionSummaryReader,
    private readonly events: EventsService,
  ) {}

  // ── Overview ──────────────────────────────────────────────────────────

  async overview(): Promise<StorageOverview> {
    const files = this.productionFiles();
    const byKind = Object.fromEntries(ARCHIVED_KINDS.map((k) => [k, { count: 0, bytes: 0 }])) as StorageOverview['remote']['byKind'];
    let remoteBytes = 0;
    let latest: RemoteFileRow | undefined;
    for (const r of this.remoteFiles.list()) {
      if (!r.present) continue;
      byKind[r.kind].count++;
      byKind[r.kind].bytes += r.sizeBytes;
      remoteBytes += r.sizeBytes;
      if (r.kind === 'render' && (!latest || r.syncedAt > latest.syncedAt)) latest = r;
    }

    const rows = new Map<string, StorageChannelRow>();
    let onDiskBytes = 0;
    let freeableBytes = 0;
    let freeableVideos = 0;
    for (const f of files) {
      const row =
        rows.get(f.channel.id) ??
        ({ channelId: f.channel.id, channelName: f.channel.name, platform: f.channel.platform, videos: 0, both: 0, remoteOnly: 0, diskOnly: 0, missing: 0, freeableBytes: 0 } satisfies StorageChannelRow);
      rows.set(f.channel.id, row);
      const inRemote = Boolean(f.remote.get('render')?.present);
      row.videos++;
      if (inRemote && f.onDisk) row.both++;
      else if (inRemote) row.remoteOnly++;
      else if (f.onDisk) row.diskOnly++;
      else row.missing++;
      onDiskBytes += f.heavyBytes;
      if (this.isFreeable(f)) {
        row.freeableBytes += f.heavyBytes;
        freeableBytes += f.heavyBytes;
        freeableVideos++;
      }
    }

    return {
      provider: await this.providerInfo(),
      lastSyncAt: this.settings.get<string>(SETTING_LAST_SYNC),
      remote: { bytes: remoteBytes, byKind },
      onDiskBytes,
      freeableBytes,
      freeableVideos,
      channels: [...rows.values()].sort((a, b) => b.videos - a.videos || a.channelName.localeCompare(b.channelName)),
      example: latest?.remotePath,
    };
  }

  /** The global storage binding and whether it can be used right now. */
  private async providerInfo(): Promise<StorageProviderInfo | undefined> {
    const binding = this.globalBinding();
    const config = binding ? this.configs.findById(binding.providerConfigId) : undefined;
    if (!config) return undefined;
    const manifest = this.registry.getFactory(config.adapter)?.manifest;
    const info: StorageProviderInfo = {
      configId: config.id,
      name: config.name,
      adapter: config.adapter,
      displayName: manifest?.displayName ?? config.adapter,
      root: '',
      ready: false,
    };
    try {
      const location = await this.provider().location();
      info.root = location.root;
      info.webUrl = location.webUrl;
      info.ready = true;
    } catch (err) {
      info.problem = err instanceof Error ? err.message : String(err);
    }
    return info;
  }

  private globalBinding() {
    return this.bindings.list().find((b) => b.channelId === null && b.capability === 'storage');
  }

  /** The global storage provider, with the registry's checks (secrets, enabled…). */
  private provider(): StorageProvider {
    return this.registry.resolve('storage', { channelId: '' }).provider;
  }

  // ── Target ────────────────────────────────────────────────────────────

  async setTarget(req: StorageTargetRequest): Promise<StorageOverview> {
    if (req.adapter === 'none') {
      this.bindings.removeGlobal('storage');
      this.events.log('info', 'storage', 'Archivo desactivado: los videos quedan solo en el disco');
      return this.overview();
    }

    let config = this.configs.list().find((c) => c.adapter === req.adapter);
    if (req.adapter === 'local-folder') {
      const root = req.root.trim();
      if (!isAbsolute(root)) throw new BadRequestException('Escribí la ruta completa de la carpeta (por ejemplo D:\\Archivo)');
      config = config
        ? this.configs.update(config.id, { params: { ...config.params, root }, enabled: true })
        : this.configs.create({ name: 'carpeta-local', adapter: 'local-folder', capabilities: ['storage'], params: { root }, enabled: true });
      if (!config) throw new NotFoundException('No existe el proveedor de carpeta local');
      this.registry.invalidate(config.id);
      const health = await this.registry.getInstance(config).healthCheck();
      if (!health.ok) throw new BadRequestException(`No se puede escribir en esa carpeta: ${health.message}`);
    } else {
      config ??= this.configs.create({
        name: 'google-drive',
        adapter: 'google-drive',
        capabilities: ['storage'],
        params: {},
        secretRef: 'GOOGLE_DRIVE_REFRESH_TOKEN',
        enabled: true,
      });
    }
    this.bindings.upsert({ channelId: null, capability: 'storage', providerConfigId: config.id, params: {}, fallbackIds: [] });
    this.events.log('info', 'storage', `Archivo en ${config.name}`);
    return this.overview();
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  /** Reconciles the index with the remote: marks what's missing and what came back. */
  async sync(): Promise<StorageOverview> {
    const binding = this.globalBinding();
    if (!binding) throw new BadRequestException('No hay almacenamiento configurado');
    const listed = await this.provider().list();
    const ids = new Set(listed.map((f) => f.remoteId));
    const paths_ = new Set(listed.map((f) => f.remotePath));
    let missing = 0;
    let indexed = 0;
    for (const r of this.remoteFiles.list()) {
      if (r.providerConfigId !== binding.providerConfigId) continue;
      indexed++;
      const present = ids.has(r.remoteId) || paths_.has(r.remotePath);
      if (!present) missing++;
      if (present !== r.present) this.remoteFiles.setPresent(r.id, present);
    }
    const orphans = listed.length - (indexed - missing);
    this.settings.set(SETTING_LAST_SYNC, nowIso());
    this.events.log(
      missing ? 'warn' : 'info',
      'storage',
      `Sincronizado: ${indexed - missing} de ${indexed} archivos en su lugar${missing ? `, ${missing} faltan` : ''}${
        orphans > 0 ? ` · ${orphans} sin registrar` : ''
      }`,
    );
    return this.overview();
  }

  // ── Upload / free / restore ─────────────────────────────────────────────

  /** Enqueues `archive` (forced) for these productions, or for every rendered one not archived yet. */
  async upload(productionIds?: string[]): Promise<UploadResult> {
    if (!this.globalBinding()) throw new BadRequestException('Elegí dónde archivar antes de subir');
    const targets = productionIds?.length
      ? productionIds.map((id) => this.requireProduction(id))
      : this.productionFiles()
          .filter((f) => f.onDisk && !f.remote.get('render')?.present)
          .map((f) => f.row);
    let queued = 0;
    for (const row of targets) {
      if (!row.renderPath) {
        if (productionIds?.length) throw new BadRequestException('La producción todavía no tiene render');
        continue;
      }
      try {
        await this.queue.retryProduction(row.id, 'archive', { force: true });
        queued++;
      } catch (err) {
        if (!(err instanceof ConflictException) || productionIds?.length === 1) throw err;
      }
    }
    return { queued };
  }

  /** Deletes the heavy files of archived productions, after checking each checksum. */
  async free(productionIds?: string[]): Promise<FreeSpaceResult> {
    const wanted = productionIds?.length ? new Set(productionIds) : undefined;
    let productions = 0;
    let freedBytes = 0;
    for (const f of this.productionFiles()) {
      if (wanted && !wanted.has(f.row.id)) continue;
      if (!this.isFreeable(f) || ['pending', 'running'].includes(f.row.status)) continue;

      let verified = true;
      for (const v of VERIFY_BEFORE_FREE) {
        const path = join(f.dir, v.name);
        if (existsSync(path) && (await md5File(path)) !== f.remote.get(v.kind)?.md5) verified = false;
      }
      if (!verified) {
        this.events.log('warn', 'storage', 'No se libera: el archivo local no coincide con el archivado (subilo de nuevo)', {
          productionId: f.row.id,
        });
        continue;
      }
      for (const name of FREEABLE_FILES) await rm(join(f.dir, name), { force: true });
      this.productions.setFreed(f.row.id, nowIso());
      productions++;
      freedBytes += f.heavyBytes;
    }
    if (productions) this.events.log('info', 'storage', `Espacio liberado: ${formatBytes(freedBytes)} de ${productions} video(s)`);
    return { productions, freedBytes };
  }

  /** "Traer de vuelta": downloads the freed files so the video can be watched or re-edited. */
  async restore(productionId: string): Promise<ProductionSummary> {
    const row = this.requireProduction(productionId);
    const channel = this.channels.findById(row.channelId);
    if (!channel) throw new NotFoundException(`No existe el canal de la producción ${productionId}`);
    const dir = paths.production(channel.slug, row.id);
    for (const file of this.remoteFiles.forProduction(row.id)) {
      const path = join(dir, file.localName);
      if (existsSync(path)) continue;
      if (!file.present) throw new ConflictException(`${file.localName} ya no está en el archivo (ver "Sincronizar")`);
      const provider = this.registry.resolveConfig('storage', file.providerConfigId, { channelId: channel.id }).provider;
      const { usage } = await provider.get(file.remoteId, path, { channelId: channel.id, productionId: row.id });
      this.costs.insert({
        channelId: channel.id,
        productionId: row.id,
        providerConfigId: file.providerConfigId,
        operation: 'storage-get',
        units: usage.units,
        unit: usage.unit,
        costUsd: usage.costUsd,
        durationMs: usage.durationMs,
      });
    }
    this.productions.setFreed(row.id, null);
    this.events.log('info', 'storage', 'Traído de vuelta del archivo', { productionId: row.id });
    const summary = this.summaries.get(row.id);
    if (!summary) throw new NotFoundException(`No existe la producción ${productionId}`);
    this.events.emit({ type: 'production', production: summary });
    return summary;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private requireProduction(id: string): ProductionRow {
    const row = this.productions.findById(id);
    if (!row) throw new NotFoundException(`No existe la producción ${id}`);
    return row;
  }

  /** Rendered productions with their archived files and heavy files on disk. */
  private productionFiles(): ProductionFiles[] {
    const channels = new Map(this.channels.list().map((c) => [c.id, c]));
    const remoteBy = new Map<string, Map<ArchivedKind, RemoteFileRow>>();
    for (const r of this.remoteFiles.list()) {
      const m = remoteBy.get(r.productionId) ?? new Map<ArchivedKind, RemoteFileRow>();
      m.set(r.kind, r);
      remoteBy.set(r.productionId, m);
    }
    const out: ProductionFiles[] = [];
    for (const row of this.productions.listAll()) {
      const channel = channels.get(row.channelId);
      if (!row.renderPath || !channel) continue;
      const dir = paths.production(channel.slug, row.id);
      let heavyBytes = 0;
      for (const name of FREEABLE_FILES) {
        const p = join(dir, name);
        if (existsSync(p)) heavyBytes += statSync(p).size;
      }
      const onDisk = existsSync(join(dir, 'render.mp4'));
      // Self-heal: the render came back some other way (re-render, copied by hand).
      if (onDisk && row.freedAt) this.productions.setFreed(row.id, null);
      out.push({ row, channel, dir, remote: remoteBy.get(row.id) ?? new Map(), onDisk, heavyBytes });
    }
    return out;
  }

  /** Cheap check for the overview (present and same size); `free` verifies the md5 before deleting. */
  private isFreeable(f: ProductionFiles): boolean {
    if (!f.onDisk || f.heavyBytes === 0) return false;
    return VERIFY_BEFORE_FREE.every((v) => {
      const path = join(f.dir, v.name);
      if (!existsSync(path)) return true;
      const archived = f.remote.get(v.kind);
      return Boolean(archived?.present) && statSync(path).size === archived?.sizeBytes;
    });
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
