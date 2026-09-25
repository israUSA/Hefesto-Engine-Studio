import { Inject, Injectable } from '@nestjs/common';
import type { HealthResult, ProviderConfig } from '@hefesto/shared-types';
import { eq } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { providerConfigs } from '../schema';
import { newId, nowIso } from '../util';

export type NewProviderConfig = Omit<ProviderConfig, 'id'> & { id?: string };

function toDomain(row: typeof providerConfigs.$inferSelect): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    capabilities: row.capabilities,
    baseUrl: row.baseUrl ?? undefined,
    model: row.model ?? undefined,
    params: row.params,
    secretRef: row.secretRef ?? undefined,
    pricingOverride: row.pricingOverride ?? undefined,
    enabled: row.enabled,
  };
}

@Injectable()
export class ProviderConfigsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  list(): ProviderConfig[] {
    return this.db.select().from(providerConfigs).all().map(toDomain);
  }

  findById(id: string): ProviderConfig | undefined {
    const row = this.db.select().from(providerConfigs).where(eq(providerConfigs.id, id)).get();
    return row ? toDomain(row) : undefined;
  }

  findByName(name: string): ProviderConfig | undefined {
    const row = this.db.select().from(providerConfigs).where(eq(providerConfigs.name, name)).get();
    return row ? toDomain(row) : undefined;
  }

  /** Last `POST /:id/test` result, stored as JSON with `checkedAt` alongside the health fields. */
  getLastHealth(id: string): (HealthResult & { checkedAt: string }) | undefined {
    const row = this.db.select({ lastHealth: providerConfigs.lastHealth }).from(providerConfigs).where(eq(providerConfigs.id, id)).get();
    return (row?.lastHealth as (HealthResult & { checkedAt: string }) | null) ?? undefined;
  }

  setLastHealth(id: string, health: HealthResult): void {
    const stored = { ...health, checkedAt: nowIso() };
    this.db
      .update(providerConfigs)
      .set({ lastHealth: stored as unknown as HealthResult, updatedAt: nowIso() })
      .where(eq(providerConfigs.id, id))
      .run();
  }

  remove(id: string): void {
    this.db.delete(providerConfigs).where(eq(providerConfigs.id, id)).run();
  }

  create(config: NewProviderConfig): ProviderConfig {
    const id = config.id ?? newId();
    const timestamp = nowIso();
    this.db
      .insert(providerConfigs)
      .values({
        id,
        name: config.name,
        adapter: config.adapter,
        capabilities: config.capabilities,
        baseUrl: config.baseUrl ?? null,
        model: config.model ?? null,
        params: config.params,
        secretRef: config.secretRef ?? null,
        pricingOverride: config.pricingOverride ?? null,
        enabled: config.enabled,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    return this.findById(id) as ProviderConfig;
  }

  /** Partial update for PATCH /api/providers/:id. */
  update(id: string, patch: Partial<NewProviderConfig>): ProviderConfig | undefined {
    if (!this.findById(id)) return undefined;
    const set: Partial<typeof providerConfigs.$inferInsert> = { updatedAt: nowIso() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.adapter !== undefined) set.adapter = patch.adapter;
    if (patch.capabilities !== undefined) set.capabilities = patch.capabilities;
    if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl ?? null;
    if (patch.model !== undefined) set.model = patch.model ?? null;
    if (patch.params !== undefined) set.params = patch.params;
    if (patch.secretRef !== undefined) set.secretRef = patch.secretRef ?? null;
    if (patch.pricingOverride !== undefined) set.pricingOverride = patch.pricingOverride ?? null;
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    this.db.update(providerConfigs).set(set).where(eq(providerConfigs.id, id)).run();
    return this.findById(id);
  }

  /** Insert-or-update by name, so seeding the built-in providers is idempotent. */
  upsertByName(config: NewProviderConfig): ProviderConfig {
    const existing = this.findByName(config.name);
    if (!existing) {
      return this.create(config);
    }
    this.db
      .update(providerConfigs)
      .set({
        adapter: config.adapter,
        capabilities: config.capabilities,
        baseUrl: config.baseUrl ?? null,
        model: config.model ?? null,
        params: config.params,
        secretRef: config.secretRef ?? null,
        pricingOverride: config.pricingOverride ?? null,
        enabled: config.enabled,
        updatedAt: nowIso(),
      })
      .where(eq(providerConfigs.id, existing.id))
      .run();
    return this.findById(existing.id) as ProviderConfig;
  }
}
