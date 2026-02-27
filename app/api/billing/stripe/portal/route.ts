import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import { getAppUrl } from '@/app/lib/billing/stripe-products';
import {
  getStripeCrossModeMessage,
  isStripeCrossModeError,
  isStripeNoSuchCustomerError,
} from '@/app/lib/billing/stripe-errors';

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getEntitlementForUser(user.id);
    const customerId = entitlement.stripe_customer_id;

    if (!customerId) {
      return NextResponse.json(
        { error: 'No subscription to manage. Subscribe first.' },
        { status: 400 }
      );
    }

    const appUrl = getAppUrl(request);
    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${appUrl}/billing`,
      });
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
              'Stored Stripe customer ID is missing for the active Stripe mode. Verify STRIPE_MODE/keys or sign in to the mode that owns this subscription.',
          },
          { status: 409 }
        );
      }

      throw error;
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Portal failed' },
      { status: 500 }
    );
  }
}
