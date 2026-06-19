import { equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { SalespersonPayoutResult } from '../app/lib/billing/salesperson-payouts';

dotenv.config({ path: '.env.local', override: true });

if (process.argv.includes('--help')) {
  console.log('Usage: npm run test:salesperson-payout');
  console.log('');
  console.log('Runs a Stripe test-mode salesperson payout smoke test.');
  console.log('Required env: STRIPE_MODE=test, STRIPE_SECRET_KEY_TEST, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  console.log('Optional env: SMOKE_PAYOUT_CURRENCY=USD, STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_..., SMOKE_KEEP_TEST_DATA=1.');
  process.exit(0);
}

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

type AdminClient = ReturnType<typeof createClient>;

type SmokeEntities = {
  userIds: string[];
  workspaceIds: string[];
  salespersonIds: string[];
  referralIds: string[];
  commissionIds: string[];
  payoutBatchIds: string[];
  createdConnectAccountId: string | null;
};

function requireEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required. Check .env.local.`);
  }
}

function assertStripeTestMode() {
  if (process.env.STRIPE_MODE !== 'test') {
    throw new Error('STRIPE_MODE must be "test" before running salesperson payout smoke tests.');
  }
  if (!stripeSecretKey.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY_TEST must be a sk_test_ key.');
  }
}

async function createDisposableConnectAccount(stripe: Stripe, runId: string): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'custom',
    country: 'US',
    email: `connect-salesperson-${runId.toLowerCase()}@example.com`,
    business_type: 'individual',
    business_profile: {
      mcc: '5734',
      product_description: 'FLYR salesperson payout smoke test',
      url: 'https://example.com',
    },
    capabilities: {
      transfers: { requested: true },
    },
    external_account: 'btok_us_verified',
    individual: {
      first_name: 'Salesperson',
      last_name: 'Smoke',
      email: `connect-salesperson-${runId.toLowerCase()}@example.com`,
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
      source: 'flyr_salesperson_payout_smoke',
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
  await stripe.paymentIntents.create({
    amount: 2500,
    currency: currency.toLowerCase(),
    payment_method: 'pm_card_bypassPending',
    confirm: true,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: 'never',
    },
    description: 'FLYR salesperson payout smoke available balance seed',
  });
}

async function createSmokeUser(
  admin: AdminClient,
  runId: string,
  purpose: string
): Promise<string> {
  const email = `flyr-salesperson-${purpose}-${runId.toLowerCase()}@example.com`;
  const password = `Salesperson-${runId}-${purpose}-12345!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: 'Salesperson',
      last_name: purpose,
    },
  });

  if (error || !data.user?.id) {
    throw new Error(`Failed to create ${purpose} smoke user: ${error?.message ?? 'missing user id'}`);
  }

  return data.user.id;
}

async function createSmokeWorkspace(
  admin: AdminClient,
  params: {
    runId: string;
    purpose: string;
    userId: string;
    referralCode: string;
  }
): Promise<string> {
  const { data, error } = await admin
    .from('workspaces')
    .insert({
      name: `Salesperson ${params.purpose} Smoke Workspace ${params.runId}`,
      owner_id: params.userId,
      industry: 'Real Estate',
      subscription_status: 'active',
      max_seats: 1,
      onboarding_completed_at: new Date().toISOString(),
      referral_code_used: params.referralCode,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create ${params.purpose} smoke workspace: ${error?.message ?? 'missing workspace id'}`);
  }

  const { error: membershipError } = await admin.from('workspace_members').insert({
    workspace_id: data.id,
    user_id: params.userId,
    role: 'owner',
  });

  if (membershipError) {
    throw new Error(`Failed to create ${params.purpose} smoke workspace membership: ${membershipError.message}`);
  }

  return data.id;
}

async function createSmokeSalesperson(
  admin: AdminClient,
  params: {
    runId: string;
    purpose: string;
    founderUserId: string;
    referralCode: string;
    connectAccountId?: string | null;
  }
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('salespeople')
    .insert({
      full_name: `Salesperson ${params.purpose} Smoke`,
      email: `salesperson-${params.purpose}-${params.runId.toLowerCase()}@example.com`,
      role: 'Closer',
      territory: 'Smoke Test',
      founder_user_id: params.founderUserId,
      referral_code: params.referralCode,
      commission_rate_bps: 2500,
      commission_duration_months: 12,
      status: 'active',
      notes: 'Automated salesperson payout smoke test.',
      approved_at: now,
      stripe_connect_account_id: params.connectAccountId ?? null,
      stripe_onboarding_completed: Boolean(params.connectAccountId),
      stripe_details_submitted: Boolean(params.connectAccountId),
      stripe_charges_enabled: Boolean(params.connectAccountId),
      stripe_payouts_enabled: Boolean(params.connectAccountId),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create ${params.purpose} smoke salesperson: ${error?.message ?? 'missing salesperson id'}`);
  }

  return data.id;
}

