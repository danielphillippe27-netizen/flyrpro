import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import { resolveReferralDiscount } from '@/app/lib/billing/stripe-referral';
import {
  getAppUrl,
  getProPriceId,
  STRIPE_ALLOWED_PRICE_IDS,
} from '@/app/lib/billing/stripe-products';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import {
  getStripeCrossModeMessage,
  isStripeCrossModeError,
  isStripeNoSuchCustomerError,
} from '@/app/lib/billing/stripe-errors';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { WORKSPACE_TRIAL_DAYS } from '@/app/lib/billing/workspace-trial';

export async function POST(request: NextRequest) {
  try {
    if (!isStripeSecretKeyConfigured()) {
      return NextResponse.json(
        { error: 'Stripe secret key is not configured for the current mode.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    let priceId = body?.priceId as string | undefined;
    const plan = body?.plan as 'annual' | 'monthly' | undefined;
    const currency = body?.currency as 'USD' | 'CAD' | undefined;
    const requestedSeatsRaw = body?.seats;

    if (plan && currency) {
      const resolved = getProPriceId(plan, currency);
      if (resolved) priceId = resolved;
    }

    if (!priceId || !STRIPE_ALLOWED_PRICE_IDS.includes(priceId)) {
      return NextResponse.json(
        { error: 'Valid price ID required' },
        { status: 400 }
      );
    }

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = requestUser.id;
    const admin = createAdminClient();
    const { data: ownerMembership } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let workspaceSeats = 1;
    let workspaceReferralCode: string | null = null;
    let workspaceSubscriptionStatus: string | null = null;
    let workspaceTrialEndsAt: string | null = null;
    if (ownerMembership?.workspace_id) {
      const { data: workspace } = await admin
        .from('workspaces')
        .select('max_seats, referral_code_used, subscription_status, trial_ends_at')
        .eq('id', ownerMembership.workspace_id)
        .maybeSingle();
      workspaceSeats = Math.max(1, workspace?.max_seats ?? 1);
      workspaceReferralCode =
        typeof workspace?.referral_code_used === 'string' &&
        workspace.referral_code_used.trim().length > 0
          ? workspace.referral_code_used.trim()
          : null;
      workspaceSubscriptionStatus =
        typeof workspace?.subscription_status === 'string'
          ? workspace.subscription_status
          : null;
      workspaceTrialEndsAt =
        typeof workspace?.trial_ends_at === 'string'
          ? workspace.trial_ends_at
          : null;
    }

    const parsedRequestedSeats =
      typeof requestedSeatsRaw === 'number' && Number.isFinite(requestedSeatsRaw)
        ? Math.trunc(requestedSeatsRaw)
        : NaN;
    const quantity = Number.isFinite(parsedRequestedSeats) && parsedRequestedSeats > 0
      ? Math.min(100, parsedRequestedSeats)
      : Math.min(100, workspaceSeats);

    const entitlement = await getEntitlementForUser(userId);
    let customerId = entitlement.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: requestUser.email ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await admin
        .from('entitlements')
        .upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
    }

    const appUrl = getAppUrl(request);
    const price = await stripe.prices.retrieve(priceId);
    const isUsd = price.currency?.toLowerCase() === 'usd';
    const resolvedReferral = await resolveReferralDiscount(workspaceReferralCode);
    const discounts = resolvedReferral?.discounts;
    const workspaceTrialEnd = workspaceTrialEndsAt ? new Date(workspaceTrialEndsAt) : null;
    const shouldHonorWorkspaceTrial =
      !entitlement.stripe_subscription_id &&
      workspaceSubscriptionStatus?.toLowerCase() === 'trialing' &&
      !!workspaceTrialEnd &&
      !Number.isNaN(workspaceTrialEnd.getTime()) &&
      workspaceTrialEnd.getTime() > Date.now();
    let session;
    try {
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        line_items: [{ price: priceId, quantity }],
        mode: 'subscription',
        success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/subscribe`,
        metadata: {
          user_id: userId,
          seats: String(quantity),
          ...(workspaceReferralCode ? { referral_code: workspaceReferralCode } : {}),
        },
        ...(isUsd && {
          custom_text: {
            submit: {
              message: 'Amount charged in **USD**.',
            },
          },
        }),
      };

      if (shouldHonorWorkspaceTrial && workspaceTrialEnd) {
        const maxTrialEnd = new Date(
          Date.now() + WORKSPACE_TRIAL_DAYS * 24 * 60 * 60 * 1000
        );
        const effectiveTrialEnd = new Date(
          Math.min(workspaceTrialEnd.getTime(), maxTrialEnd.getTime())
        );
        if (effectiveTrialEnd.getTime() > Date.now()) {
          sessionParams.subscription_data = {
            trial_end: Math.floor(effectiveTrialEnd.getTime() / 1000),
          };
        }
      }

      if (discounts?.length) {
        sessionParams.discounts = discounts;
      } else {
        sessionParams.allow_promotion_codes = true;
      }

      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (error) {
      if (isStripeCrossModeError(error)) {
        return NextResponse.json(
          { error: getStripeCrossModeMessage() },
          { status: 409 }
        );
      }

      if (isStripeNoSuchCustomerError(error)) {
        return NextResponse.json(
          {
            error:
              'Stored Stripe customer ID is missing for the active Stripe mode. Verify STRIPE_MODE/keys or create a new subscription in this mode.',
          },
          { status: 409 }
        );
      }

      throw error;
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
