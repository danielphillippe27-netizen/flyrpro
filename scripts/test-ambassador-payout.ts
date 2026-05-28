import { equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { AmbassadorPayoutResult } from '../app/lib/billing/ambassador-payouts';

dotenv.config({ path: '.env.local', override: true });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const stripeSecretKey =
  process.env.STRIPE_SECRET_KEY_TEST ||
  (process.env.STRIPE_MODE === 'test' ? process.env.STRIPE_SECRET_KEY : '') ||
  '';
const keepTestData = process.env.SMOKE_KEEP_TEST_DATA === '1';
const providedConnectAccountId = process.env.STRIPE_TEST_CONNECT_ACCOUNT_ID || '';
const payoutCurrency = (process.env.SMOKE_PAYOUT_CURRENCY || 'USD').trim().toUpperCase();
const minimumPayoutAmountCents = 100;

function requireEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required. Check .env.local.`);
  }
}

function assertStripeTestMode() {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error('STRIPE_MODE must be "test" before running payout smoke tests.');
  }
  if (!stripeSecretKey.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY_TEST must be a sk_test_ key.');
  }
}

async function createDisposableConnectAccount(stripe: Stripe, runId: string): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'custom',
    country: 'US',
    email: `connect-${runId.toLowerCase()}@example.com`,
    business_type: 'individual',
    business_profile: {
      mcc: '5734',
      product_description: 'FLYR ambassador payout smoke test',
      url: 'https://example.com',
    },
    capabilities: {
      transfers: { requested: true },
    },
    external_account: 'btok_us_verified',
    individual: {
      first_name: 'Payout',
      last_name: 'Smoke',
      email: `connect-${runId.toLowerCase()}@example.com`,
      phone: '0000000000',
      dob: { day: 1, month: 1, year: 1990 },
      ssn_last_4: '0000',
      address: {
        line1: 'address_full_match',
        city: 'San Francisco',
        state: 'CA',
        postal_code: '94103',
        country: 'US',
      },
    },
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: '127.0.0.1',
    },
    metadata: {
      source: 'flyr_ambassador_payout_smoke',
      run_id: runId,
    },
  });

  return account.id;
}

async function loadAvailableBalance(stripe: Stripe, currency: string): Promise<{
  available: number;
  pending: number;
  availableOn: string | null;
}> {
  const currencyLower = currency.toLowerCase();
  const balance = await stripe.balance.retrieve();
  const available =
    balance.available.find((entry) => entry.currency === currencyLower)?.amount ?? 0;
  const pending =
    balance.pending.find((entry) => entry.currency === currencyLower)?.amount ?? 0;
  const nextPendingTransaction =
    pending > 0
      ? (
          await stripe.balanceTransactions.list({
            limit: 10,
          })
        ).data.find(
          (transaction) =>
            transaction.currency === currencyLower &&
            transaction.status === 'pending' &&
            transaction.net > 0
        )
      : null;

  return {
    available,
    pending,
    availableOn: nextPendingTransaction?.available_on
      ? new Date(nextPendingTransaction.available_on * 1000).toISOString().slice(0, 10)
      : null,
  };
}

async function seedAvailableBalance(stripe: Stripe, currency: string): Promise<void> {
  if (currency !== 'CAD') return;

  await stripe.paymentIntents.create({
    amount: 2500,
    currency: 'usd',
    payment_method: 'pm_card_bypassPending',
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    description: 'FLYR payout smoke available balance seed',
  });
}

async function main() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey);
  assertStripeTestMode();

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2025-10-29.clover',
    typescript: true,
  });
  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { payAmbassadorCommissions } = await import(
    '../app/lib/billing/ambassador-payouts'
  );

  const runId = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const email = `flyr-payout-smoke-${runId.toLowerCase()}@example.com`;
  const password = `Payout-${runId}-12345!`;
  let createdConnectAccountId: string | null = null;
  let connectAccountId: string | null = null;
  let userId: string | null = null;
  let workspaceId: string | null = null;
  let ambassadorApplicationId: string | null = null;
  let referralId: string | null = null;
  let commissionId: string | null = null;
  let payoutBatchId: string | null = null;

  try {
    if (payoutCurrency !== 'USD' && !providedConnectAccountId) {
      throw new Error(
        `SMOKE_PAYOUT_CURRENCY=${payoutCurrency} requires STRIPE_TEST_CONNECT_ACCOUNT_ID for a test connected account that can receive ${payoutCurrency}.`
      );
    }

    let balanceState = await loadAvailableBalance(stripe, payoutCurrency);
    if (balanceState.available < minimumPayoutAmountCents) {
      await seedAvailableBalance(stripe, payoutCurrency);
      balanceState = await loadAvailableBalance(stripe, payoutCurrency);
    }

    if (balanceState.available < minimumPayoutAmountCents) {
      throw new Error(
        `Stripe test available balance is below ${minimumPayoutAmountCents} ${payoutCurrency}. Available=${balanceState.available}, pending=${balanceState.pending}${
          balanceState.availableOn ? `, next pending available on ${balanceState.availableOn}` : ''
        }. Run checkout/payment tests first or wait until pending test funds become available.`
      );
    }

    connectAccountId =
      providedConnectAccountId || (await createDisposableConnectAccount(stripe, runId));
    if (!providedConnectAccountId) {
      createdConnectAccountId = connectAccountId;
    }

    const { data: createdUser, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: 'Payout',
        last_name: 'Smoke',
      },
    });
    if (userError || !createdUser.user?.id) {
      throw new Error(`Failed to create payout smoke user: ${userError?.message ?? 'missing user id'}`);
    }
    userId = createdUser.user.id;

    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .insert({
        name: `Payout Smoke Workspace ${runId}`,
        owner_id: userId,
        industry: 'Real Estate',
        subscription_status: 'active',
        max_seats: 1,
        onboarding_completed_at: new Date().toISOString(),
        referral_code_used: `PAY${runId}`,
      })
      .select('id')
      .single();
    if (workspaceError || !workspace?.id) {
      throw new Error(`Failed to create payout smoke workspace: ${workspaceError?.message ?? 'missing workspace id'}`);
    }
    workspaceId = workspace.id;

    await admin.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'owner',
    });

    const { data: ambassador, error: ambassadorError } = await admin
      .from('ambassador_applications')
      .insert({
        full_name: 'Payout Smoke Ambassador',
        email: `payout-ambassador-${runId.toLowerCase()}@example.com`,
        primary_niche: 'Real Estate',
        primary_platform: 'Test',
        why_flyr: 'Automated payout smoke test ambassador.',
        status: 'approved',
        approved_at: new Date().toISOString(),
        referral_code: `PAY${runId}`,
        commission_rate_bps: 2500,
        commission_duration_months: 12,
        stripe_connect_account_id: connectAccountId,
        stripe_onboarding_completed: true,
        stripe_details_submitted: true,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
      })
      .select('id')
      .single();
    if (ambassadorError || !ambassador?.id) {
      throw new Error(`Failed to create payout smoke ambassador: ${ambassadorError?.message ?? 'missing ambassador id'}`);
    }
    ambassadorApplicationId = ambassador.id;

    const { data: referral, error: referralError } = await admin
      .from('ambassador_referrals')
      .insert({
        ambassador_application_id: ambassadorApplicationId,
        referred_user_id: userId,
        referred_workspace_id: workspaceId,
        referral_code: `PAY${runId}`,
        stripe_customer_id: `cus_smoke_${runId}`,
        stripe_subscription_id: `sub_smoke_${runId}`,
        stripe_subscription_status: 'active',
        commission_rate_bps: 2500,
        commission_duration_months: 12,
        first_paid_at: new Date().toISOString(),
        eligible_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active',
      })
      .select('id')
      .single();
    if (referralError || !referral?.id) {
      throw new Error(`Failed to create payout smoke referral: ${referralError?.message ?? 'missing referral id'}`);
    }
    referralId = referral.id;

    const { data: commission, error: commissionError } = await admin
      .from('ambassador_commissions')
      .insert({
        ambassador_referral_id: referralId,
        ambassador_application_id: ambassadorApplicationId,
        referred_user_id: userId,
        referred_workspace_id: workspaceId,
        stripe_customer_id: `cus_smoke_${runId}`,
        stripe_subscription_id: `sub_smoke_${runId}`,
        stripe_invoice_id: `in_smoke_${runId}`,
        revenue_amount_cents: 400,
        commission_rate_bps: 2500,
        commission_amount_cents: 100,
        currency: payoutCurrency,
        earned_at: new Date().toISOString(),
        status: 'pending',
      })
      .select('id')
      .single();
    if (commissionError || !commission?.id) {
      throw new Error(`Failed to create payout smoke commission: ${commissionError?.message ?? 'missing commission id'}`);
    }
    commissionId = commission.id;

    const result = await payAmbassadorCommissions({
      admin,
      founderUserId: userId,
      ambassadorApplicationId,
      currency: payoutCurrency,
      note: `Smoke test ${runId}`,
      stripeConfigured: true,
    });

    if (!result.ok) {
      const failure = result as Extract<AmbassadorPayoutResult, { ok: false }>;
      throw new Error(`Payout smoke transfer failed (${failure.code}): ${failure.error}`);
    }
    payoutBatchId = result.batchId;

    const { data: paidCommission, error: paidCommissionError } = await admin
      .from('ambassador_commissions')
      .select('status, paid_out_at, payout_batch_id, stripe_transfer_id')
      .eq('id', commissionId)
      .single();
    if (paidCommissionError) {
      throw new Error(`Could not verify paid commission: ${paidCommissionError.message}`);
    }

    equal(paidCommission.status, 'paid');
    equal(paidCommission.payout_batch_id, payoutBatchId);
    ok(paidCommission.paid_out_at, 'paid_out_at was not set.');
    ok(paidCommission.stripe_transfer_id, 'stripe_transfer_id was not set.');

    console.log('Ambassador payout smoke test passed');
    console.log(`Transfer id: ${paidCommission.stripe_transfer_id}`);
    console.log(`Batch id: ${payoutBatchId}`);
    console.log(`Connect account: ${connectAccountId}`);
  } finally {
    if (!keepTestData) {
      if (payoutBatchId) {
        await admin.from('ambassador_payout_batch_items').delete().eq('payout_batch_id', payoutBatchId);
        await admin.from('ambassador_payout_batches').delete().eq('id', payoutBatchId);
      }
      if (commissionId) {
        await admin.from('ambassador_commissions').delete().eq('id', commissionId);
      }
      if (referralId) {
        await admin.from('ambassador_referrals').delete().eq('id', referralId);
      }
      if (ambassadorApplicationId) {
        await admin.from('ambassador_applications').delete().eq('id', ambassadorApplicationId);
      }
      if (workspaceId) {
        await admin.from('workspace_members').delete().eq('workspace_id', workspaceId);
        await admin.from('workspaces').delete().eq('id', workspaceId);
      }
      if (userId) {
        await admin.from('user_profiles').delete().eq('user_id', userId);
        await admin.from('profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
      }
      if (createdConnectAccountId) {
        await stripe.accounts.del(createdConnectAccountId).catch(() => undefined);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