async function createSmokeReferralAndCommission(
  admin: AdminClient,
  params: {
    runId: string;
    purpose: string;
    salespersonId: string;
    userId: string;
    workspaceId: string;
    referralCode: string;
    currency: string;
  }
): Promise<{ referralId: string; commissionId: string }> {
  const now = new Date().toISOString();
  const { data: referral, error: referralError } = await admin
    .from('salesperson_referrals')
    .insert({
      salesperson_id: params.salespersonId,
      referred_user_id: params.userId,
      referred_workspace_id: params.workspaceId,
      referral_code: params.referralCode,
      stripe_customer_id: `cus_salesperson_smoke_${params.purpose}_${params.runId}`,
      stripe_subscription_id: `sub_salesperson_smoke_${params.purpose}_${params.runId}`,
      stripe_subscription_status: 'active',
      commission_rate_bps: 2500,
      commission_duration_months: 12,
      first_paid_at: now,
      eligible_until: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      last_paid_at: now,
      status: 'active',
    })
    .select('id')
    .single();

  if (referralError || !referral?.id) {
    throw new Error(`Failed to create ${params.purpose} smoke referral: ${referralError?.message ?? 'missing referral id'}`);
  }

  const { data: commission, error: commissionError } = await admin
    .from('salesperson_commissions')
    .insert({
      salesperson_referral_id: referral.id,
      salesperson_id: params.salespersonId,
      referred_user_id: params.userId,
      referred_workspace_id: params.workspaceId,
      stripe_customer_id: `cus_salesperson_smoke_${params.purpose}_${params.runId}`,
      stripe_subscription_id: `sub_salesperson_smoke_${params.purpose}_${params.runId}`,
      stripe_invoice_id: `in_salesperson_smoke_${params.purpose}_${params.runId}`,
      revenue_amount_cents: 400,
      commission_rate_bps: 2500,
      commission_amount_cents: 100,
      currency: params.currency,
      earned_at: now,
      status: 'pending',
    })
    .select('id')
    .single();

  if (commissionError || !commission?.id) {
    throw new Error(`Failed to create ${params.purpose} smoke commission: ${commissionError?.message ?? 'missing commission id'}`);
  }

  return { referralId: referral.id, commissionId: commission.id };
}

