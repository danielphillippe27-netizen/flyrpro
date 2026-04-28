import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import { applyStripeSubscriptionUpdate } from '@/app/lib/billing/stripe-subscription-sync';
import {
  getPowerDialerAddonOffer,
  getPowerDialerAddonPriceId,
  getRequestBillingCurrency,
  type BillingCurrency,
} from '@/app/lib/billing/stripe-products';
import {
  getWorkspacePowerDialerAddon,
  isPowerDialerAddonPriceId,
} from '@/app/lib/billing/workspace-addons';
import {
  getDialerWorkspaceAccessError,
  isDialerEnabledForWorkspace,
} from '@/lib/dialer/feature-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AddonPayload = {
  workspaceId?: string;
  currency?: BillingCurrency;
};

async function resolveManageContext(
  request: NextRequest,
  requestedWorkspaceId?: string | null
) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId ?? undefined
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  if (!isDialerEnabledForWorkspace(membership.workspaceId)) {
    return NextResponse.json(
      { error: getDialerWorkspaceAccessError() },
      { status: 403 }
    );
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only workspace owners and admins can manage add-ons' },
      { status: 403 }
    );
  }

  return {
    admin,
    requestUser,
    workspaceId: membership.workspaceId,
  };
}

async function buildAddonResponse(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  currency: BillingCurrency
) {
  const addon = await getWorkspacePowerDialerAddon(admin, workspaceId);
  const offer = getPowerDialerAddonOffer(currency);
  return {
    offer: {
      priceId: offer.priceId || null,
      amount: offer.amount,
      currency: offer.currency,
      period: offer.period,
    },
    addon: {
      status: addon.status,
      isActive: addon.status === 'active',
      priceId: addon.stripe_price_id ?? null,
      amountCents: addon.amount_cents ?? null,
      currency: addon.currency ?? null,
    },
  };
}

export async function GET(request: NextRequest) {
  const context = await resolveManageContext(
    request,
    request.nextUrl.searchParams.get('workspaceId')
  );
  if (context instanceof NextResponse) {
    return context;
  }

  return NextResponse.json(
    await buildAddonResponse(
      context.admin,
      context.workspaceId,
      getRequestBillingCurrency(request)
    )
  );
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as AddonPayload;
  const context = await resolveManageContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const currency = body.currency ?? getRequestBillingCurrency(request);
  const priceId = getPowerDialerAddonPriceId(currency);
  if (!priceId) {
    return NextResponse.json(
      { error: `Power Dialer add-on price is not configured for ${currency}.` },
      { status: 500 }
    );
  }

  const entitlement = await getEntitlementForUser(context.requestUser.id);
  if (!entitlement.is_active || !entitlement.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'An active paid workspace subscription is required first' },
      { status: 400 }
    );
  }

  const subscription = await stripe.subscriptions.retrieve(
    entitlement.stripe_subscription_id
  );
  const existingAddonItem = subscription.items.data.find((item) =>
    isPowerDialerAddonPriceId(item.price?.id ?? '')
  );

  let updatedSubscription: Stripe.Subscription = subscription;
  if (!existingAddonItem) {
    updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      items: [
        ...subscription.items.data.map((item) => ({
          id: item.id,
          quantity: Math.max(1, item.quantity ?? 1),
        })),
        {
          price: priceId,
          quantity: 1,
        },
      ],
      proration_behavior: 'create_prorations',
    });
  } else if (existingAddonItem.price?.id !== priceId) {
    updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      items: subscription.items.data.map((item) =>
        item.id === existingAddonItem.id
          ? {
              id: item.id,
              price: priceId,
              quantity: 1,
            }
          : {
              id: item.id,
              quantity: Math.max(1, item.quantity ?? 1),
            }
      ),
      proration_behavior: 'create_prorations',
    });
  }

  await applyStripeSubscriptionUpdate(
    context.admin,
    context.requestUser.id,
    updatedSubscription
  );

  return NextResponse.json(
    await buildAddonResponse(context.admin, context.workspaceId, currency)
  );
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as AddonPayload;
  const context = await resolveManageContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }
  const currency = body.currency ?? getRequestBillingCurrency(request);

  const entitlement = await getEntitlementForUser(context.requestUser.id);
  if (!entitlement.stripe_subscription_id) {
    return NextResponse.json(
      { error: 'No Stripe subscription was found for this account.' },
      { status: 400 }
    );
  }

  const subscription = await stripe.subscriptions.retrieve(
    entitlement.stripe_subscription_id
  );
  const addonItem = subscription.items.data.find((item) =>
    isPowerDialerAddonPriceId(item.price?.id ?? '')
  );
  if (!addonItem) {
    return NextResponse.json(
      await buildAddonResponse(context.admin, context.workspaceId, currency)
    );
  }

  const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
    items: subscription.items.data
      .filter((item) => item.id !== addonItem.id)
      .map((item) => ({
        id: item.id,
        quantity: Math.max(1, item.quantity ?? 1),
      })),
    proration_behavior: 'create_prorations',
  });

  await applyStripeSubscriptionUpdate(
    context.admin,
    context.requestUser.id,
    updatedSubscription
  );

  return NextResponse.json(
    await buildAddonResponse(context.admin, context.workspaceId, currency)
  );
}
