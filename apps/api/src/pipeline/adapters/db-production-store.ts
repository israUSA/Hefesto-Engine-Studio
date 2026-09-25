import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel, ProductionStage, RunStatus, StageKey } from '@hefesto/shared-types';
import { asc, desc, eq } from 'drizzle-orm';
import { stat } from 'node:fs/promises';
import { DB, type DbInstance } from '../../db/db.token';
import {
  AssetsRepository,
  ChannelsRepository,
  CostEntriesRepository,
  ProductionsRepository,
} from '../../db/repositories';
import { productions, scenes, scripts } from '../../db/schema';
import { newId, nowIso } from '../../db/util';
import { sha256File } from '../hash';
import type { ProductionRecord, ProductionStore, StoredScript } from '../ports';
import { keywordsFromPrompt } from '../keywords';

@Injectable()
export class DbProductionStore implements ProductionStore {
  private readonly log = new Logger('Productions');

  constructor(
    @Inject(DB) private readonly db: DbInstance,
    private readonly channels: ChannelsRepository,
    private readonly productions: ProductionsRepository,
    private readonly assets: AssetsRepository,
    private readonly costs: CostEntriesRepository,
  ) {}

  async getChannelBySlug(slug: string): Promise<Channel | null> {
    return this.channels.findBySlug(slug) ?? null;
  }

  async getChannelById(id: string): Promise<Channel | null> {
    return this.channels.findById(id) ?? null;
  }

  async recentTopics(channelId: string, limit: number): Promise<string[]> {
    const rows = this.db
      .select({ hook: scripts.hook, metadata: scripts.metadata })
      .from(scripts)
      .where(eq(scripts.channelId, channelId))
      .orderBy(desc(scripts.createdAt))
      .limit(limit)
      .all();
    return rows.map((r) => Object.values(r.metadata)[0]?.title ?? r.hook);
  }

  async createProduction(id: string, channelId: string, script: StoredScript): Promise<void> {
    const scriptId = newId();
    this.db.transaction((tx) => {
      tx.insert(scripts)
        .values({
          id: scriptId,
          channelId,
          title: script.title,
          hook: script.hook,
          body: script.body,
          cta: script.cta,
          fullText: script.fullText,
          verseRefs: script.verseRefs,
          metadata: script.metadata as typeof scripts.$inferInsert.metadata,
          status: 'approved',
          createdAt: nowIso(),
        })
        .run();
      for (const s of script.scenes) {
        tx.insert(scenes)
          .values({ id: newId(), scriptId, order: s.order, text: s.text, visualPrompt: s.visualPrompt })
          .run();
      }
    });
    this.productions.create({ id, scriptId, channelId });
  }

  async createProductionForScript(id: string, channelId: string, scriptId: string): Promise<void> {
    this.productions.create({ id, scriptId, channelId });
  }

  async loadScript(scriptId: string): Promise<(StoredScript & { channelId: string; status: string }) | null> {
    const row = this.db.select().from(scripts).where(eq(scripts.id, scriptId)).get();
    if (!row) return null;
    const sceneRows = this.db.select().from(scenes).where(eq(scenes.scriptId, scriptId)).orderBy(asc(scenes.order)).all();
    const channel = this.channels.findById(row.channelId);
    const meta = channel ? row.metadata[channel.platform] : undefined;
    const sceneList = sceneRows.length
      ? sceneRows.map((s) => ({
          order: s.order,
          text: s.text,
          visualPrompt: s.visualPrompt,
          // Scenes in the DB don't keep stock keywords; derive them from the visual prompt.
          keywords: keywordsFromPrompt(s.visualPrompt || s.text),
        }))
      : [{ order: 0, text: row.fullText, visualPrompt: '', keywords: keywordsFromPrompt(row.fullText) }];
    return {
      channelId: row.channelId,
      status: row.status,
      title: row.title ?? meta?.title ?? row.hook,
      hook: row.hook,
      body: row.body,
      cta: row.cta,
      fullText: row.fullText,
      verseRefs: row.verseRefs,
      metadata: row.metadata,
      scenes: sceneList,
    };
  }

  async getProduction(id: string): Promise<ProductionRecord | null> {
    const row = this.productions.findById(id);
    if (!row) return null;
    return {
      id: row.id,
      channelId: row.channelId,
      scriptId: row.scriptId,
      stage: row.stage,
      status: row.status,
      inputHashes: row.inputHashes,
    };
  }

  async markStage(productionId: string, key: string, hash: string, stage?: ProductionStage): Promise<void> {
    const current = this.productions.findById(productionId);
    if (!current) return;
    this.productions.updateStage(productionId, stage ?? current.stage, { [key]: hash }, current.status);
  }

  async setRender(productionId: string, renderPath: string, durationMs: number): Promise<void> {
    this.productions.setRenderResult(productionId, renderPath, durationMs);
  }

  async setProgress(
    productionId: string,
    patch: { currentStep?: StageKey | null; progress?: number },
  ): Promise<void> {
    const set: Partial<typeof productions.$inferInsert> = { updatedAt: nowIso() };
    if (patch.currentStep !== undefined) set.currentStep = patch.currentStep;
    if (patch.progress !== undefined) set.progress = Math.max(0, Math.min(1, patch.progress));
    this.db.update(productions).set(set).where(eq(productions.id, productionId)).run();
  }

  async clearStageHashes(productionId: string, keys: string[]): Promise<void> {
    const current = this.productions.findById(productionId);
    if (!current) return;
    const inputHashes = { ...current.inputHashes };
    for (const k of keys) delete inputHashes[k];
    this.db.update(productions).set({ inputHashes, updatedAt: nowIso() }).where(eq(productions.id, productionId)).run();
  }

  async setStatus(productionId: string, status: RunStatus, error?: string): Promise<void> {
    if (!this.productions.findById(productionId)) return;
    this.db
      .update(productions)
      .set({ status, error: error ?? null, updatedAt: nowIso() })
      .where(eq(productions.id, productionId))
      .run();
    if (error && status === 'failed') this.log.warn(`${productionId}: ${error}`);
    if (status === 'done' || status === 'failed') {
      this.db
        .update(productions)
        .set({ costUsd: this.costs.sumByProduction(productionId) })
        .where(eq(productions.id, productionId))
        .run();
    }
  }

  async recordCost(entry: Parameters<ProductionStore['recordCost']>[0]): Promise<void> {
    this.costs.insert(entry);
  }

  async recordAsset(asset: Parameters<ProductionStore['recordAsset']>[0]): Promise<void> {
    const [sha256, info] = await Promise.all([sha256File(asset.localPath), stat(asset.localPath)]);
    this.assets.create({ ...asset, sha256, sizeBytes: info.size });
  }
}
