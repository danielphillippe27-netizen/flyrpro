import { createHash } from 'node:crypto';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import type { SalespersonCommission, SalespersonPayoutBatch } from '@/types/database';

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type SalespersonPayoutCandidateRow = {
  id: string;
  full_name: string;
  email: string;
  stripe_connect_account_id: string | null;
  stripe_payouts_enabled: boolean;
};

type SalespersonCommissionRow = Pick<
  SalespersonCommission,
  'id' | 'commission_amount_cents' | 'revenue_amount_cents' | 'currency' | 'earned_at' | 'status'
>;

type SalespersonPayoutBatchRow = SalespersonPayoutBatch;

export type SalespersonPayoutResult =
  | {
      ok: true;
      alreadyPaid: boolean;
      batchId: string;
      transferId: string | null;
      transferGroup: string | null;
      currency: string;
      totalCommissionCents: number;
      commissionCount: number;
      salespersonId: string;
      salespersonName: string;
    }
  | {
      ok: false;
      error: string;
      code:
        | 'not_found'
        | 'not_ready'
        | 'no_pending_commissions'
        | 'schema_missing'
        | 'stripe_not_configured'
        | 'unknown';
    };

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function buildCommissionSnapshotHash(
  salespersonId: string,
  currency: string,
  commissions: SalespersonCommissionRow[]
): string {
  const payload = commissions
    .map((commission) => `${commission.id}:${commission.commission_amount_cents}`)
    .sort()
    .join('|');

  return createHash('sha256')
    .update(`${salespersonId}:${currency}:${payload}`)
    .digest('hex');
}

async function loadSalespersonPayoutCandidate(
  admin: SupabaseAdmin,
  salespersonId: string
): Promise<SalespersonPayoutCandidateRow | null> {
  const { data, error } = await admin
    .from('salespeople')
    .select('id, full_name, email, stripe_connect_account_id, stripe_payouts_enabled')
    .eq('id', salespersonId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonPayoutCandidateRow | null) ?? null;
}

async function loadPendingCommissions(
  admin: SupabaseAdmin,
  salespersonId: string,
  currency: string
): Promise<SalespersonCommissionRow[]> {
  const { data, error } = await admin
    .from('salesperson_commissions')
    .select('id, commission_amount_cents, revenue_amount_cents, currency, earned_at, status')
    .eq('salesperson_id', salespersonId)
    .eq('status', 'pending')
    .eq('currency', currency)
    .order('earned_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as SalespersonCommissionRow[];
}

async function findExistingBatch(
  admin: SupabaseAdmin,
  salespersonId: string,
  currency: string,
  commissionSnapshotHash: string
): Promise<SalespersonPayoutBatchRow | null> {
  const { data, error } = await admin
    .from('salesperson_payout_batches')
    .select(
      'id, salesperson_id, created_by_user_id, status, currency, total_commission_cents, note, paid_at, processed_at, stripe_connect_account_id, stripe_transfer_id, transfer_group, commission_snapshot_hash, failure_reason'
    )
    .eq('salesperson_id', salespersonId)
    .eq('currency', currency)
    .eq('commission_snapshot_hash', commissionSnapshotHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonPayoutBatchRow | null) ?? null;
}

async function createBatch(
  admin: SupabaseAdmin,
  params: {
    salespersonId: string;
    createdByUserId: string;
    currency: string;
    totalCommissionCents: number;
    note: string | null;
    stripeConnectAccountId: string;
    commissionSnapshotHash: string;
  }
): Promise<SalespersonPayoutBatchRow> {
  const { data, error } = await admin
    .from('salesperson_payout_batches')
    .insert({
      salesperson_id: params.salespersonId,
      created_by_user_id: params.createdByUserId,
      status: 'draft',
      currency: params.currency,
      total_commission_cents: params.totalCommissionCents,
      note: params.note,
      stripe_connect_account_id: params.stripeConnectAccountId,
      commission_snapshot_hash: params.commissionSnapshotHash,
    })
    .select(
      'id, salesperson_id, created_by_user_id, status, currency, total_commission_cents, note, paid_at, processed_at, stripe_connect_account_id, stripe_transfer_id, transfer_group, commission_snapshot_hash, failure_reason'
    )
    .single();

  if (error) throw new Error(error.message);
  return data as SalespersonPayoutBatchRow;
}

async function attachCommissionsToBatch(
  admin: SupabaseAdmin,
  batchId: string,
  commissions: SalespersonCommissionRow[]
): Promise<void> {
  if (!commissions.length) return;

  const { error } = await admin
    .from('salesperson_payout_batch_items')
    .upsert(
      commissions.map((commission) => ({
        payout_batch_id: batchId,
        salesperson_commission_id: commission.id,
        amount_cents: commission.commission_amount_cents,
      })),
      { onConflict: 'salesperson_commission_id' }
    );

  if (error) throw new Error(error.message);
}

async function updateBatchStatus(
  admin: SupabaseAdmin,
  batchId: string,
  values: Record<string, string | number | null>
): Promise<void> {
  const { error } = await admin
    .from('salesperson_payout_batches')
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  if (error) throw new Error(error.message);
}

async function markBatchPaid(
  admin: SupabaseAdmin,
  params: {
    batchId: string;
    commissionIds: string[];
    totalCommissionCents: number;
    transferId: string;
    transferGroup: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  const { error: commissionError } = await admin
    .from('salesperson_commissions')
    .update({
      status: 'paid',
      paid_out_at: now,
      payout_batch_id: params.batchId,
      stripe_transfer_id: params.transferId,
      updated_at: now,
    })
    .in('id', params.commissionIds);

  if (commissionError) throw new Error(commissionError.message);

  await updateBatchStatus(admin, params.batchId, {
    status: 'paid',
    total_commission_cents: params.totalCommissionCents,
    stripe_transfer_id: params.transferId,
    transfer_group: params.transferGroup,
    paid_at: now,
    processed_at: now,
    failure_reason: null,
  });
}

function asFriendlyStripeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: string }).message || '').trim();
    if (message) return message;
  }

  return 'Stripe payout failed.';
}