async function cleanupSmokeData(
  admin: AdminClient,
  stripe: Stripe,
  entities: SmokeEntities
): Promise<void> {
  const unique = <T>(values: T[]) => Array.from(new Set(values.filter(Boolean)));
  const salespersonIds = unique(entities.salespersonIds);
  const workspaceIds = unique(entities.workspaceIds);
  const userIds = unique(entities.userIds);
  const batchIds = unique(entities.payoutBatchIds);

  if (salespersonIds.length) {
    const { data: batches } = await admin
      .from('salesperson_payout_batches')
      .select('id')
      .in('salesperson_id', salespersonIds);
    batchIds.push(...((batches ?? []) as Array<{ id: string }>).map((batch) => batch.id));
  }

  const allBatchIds = unique(batchIds);
  if (allBatchIds.length) {
    await admin.from('salesperson_payout_batch_items').delete().in('payout_batch_id', allBatchIds);
    await admin.from('salesperson_payout_batches').delete().in('id', allBatchIds);
  }
  if (entities.commissionIds.length) {
    await admin.from('salesperson_commissions').delete().in('id', unique(entities.commissionIds));
  }
  if (entities.referralIds.length) {
    await admin.from('salesperson_referrals').delete().in('id', unique(entities.referralIds));
  }
  if (salespersonIds.length) {
    await admin.from('salespeople').delete().in('id', salespersonIds);
  }
  if (workspaceIds.length) {
    await admin.from('workspace_members').delete().in('workspace_id', workspaceIds);
    await admin.from('workspaces').delete().in('id', workspaceIds);
  }
  for (const userId of userIds) {
    await admin.from('user_profiles').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
  }
  if (entities.createdConnectAccountId) {
    await stripe.accounts.del(entities.createdConnectAccountId).catch(() => undefined);
  }
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
  const { paySalespersonCommissions } = await import(
    '../app/lib/billing/salesperson-payouts'
  );

  const runId = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const entities: SmokeEntities = {
    userIds: [],
    workspaceIds: [],
    salespersonIds: [],
    referralIds: [],
    commissionIds: [],
    payoutBatchIds: [],
    createdConnectAccountId: null,
  };

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

    const connectAccountId =
      providedConnectAccountId || (await createDisposableConnectAccount(stripe, runId));
    if (!providedConnectAccountId) {
      entities.createdConnectAccountId = connectAccountId;
    }

    const happyUserId = await createSmokeUser(admin, runId, 'happy');
    entities.userIds.push(happyUserId);
    const happyReferralCode = `SP${runId}`;
    const happyWorkspaceId = await createSmokeWorkspace(admin, {
      runId,
      purpose: 'happy',
      userId: happyUserId,
      referralCode: happyReferralCode,
    });
    entities.workspaceIds.push(happyWorkspaceId);
    const happySalespersonId = await createSmokeSalesperson(admin, {
      runId,
      purpose: 'happy',
      founderUserId: happyUserId,
      referralCode: happyReferralCode,
      connectAccountId,
    });
    entities.salespersonIds.push(happySalespersonId);
    const happyLedger = await createSmokeReferralAndCommission(admin, {
      runId,
      purpose: 'happy',
      salespersonId: happySalespersonId,
      userId: happyUserId,
      workspaceId: happyWorkspaceId,
      referralCode: happyReferralCode,
      currency: payoutCurrency,
    });
    entities.referralIds.push(happyLedger.referralId);
    entities.commissionIds.push(happyLedger.commissionId);

    const result = await paySalespersonCommissions({
      admin,
      founderUserId: happyUserId,
      salespersonId: happySalespersonId,
      currency: payoutCurrency,
      note: `Smoke test ${runId}`,
      stripeConfigured: true,
    });

    if (!result.ok) {
      const failure = result as Extract<SalespersonPayoutResult, { ok: false }>;
      throw new Error(`Salesperson payout smoke transfer failed (${failure.code}): ${failure.error}`);
    }
    entities.payoutBatchIds.push(result.batchId);

    const { data: paidCommission, error: paidCommissionError } = await admin
      .from('salesperson_commissions')
      .select('status, paid_out_at, payout_batch_id, stripe_transfer_id')
      .eq('id', happyLedger.commissionId)
      .single();
    if (paidCommissionError) {
      throw new Error(`Could not verify paid salesperson commission: ${paidCommissionError.message}`);
    }

    equal(paidCommission.status, 'paid');
    equal(paidCommission.payout_batch_id, result.batchId);
    ok(paidCommission.paid_out_at, 'paid_out_at was not set.');
    ok(paidCommission.stripe_transfer_id, 'stripe_transfer_id was not set.');

    const transfer = await stripe.transfers.retrieve(paidCommission.stripe_transfer_id);
    equal(transfer.destination, connectAccountId);
    equal(transfer.amount, 100);
    equal(transfer.currency, payoutCurrency.toLowerCase());

    const secondResult = await paySalespersonCommissions({
      admin,
      founderUserId: happyUserId,
      salespersonId: happySalespersonId,
      currency: payoutCurrency,
      note: `Smoke test rerun ${runId}`,
      stripeConfigured: true,
    });
    if (secondResult.ok) {
      throw new Error('Second payout run unexpectedly created another payout.');
    }
    equal(secondResult.code, 'no_pending_commissions');

    const { data: batchesAfterRerun, error: batchesAfterRerunError } = await admin
      .from('salesperson_payout_batches')
      .select('id, stripe_transfer_id')
      .eq('salesperson_id', happySalespersonId);
    if (batchesAfterRerunError) {
      throw new Error(`Could not verify payout idempotency: ${batchesAfterRerunError.message}`);
    }
    equal((batchesAfterRerun ?? []).length, 1);
    equal(batchesAfterRerun?.[0]?.stripe_transfer_id, paidCommission.stripe_transfer_id);

    const missingUserId = await createSmokeUser(admin, runId, 'missing');
    entities.userIds.push(missingUserId);
    const missingReferralCode = `SPMISS${runId.slice(0, 6)}`;
    const missingWorkspaceId = await createSmokeWorkspace(admin, {
      runId,
      purpose: 'missing',
      userId: missingUserId,
      referralCode: missingReferralCode,
    });
    entities.workspaceIds.push(missingWorkspaceId);
    const missingSalespersonId = await createSmokeSalesperson(admin, {
      runId,
      purpose: 'missing',
      founderUserId: missingUserId,
      referralCode: missingReferralCode,
      connectAccountId: null,
    });
    entities.salespersonIds.push(missingSalespersonId);
    const missingLedger = await createSmokeReferralAndCommission(admin, {
      runId,
      purpose: 'missing',
      salespersonId: missingSalespersonId,
      userId: missingUserId,
      workspaceId: missingWorkspaceId,
      referralCode: missingReferralCode,
      currency: payoutCurrency,
    });
    entities.referralIds.push(missingLedger.referralId);
    entities.commissionIds.push(missingLedger.commissionId);

    const missingResult = await paySalespersonCommissions({
      admin,
      founderUserId: missingUserId,
      salespersonId: missingSalespersonId,
      currency: payoutCurrency,
      note: `Smoke missing payout setup ${runId}`,
      stripeConfigured: true,
    });
    if (missingResult.ok) {
      throw new Error('Missing payout setup test unexpectedly paid commissions.');
    }
    equal(missingResult.code, 'not_ready');

    const { data: pendingCommission, error: pendingCommissionError } = await admin
      .from('salesperson_commissions')
      .select('status, paid_out_at, payout_batch_id, stripe_transfer_id')
      .eq('id', missingLedger.commissionId)
      .single();
    if (pendingCommissionError) {
      throw new Error(`Could not verify pending salesperson commission: ${pendingCommissionError.message}`);
    }

    equal(pendingCommission.status, 'pending');
    equal(pendingCommission.paid_out_at, null);
    equal(pendingCommission.payout_batch_id, null);
    equal(pendingCommission.stripe_transfer_id, null);

    console.log('Salesperson payout smoke test passed');
    console.log(`Transfer id: ${paidCommission.stripe_transfer_id}`);
    console.log(`Batch id: ${result.batchId}`);
    console.log(`Connect account: ${connectAccountId}`);
    console.log(`Run id: ${runId}`);
  } finally {
    if (!keepTestData) {
      await cleanupSmokeData(admin, stripe, entities);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
