import type { Entitlement, EntitlementPlan, EntitlementSource } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/server';

const DEFAULT_ENTITLEMENT: Omit<Entitlement, 'user_id'> = {
  plan: 'free',
  is_active: false,
  source: 'none',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  current_period_end: null,
  updated_at: new Date().toISOString(),
};

export type EntitlementUpdate = {
  plan?: EntitlementPlan;
  is_active?: boolean;
  source?: EntitlementSource;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
};

/**
 * Fetch entitlements row for user; if none, insert default via admin client and return it.
 * INSERT stays service-role-only (no RLS policy for authenticated insert).
 */
export async function getEntitlementForUser(userId: string): Promise<Entitlement> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('entitlements')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (row) {
    return {
      user_id: row.user_id,
      plan: row.plan ?? 'free',
      is_active: row.is_active ?? false,
      source: row.source ?? 'none',
      stripe_customer_id: row.stripe_customer_id ?? null,
      stripe_subscription_id: row.stripe_subscription_id ?? null,
      current_period_end: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  const { data: inserted, error } = await admin
    .from('entitlements')
    .insert({
      user_id: userId,
      ...DEFAULT_ENTITLEMENT,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to ensure entitlement row: ${error.message}`);
  }

  return {
    user_id: inserted.user_id,
    plan: inserted.plan ?? 'free',
    is_active: inserted.is_active ?? false,
    source: inserted.source ?? 'none',
    stripe_customer_id: inserted.stripe_customer_id ?? null,
    stripe_subscription_id: inserted.stripe_subscription_id ?? null,
    current_period_end: inserted.current_period_end ? new Date(inserted.current_period_end).toISOString() : null,
    updated_at: inserted.updated_at ? new Date(inserted.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Merge incoming update with existing row: use max(current_period_end), don't overwrite active.
 * If existing is active (e.g. Stripe) and ends later than incoming (e.g. Apple), keep existing.
 * If Apple returns inactive, don't downgrade when Stripe is still active.
 * Used by Stripe webhook, Apple verify, and any future entitlement refresh route.
 */
export function mergeEntitlementUpdate(
  existing: Entitlement,
  update: EntitlementUpdate
): EntitlementUpdate {
  const existingEnd = existing.current_period_end
    ? new Date(existing.current_period_end).getTime()
    : 0;
  const incomingEnd = update.current_period_end
    ? new Date(update.current_period_end).getTime()
    : 0;

  const existingActive = existing.is_active && existingEnd > Date.now();
  const incomingActive = update.is_active === true && incomingEnd > Date.now();

  if (existingActive && !incomingActive) {
    if (existing.source === 'stripe' && update.source === 'apple') {
      return {};
    }
    if (existing.source === 'apple' && update.source === 'stripe') {
      return {};
    }
  }

  if (existingActive && incomingActive) {
    const maxEnd = Math.max(existingEnd, incomingEnd);
    return {
      ...update,
      current_period_end: new Date(maxEnd).toISOString(),
      is_active: true,
    };
  }

  if (existingActive && existingEnd >= incomingEnd && update.source === 'apple') {
    return {};
  }

  return update;
}

export function canUsePro(entitlement: Entitlement): boolean {
  return (
    entitlement.is_active &&
    (entitlement.plan === 'pro' || entitlement.plan === 'team')
  );
}

export function canUseTeam(entitlement: Entitlement): boolean {
  return entitlement.is_active && entitlement.plan === 'team';
}
