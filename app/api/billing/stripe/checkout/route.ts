import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import {
  getAppUrl,
  getProPriceId,
  STRIPE_ALLOWED_PRICE_IDS,
} from '@/app/lib/billing/stripe-products';

export async function POST(request: NextRequest) {
  try {
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

    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: ownerMembership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let workspaceSeats = 1;
    if (ownerMembership?.workspace_id) {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('max_seats')
        .eq('id', ownerMembership.workspace_id)
        .maybeSingle();
      workspaceSeats = Math.max(1, workspace?.max_seats ?? 1);
    }

    const parsedRequestedSeats =
      typeof requestedSeatsRaw === 'number' && Number.isFinite(requestedSeatsRaw)
        ? Math.trunc(requestedSeatsRaw)
        : NaN;
    const quantity = Number.isFinite(parsedRequestedSeats) && parsedRequestedSeats > 0
      ? Math.min(100, parsedRequestedSeats)
      : Math.min(100, workspaceSeats);

    let entitlement = await getEntitlementForUser(user.id);
    let customerId = entitlement.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const admin = createAdminClient();
      await admin
        .from('entitlements')
        .upsert(
          {
            user_id: user.id,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
    }

    const appUrl = getAppUrl();
    const price = await stripe.prices.retrieve(priceId);
    const isUsd = price.currency?.toLowerCase() === 'usd';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity }],
      mode: 'subscription',
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe`,
      metadata: { user_id: user.id, seats: String(quantity) },
      ...(isUsd && {
        custom_text: {
          submit: {
            message: 'Amount charged in **USD**.',
          },
        },
      }),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
