import { Inject, Injectable } from '@nestjs/common';
import type { Capability, ProviderBinding, TextRole } from '@hefesto/shared-types';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type DbInstance } from '../db.token';
import { providerBindings } from '../schema';
import { newId, nowIso } from '../util';

export type NewProviderBinding = Omit<ProviderBinding, 'id'> & { id?: string };

function toDomain(row: typeof providerBindings.$inferSelect): ProviderBinding {
  return {
    id: row.id,
    channelId: row.channelId,
    capability: row.capability,
    role: row.role ?? undefined,
    providerConfigId: row.providerConfigId,
    params: row.params,
    fallbackIds: row.fallbackIds,
  };
}

@Injectable()
export class ProviderBindingsRepository {
  constructor(@Inject(DB) private readonly db: DbInstance) {}

  list(): ProviderBinding[] {
    return this.db.select().from(providerBindings).all().map(toDomain);
  }

  /**
   * Resolves the binding a channel should use for a capability (and, for
   * text, a role): a channel-specific binding wins, otherwise the global one
   * (`channelId = null`) is used. Returns undefined if neither exists —
   * callers decide whether that's a hard error or falls back to `fake`.
   */
  resolve(channelId: string, capability: Capability, role?: TextRole): ProviderBinding | undefined {
    const roleCondition = role ? eq(providerBindings.role, role) : isNull(providerBindings.role);

    const channelRow = this.db
      .select()
      .from(providerBindings)
      .where(and(eq(providerBindings.channelId, channelId), eq(providerBindings.capability, capability), roleCondition))
      .get();
    if (channelRow) {
      return toDomain(channelRow);
    }

    const globalRow = this.db
      .select()
      .from(providerBindings)
      .where(
        and(isNull(providerBindings.channelId), eq(providerBindings.capability, capability), roleCondition),
      )
      .get();
    return globalRow ? toDomain(globalRow) : undefined;
  }

  create(binding: NewProviderBinding): ProviderBinding {
    const id = binding.id ?? newId();
    this.db
      .insert(providerBindings)
      .values({
        id,
        channelId: binding.channelId,
        capability: binding.capability,
        role: binding.role ?? null,
        providerConfigId: binding.providerConfigId,
        params: binding.params,
        fallbackIds: binding.fallbackIds,
        createdAt: nowIso(),
      })
      .run();
    const row = this.db.select().from(providerBindings).where(eq(providerBindings.id, id)).get();
    return toDomain(row as typeof providerBindings.$inferSelect);
  }

  /** Insert-or-update the (channelId, capability, role) binding, for idempotent seeding. */
  upsert(binding: NewProviderBinding): ProviderBinding {
    const roleCondition = binding.role
      ? eq(providerBindings.role, binding.role)
      : isNull(providerBindings.role);
    const channelCondition = binding.channelId
      ? eq(providerBindings.channelId, binding.channelId)
      : isNull(providerBindings.channelId);
    const existing = this.db
      .select()
      .from(providerBindings)
      .where(and(channelCondition, eq(providerBindings.capability, binding.capability), roleCondition))
      .get();
    if (!existing) {
      return this.create(binding);
    }
    this.db
      .update(providerBindings)
      .set({
        providerConfigId: binding.providerConfigId,
        params: binding.params,
        fallbackIds: binding.fallbackIds,
      })
      .where(eq(providerBindings.id, existing.id))
      .run();
    const row = this.db
      .select()
      .from(providerBindings)
      .where(eq(providerBindings.id, existing.id))
      .get();
    return toDomain(row as typeof providerBindings.$inferSelect);
  }
}
