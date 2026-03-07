import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
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

async function resolveCheckoutDiscount(
  referralCode: string | null
): Promise<Stripe.Checkout.SessionCreateParams.Discount[] | undefined> {
  if (!referralCode) return undefined;

  try {
    const promoResults = await stripe.promotionCodes.list({
      code: referralCode,
      active: true,
      limit: 1,
    });
    const promotionCodeId = promoResults.data[0]?.id;
    if (promotionCodeId) {
      return [{ promotion_code: promotionCodeId }];
    }
  } catch (error) {
    console.warn('[Stripe] Failed to resolve promotion code from referral:', error);
  }

  try {
    const coupon = await stripe.coupons.retrieve(referralCode);
    if (!('deleted' in coupon) && coupon.valid) {
      return [{ coupon: coupon.id }];
    }
  } catch {
    // Ignore invalid coupon IDs: referral codes may map to promotion codes only.
  }

  return undefined;
}

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
    if (ownerMembership?.workspace_id) {
      const { data: workspace } = await admin
        .from('workspaces')
        .select('max_seats, referral_code_used')
        .eq('id', ownerMembership.workspace_id)
        .maybeSingle();
      workspaceSeats = Math.max(1, workspace?.max_seats ?? 1);
      workspaceReferralCode =
        typeof workspace?.referral_code_used === 'string' &&
        workspace.referral_code_used.trim().length > 0
          ? workspace.referral_code_used.trim()
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
    const discounts = await resolveCheckoutDiscount(workspaceReferralCode);
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
