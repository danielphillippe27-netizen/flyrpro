import { createAdminClient } from '@/lib/supabase/server';
import Stripe from 'stripe';
import {
  getEntitlementForUser,
  mergeEntitlementUpdate,
} from '@/app/lib/billing/entitlements';
import type { Entitlement } from '@/types/database';
import { planFromStripePriceId } from '@/app/lib/billing/stripe-products';

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/**
 * Resolve app user_id from a Stripe Checkout session (metadata or entitlements lookup).
 */
export async function resolveUserIdFromSession(
  supabase: SupabaseAdmin,
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const fromMeta = session.metadata?.user_id;
  if (fromMeta) return fromMeta;
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;
  if (!customerId) return null;
  const { data: row } = await supabase
    .from('entitlements')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();
  return row?.user_id ?? null;
}

/**
 * Apply a Stripe subscription to the entitlements table (used by webhook and confirm-session).
 */
export async function applyStripeSubscriptionUpdate(
  supabase: SupabaseAdmin,
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return;

  const isActive =
    subscription.status === 'active' || subscription.status === 'trialing';
  const priceId = subscription.items?.data?.[0]?.price?.id ?? '';
  const plan = planFromStripePriceId(priceId);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  let existing: Entitlement;
  try {
    existing = await getEntitlementForUser(userId);
  } catch {
    existing = {
      user_id: userId,
      plan: 'free',
      is_active: false,
      source: 'none',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_end: null,
      updated_at: new Date().toISOString(),
    };
  }

  const update = mergeEntitlementUpdate(existing, {
    plan: plan === 'free' ? existing.plan : plan,
    is_active: isActive,
    source: 'stripe',
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    current_period_end: periodEnd,
  });

  if (Object.keys(update).length === 0) return;

  await supabase
    .from('entitlements')
    .upsert(
      {
        user_id: userId,
        plan: update.plan ?? existing.plan,
        is_active: update.is_active ?? existing.is_active,
        source: update.source ?? existing.source,
        stripe_customer_id: update.stripe_customer_id ?? existing.stripe_customer_id,
        stripe_subscription_id:
          update.stripe_subscription_id ?? existing.stripe_subscription_id,
        current_period_end:
          update.current_period_end ?? existing.current_period_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
}
