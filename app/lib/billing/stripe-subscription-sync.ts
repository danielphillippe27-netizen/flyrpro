import { createAdminClient } from '@/lib/supabase/server';
import Stripe from 'stripe';
import {
  getEntitlementForUser,
  mergeEntitlementUpdate,
} from '@/app/lib/billing/entitlements';
import type { Entitlement } from '@/types/database';
import { planFromStripePriceId } from '@/app/lib/billing/stripe-products';

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;
export type WorkspaceSubscriptionStatus =
  | 'inactive'
  | 'trialing'
  | 'active'
  | 'past_due';

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

  if (Object.keys(update).length > 0) {
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

  await syncWorkspaceSubscriptionFromStripe(supabase, userId, subscription);
}

/**
 * Resolve the user's primary workspace for billing updates.
 * Prefer owner workspace, then first membership.
 */
async function resolvePrimaryWorkspaceIdForBilling(
  supabase: SupabaseAdmin,
  userId: string
): Promise<string | null> {
  const { data: owned } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned?.id) return owned.id;

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return membership?.workspace_id ?? null;
}

export async function updateWorkspaceSubscriptionForUser(
  supabase: SupabaseAdmin,
  userId: string,
  payload: {
    status: WorkspaceSubscriptionStatus;
    trialEndsAt: string | null;
    maxSeats?: number;
  }
): Promise<void> {
  const workspaceId = await resolvePrimaryWorkspaceIdForBilling(supabase, userId);
  if (!workspaceId) return;

  const workspaceUpdate: {
    subscription_status: WorkspaceSubscriptionStatus;
    trial_ends_at: string | null;
    updated_at: string;
    max_seats?: number;
  } = {
    subscription_status: payload.status,
    trial_ends_at: payload.trialEndsAt,
    updated_at: new Date().toISOString(),
  };

  if (typeof payload.maxSeats === 'number' && Number.isFinite(payload.maxSeats)) {
    workspaceUpdate.max_seats = Math.max(1, Math.trunc(payload.maxSeats));
  }

  await supabase
    .from('workspaces')
    .update(workspaceUpdate)
    .eq('id', workspaceId);
}

function workspaceStatusFromStripe(
  status: Stripe.Subscription.Status
): WorkspaceSubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    default:
      return 'inactive';
  }
}

/**
 * Set the user's primary workspace subscription_status from Stripe subscription state.
 */
export async function syncWorkspaceSubscriptionFromStripe(
  supabase: SupabaseAdmin,
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const status = workspaceStatusFromStripe(subscription.status);
  const trialEnd =
    status === 'trialing' && subscription.trial_end != null
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null;
  const seatQuantity = Math.max(1, subscription.items?.data?.[0]?.quantity ?? 1);

  await updateWorkspaceSubscriptionForUser(supabase, userId, {
    status,
    trialEndsAt: trialEnd,
    maxSeats: seatQuantity,
  });
}
