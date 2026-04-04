import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import { applyStripeSubscriptionUpdate } from '@/app/lib/billing/stripe-subscription-sync';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import {
  getStripeCrossModeMessage,
  isStripeCrossModeError,
  isStripeNoSuchCustomerError,
} from '@/app/lib/billing/stripe-errors';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

/**
 * POST /api/billing/stripe/seats
 * Body: { seats: number }
 * Updates the current Stripe subscription quantity for paid seats.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isStripeSecretKeyConfigured()) {
      return NextResponse.json(
        { error: 'Stripe secret key is not configured for the current mode.' },
        { status: 500 }
      );
    }

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsedSeats =
      typeof body?.seats === 'number' && Number.isFinite(body.seats)
        ? Math.trunc(body.seats)
        : NaN;
    const seats = Number.isFinite(parsedSeats) && parsedSeats > 0
      ? Math.min(100, parsedSeats)
      : NaN;

    if (!Number.isFinite(seats)) {
      return NextResponse.json(
        { error: 'A valid paid seat count is required.' },
        { status: 400 }
      );
    }

    const entitlement = await getEntitlementForUser(requestUser.id);
    if (entitlement.source !== 'stripe' || !entitlement.is_active) {
      return NextResponse.json(
        { error: 'Only active Stripe subscriptions can be updated here.' },
        { status: 409 }
      );
    }

    if (!entitlement.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No Stripe subscription was found for this account.' },
        { status: 409 }
      );
    }

    let updatedSubscription;
    try {
      const subscription = await stripe.subscriptions.retrieve(
        entitlement.stripe_subscription_id
      );
      const subscriptionItemId = subscription.items?.data?.[0]?.id;

      if (!subscriptionItemId) {
        return NextResponse.json(
          { error: 'Could not find a Stripe subscription item to update.' },
          { status: 409 }
        );
      }

      updatedSubscription = await stripe.subscriptions.update(subscription.id, {
        items: [
          {
            id: subscriptionItemId,
            quantity: seats,
          },
        ],
        proration_behavior: 'create_prorations',
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
              'Stored Stripe subscription data is missing for the active Stripe mode. Verify STRIPE_MODE/keys or create a new subscription in this mode.',
          },
          { status: 409 }
        );
      }

      throw error;
    }

    const admin = createAdminClient();
    await applyStripeSubscriptionUpdate(admin, requestUser.id, updatedSubscription);

    return NextResponse.json({
      success: true,
      maxSeats: seats,
    });
  } catch (error) {
    console.error('Error updating Stripe seats:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update seats' },
      { status: 500 }
    );
  }
}