export async function paySalespersonCommissions(params: {
  admin: SupabaseAdmin;
  founderUserId: string;
  salespersonId: string;
  currency: string;
  note?: string | null;
  stripeConfigured: boolean;
}): Promise<SalespersonPayoutResult> {
  if (!params.stripeConfigured) {
    return {
      ok: false,
      code: 'stripe_not_configured',
      error: 'Stripe secret key is not configured for the current mode.',
    };
  }

  try {
    const salesperson = await loadSalespersonPayoutCandidate(
      params.admin,
      params.salespersonId
    );

    if (!salesperson) {
      return { ok: false, code: 'not_found', error: 'Salesperson not found.' };
    }

    if (!salesperson.stripe_connect_account_id || !salesperson.stripe_payouts_enabled) {
      return {
        ok: false,
        code: 'not_ready',
        error: 'Salesperson has not finished Stripe payout setup yet.',
      };
    }

    const currency = normalizeCurrency(params.currency);
    const commissions = await loadPendingCommissions(
      params.admin,
      params.salespersonId,
      currency
    );

    if (!commissions.length) {
      return {
        ok: false,
        code: 'no_pending_commissions',
        error: 'No pending commissions are ready to pay for this salesperson.',
      };
    }

    const totalCommissionCents = commissions.reduce(
      (sum, commission) => sum + (commission.commission_amount_cents ?? 0),
      0
    );
    const commissionSnapshotHash = buildCommissionSnapshotHash(
      params.salespersonId,
      currency,
      commissions
    );
    const note = params.note?.trim() || null;

    let batch = await findExistingBatch(
      params.admin,
      params.salespersonId,
      currency,
      commissionSnapshotHash
    );

    if (!batch) {
      batch = await createBatch(params.admin, {
        salespersonId: params.salespersonId,
        createdByUserId: params.founderUserId,
        currency,
        totalCommissionCents,
        note,
        stripeConnectAccountId: salesperson.stripe_connect_account_id,
        commissionSnapshotHash,
      });
    }

    if (batch.status === 'paid' && batch.stripe_transfer_id) {
      return {
        ok: true,
        alreadyPaid: true,
        batchId: batch.id,
        transferId: batch.stripe_transfer_id,
        transferGroup: batch.transfer_group,
        currency,
        totalCommissionCents: batch.total_commission_cents,
        commissionCount: commissions.length,
        salespersonId: params.salespersonId,
        salespersonName: salesperson.full_name,
      };
    }

    await attachCommissionsToBatch(params.admin, batch.id, commissions);

    if (batch.note !== note || batch.total_commission_cents !== totalCommissionCents) {
      await updateBatchStatus(params.admin, batch.id, {
        note,
        total_commission_cents: totalCommissionCents,
      });
    }

    const transferGroup = batch.transfer_group || `salesperson_batch_${batch.id}`;

    if (batch.stripe_transfer_id) {
      await markBatchPaid(params.admin, {
        batchId: batch.id,
        commissionIds: commissions.map((commission) => commission.id),
        totalCommissionCents,
        transferId: batch.stripe_transfer_id,
        transferGroup,
      });

      return {
        ok: true,
        alreadyPaid: false,
        batchId: batch.id,
        transferId: batch.stripe_transfer_id,
        transferGroup,
        currency,
        totalCommissionCents,
        commissionCount: commissions.length,
        salespersonId: params.salespersonId,
        salespersonName: salesperson.full_name,
      };
    }

    await updateBatchStatus(params.admin, batch.id, {
      status: 'processing',
      transfer_group: transferGroup,
      stripe_connect_account_id: salesperson.stripe_connect_account_id,
      failure_reason: null,
    });

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: totalCommissionCents,
          currency: currency.toLowerCase(),
          destination: salesperson.stripe_connect_account_id,
          transfer_group: transferGroup,
          metadata: {
            salesperson_id: params.salespersonId,
            salesperson_name: salesperson.full_name,
            salesperson_email: salesperson.email,
            payout_batch_id: batch.id,
            payout_type: 'salesperson_commissions',
          },
        },
        {
          idempotencyKey: `salesperson-payout:${batch.id}`,
        }
      );

      await updateBatchStatus(params.admin, batch.id, {
        status: 'processing',
        stripe_transfer_id: transfer.id,
        transfer_group: transferGroup,
        processed_at: new Date().toISOString(),
        failure_reason: null,
      });

      await markBatchPaid(params.admin, {
        batchId: batch.id,
        commissionIds: commissions.map((commission) => commission.id),
        totalCommissionCents,
        transferId: transfer.id,
        transferGroup,
      });

      return {
        ok: true,
        alreadyPaid: false,
        batchId: batch.id,
        transferId: transfer.id,
        transferGroup,
        currency,
        totalCommissionCents,
        commissionCount: commissions.length,
        salespersonId: params.salespersonId,
        salespersonName: salesperson.full_name,
      };
    } catch (error) {
      const friendlyMessage = asFriendlyStripeError(error);
      await updateBatchStatus(params.admin, batch.id, {
        status: 'failed',
        failure_reason: friendlyMessage,
      });

      return {
        ok: false,
        code: 'unknown',
        error: friendlyMessage,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process payout.';
    return { ok: false, code: 'unknown', error: message };
  }
}
