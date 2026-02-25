import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import Stripe from 'stripe';
import {
  resolveUserIdFromSession,
  applyStripeSubscriptionUpdate,
  updateWorkspaceSubscriptionForUser,
} from '@/app/lib/billing/stripe-subscription-sync';
import { getStripeWebhookSecret } from '@/app/lib/billing/stripe-env';

const secret = getStripeWebhookSecret();
if (!secret) {
  console.warn('Stripe webhook secret is not set for current mode; webhook will reject');
}

async function setStripeInactive(
  supabase: ReturnType<typeof createAdminClient>,
  customerId: string
): Promise<void> {
  const { data: row } = await supabase
    .from('entitlements')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .single();
  if (!row) return;
  await supabase
    .from('entitlements')
    .update({
      is_active: false,
      plan: 'free',
      source: 'stripe',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', row.user_id);

  await updateWorkspaceSubscriptionForUser(supabase, row.user_id, {
    status: 'inactive',
    trialEndsAt: null,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature || !secret) {
    return NextResponse.json(
      { error: 'Missing signature or webhook secret' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error('Webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          session.metadata?.user_id ?? (await resolveUserIdFromSession(supabase, session));
        if (!userId) {
          console.warn('checkout.session.completed: could not resolve user_id');
          break;
        }
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          await applyStripeSubscriptionUpdate(supabase, userId, subscription);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;
        if (!customerId) break;
        const { data: row } = await supabase
          .from('entitlements')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (row) {
          await applyStripeSubscriptionUpdate(
            supabase,
            row.user_id,
            subscription
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;
        if (customerId) {
          await setStripeInactive(supabase, customerId);
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          const customerId =
            typeof subscription.customer === 'string'
              ? subscription.customer
              : subscription.customer?.id;
          if (customerId) {
            const { data: row } = await supabase
              .from('entitlements')
              .select('user_id')
              .eq('stripe_customer_id', customerId)
              .single();
            if (row) {
              await applyStripeSubscriptionUpdate(
                supabase,
                row.user_id,
                subscription
              );
            }
          }
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
