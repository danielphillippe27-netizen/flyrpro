import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import Stripe from 'stripe';
import {
  getEntitlementForUser,
  mergeEntitlementUpdate,
} from '@/app/lib/billing/entitlements';
import type { Entitlement } from '@/types/database';
import { planFromStripePriceId } from '@/app/lib/billing/stripe-products';

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.warn('STRIPE_WEBHOOK_SECRET is not set; webhook will reject');
}

async function resolveUserId(
  supabase: ReturnType<typeof createAdminClient>,
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

async function applyStripeSubscriptionUpdate(
  supabase: ReturnType<typeof createAdminClient>,
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

  if (Object.keys(update).length === 0) return;

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
          session.metadata?.user_id ?? (await resolveUserId(supabase, session));
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
