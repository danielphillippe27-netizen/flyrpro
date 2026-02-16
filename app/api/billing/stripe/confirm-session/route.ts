import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import Stripe from 'stripe';
import {
  resolveUserIdFromSession,
  applyStripeSubscriptionUpdate,
} from '@/app/lib/billing/stripe-subscription-sync';
import { planFromStripePriceId } from '@/app/lib/billing/stripe-products';

/**
 * POST /api/billing/stripe/confirm-session
 * Called from the billing success page with the Stripe Checkout session_id.
 * Verifies the session, syncs entitlement (so Pro shows even if webhook hasn't run yet), returns plan.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.session_id as string | undefined;
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'session_id required' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (session.payment_status !== 'paid') {
      return NextResponse.json(
        { error: 'Session not paid' },
        { status: 400 }
      );
    }

    const subId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as Stripe.Subscription)?.id;
    if (!subId) {
      return NextResponse.json(
        { error: 'No subscription on session' },
        { status: 400 }
      );
    }

    const subscription =
      typeof session.subscription === 'object' && session.subscription
        ? (session.subscription as Stripe.Subscription)
        : await stripe.subscriptions.retrieve(subId);

    const admin = createAdminClient();
    let userId: string | null =
      (session.metadata?.user_id as string) ?? null;
    if (!userId) {
      userId = await resolveUserIdFromSession(admin, session);
    }
    if (!userId || userId !== user.id) {
      return NextResponse.json(
        { error: 'Session does not belong to this user' },
        { status: 403 }
      );
    }

    await applyStripeSubscriptionUpdate(admin, userId, subscription);

    const priceId = subscription.items?.data?.[0]?.price?.id ?? '';
    const plan = planFromStripePriceId(priceId);

    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    console.error('Confirm session failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Confirmation failed' },
      { status: 500 }
    );
  }
}
