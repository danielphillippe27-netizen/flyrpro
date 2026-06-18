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
import { recordAmbassadorCommissionForInvoice } from '@/app/lib/billing/ambassador-program';
import {
  isMissingSalespeopleSchemaError,
  recordSalespersonCommissionForInvoice,
} from '@/app/lib/billing/salespeople';
import { markWorkspacePowerDialerAddonInactiveForUser } from '@/app/lib/billing/workspace-addons';

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
  await markWorkspacePowerDialerAddonInactiveForUser(supabase, row.user_id);

  await supabase
    .from('ambassador_referrals')
    .update({
      stripe_subscription_status: 'canceled',
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);
}

async function syncAmbassadorStripeAccount(
  supabase: ReturnType<typeof createAdminClient>,
  account: Stripe.Account
): Promise<void> {
  const { error } = await supabase
    .from('ambassador_applications')
    .update({
      stripe_onboarding_completed: account.details_submitted ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_connect_account_id', account.id);

  if (error) {
    console.warn('[stripe webhook] failed syncing ambassador connect account', error);
  }
}

async function syncSalespersonStripeAccount(
  supabase: ReturnType<typeof createAdminClient>,
  account: Stripe.Account
): Promise<void> {
  const { error } = await supabase
    .from('salespeople')
    .update({
      stripe_onboarding_completed: account.details_submitted ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_connect_account_id', account.id);

  if (error && !isMissingSalespeopleSchemaError(error.message)) {
    console.warn('[stripe webhook] failed syncing salesperson connect account', error);
  }
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
  } catch {
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

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        await Promise.all([
          syncAmbassadorStripeAccount(supabase, account),
          syncSalespersonStripeAccount(supabase, account),
        ]);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.parent?.subscription_details?.subscription === 'string'
            ? invoice.parent.subscription_details.subscription
            : invoice.parent?.subscription_details?.subscription?.id;
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
              await recordSalespersonCommissionForInvoice(
                supabase,
                row.user_id,
                subscription,
                invoice
              );
              await recordAmbassadorCommissionForInvoice(
                supabase,
                row.user_id,
                subscription,
                invoice
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
