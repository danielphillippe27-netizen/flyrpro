import type Stripe from 'stripe';
import type {
  WorkspaceBillingAddon,
  WorkspaceBillingAddonStatus,
} from '@/types/database';
import { createAdminClient } from '@/lib/supabase/server';
import { getAllPowerDialerAddonPriceIds } from '@/app/lib/billing/stripe-products';

export const POWER_DIALER_ADDON_KEY = 'power_dialer' as const;

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

function addonStatusFromStripe(status: Stripe.Subscription.Status): WorkspaceBillingAddonStatus {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'inactive';
  }
}

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

export function isPowerDialerAddonPriceId(priceId: string): boolean {
  return Boolean(priceId) && getAllPowerDialerAddonPriceIds().includes(priceId);
}

export function getDefaultWorkspacePowerDialerAddon(
  workspaceId: string
): WorkspaceBillingAddon {
  const now = new Date().toISOString();
  return {
    id: '',
    workspace_id: workspaceId,
    addon_key: POWER_DIALER_ADDON_KEY,
    status: 'inactive',
    stripe_subscription_id: null,
    stripe_subscription_item_id: null,
    stripe_price_id: null,
    quantity: 1,
    amount_cents: null,
    currency: null,
    activated_at: null,
    canceled_at: null,
    metadata: {},
    created_at: now,
    updated_at: now,
  };
}

export async function getWorkspacePowerDialerAddon(
  supabase: SupabaseAdmin,
  workspaceId: string
): Promise<WorkspaceBillingAddon> {
  const { data } = await supabase
    .from('workspace_billing_addons')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('addon_key', POWER_DIALER_ADDON_KEY)
    .maybeSingle();

  if (!data) {
    return getDefaultWorkspacePowerDialerAddon(workspaceId);
  }

  return {
    id: data.id,
    workspace_id: data.workspace_id,
    addon_key: POWER_DIALER_ADDON_KEY,
    status: (data.status as WorkspaceBillingAddonStatus) ?? 'inactive',
    stripe_subscription_id: data.stripe_subscription_id ?? null,
    stripe_subscription_item_id: data.stripe_subscription_item_id ?? null,
    stripe_price_id: data.stripe_price_id ?? null,
    quantity: typeof data.quantity === 'number' ? data.quantity : 1,
    amount_cents: typeof data.amount_cents === 'number' ? data.amount_cents : null,
    currency: data.currency ?? null,
    activated_at: data.activated_at ?? null,
    canceled_at: data.canceled_at ?? null,
    metadata:
      data.metadata && typeof data.metadata === 'object'
        ? (data.metadata as Record<string, unknown>)
        : {},
    created_at: data.created_at ?? new Date().toISOString(),
    updated_at: data.updated_at ?? new Date().toISOString(),
  };
}

export async function syncWorkspacePowerDialerAddonFromStripe(
  supabase: SupabaseAdmin,
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const workspaceId = await resolvePrimaryWorkspaceIdForBilling(supabase, userId);
  if (!workspaceId) return;

  const addonItem = subscription.items.data.find((item) =>
    isPowerDialerAddonPriceId(item.price?.id ?? '')
  );
  const now = new Date().toISOString();

  if (!addonItem) {
    await supabase
      .from('workspace_billing_addons')
      .upsert(
        {
          workspace_id: workspaceId,
          addon_key: POWER_DIALER_ADDON_KEY,
          status:
            subscription.status === 'canceled' ? 'canceled' : 'inactive',
          stripe_subscription_id: subscription.id,
          stripe_subscription_item_id: null,
          stripe_price_id: null,
          quantity: 1,
          activated_at: null,
          canceled_at: now,
          updated_at: now,
        },
        { onConflict: 'workspace_id,addon_key' }
      );
    return;
  }

  const status = addonStatusFromStripe(subscription.status);
  await supabase
    .from('workspace_billing_addons')
    .upsert(
      {
        workspace_id: workspaceId,
        addon_key: POWER_DIALER_ADDON_KEY,
        status,
        stripe_subscription_id: subscription.id,
        stripe_subscription_item_id: addonItem.id,
        stripe_price_id: addonItem.price?.id ?? null,
        quantity: Math.max(1, addonItem.quantity ?? 1),
        amount_cents:
          typeof addonItem.price?.unit_amount === 'number'
            ? addonItem.price.unit_amount
            : null,
        currency: addonItem.price?.currency?.toUpperCase() ?? null,
        activated_at: status === 'active' ? now : null,
        canceled_at: status === 'canceled' ? now : null,
        updated_at: now,
      },
      { onConflict: 'workspace_id,addon_key' }
    );
}

export async function markWorkspacePowerDialerAddonInactiveForUser(
  supabase: SupabaseAdmin,
  userId: string
): Promise<void> {
  const workspaceId = await resolvePrimaryWorkspaceIdForBilling(supabase, userId);
  if (!workspaceId) return;

  await supabase
    .from('workspace_billing_addons')
    .upsert(
      {
        workspace_id: workspaceId,
        addon_key: POWER_DIALER_ADDON_KEY,
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,addon_key' }
    );
}
