import { createHash } from 'node:crypto';
import { stripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { isMissingAmbassadorSchemaError } from '@/app/lib/billing/ambassador-program';

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type AmbassadorPayoutCandidateRow = {
  id: string;
  full_name: string;
  email: string;
  stripe_connect_account_id: string | null;
  stripe_payouts_enabled: boolean;
};

type AmbassadorCommissionRow = {
  id: string;
  commission_amount_cents: number;
  revenue_amount_cents: number;
  currency: string;
  earned_at: string;
  status: 'pending' | 'paid' | 'voided';
};

type AmbassadorPayoutBatchRow = {
  id: string;
  ambassador_application_id: string | null;
  created_by_user_id: string | null;
  status: 'draft' | 'processing' | 'paid' | 'failed';
  currency: string;
  total_commission_cents: number;
  note: string | null;
  paid_at: string | null;
  processed_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_transfer_id: string | null;
  transfer_group: string | null;
  commission_snapshot_hash: string | null;
  failure_reason: string | null;
};

export type AmbassadorPayoutResult =
  | {
      ok: true;
      alreadyPaid: boolean;
      batchId: string;
      transferId: string | null;
      transferGroup: string | null;
      currency: string;
      totalCommissionCents: number;
      commissionCount: number;
      ambassadorApplicationId: string;
      ambassadorName: string;
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
  ambassadorApplicationId: string,
  currency: string,
  commissions: AmbassadorCommissionRow[]
): string {
  const payload = commissions
    .map((commission) => `${commission.id}:${commission.commission_amount_cents}`)
    .sort()
    .join('|');

  return createHash('sha256')
    .update(`${ambassadorApplicationId}:${currency}:${payload}`)
    .digest('hex');
}

async function loadAmbassadorPayoutCandidate(
  admin: SupabaseAdmin,
  ambassadorApplicationId: string
): Promise<AmbassadorPayoutCandidateRow | null> {
  const { data, error } = await admin
    .from('ambassador_applications')
    .select(
      'id, full_name, email, stripe_connect_account_id, stripe_payouts_enabled'
    )
    .eq('id', ambassadorApplicationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AmbassadorPayoutCandidateRow | null) ?? null;
}

async function loadPendingCommissions(
  admin: SupabaseAdmin,
  ambassadorApplicationId: string,
  currency: string
): Promise<AmbassadorCommissionRow[]> {
  const { data, error } = await admin
    .from('ambassador_commissions')
    .select(
      'id, commission_amount_cents, revenue_amount_cents, currency, earned_at, status'
    )
    .eq('ambassador_application_id', ambassadorApplicationId)
    .eq('status', 'pending')
    .eq('currency', currency)
    .order('earned_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AmbassadorCommissionRow[];
}

async function findExistingBatch(
  admin: SupabaseAdmin,
  ambassadorApplicationId: string,
  currency: string,
  commissionSnapshotHash: string
): Promise<AmbassadorPayoutBatchRow | null> {
  const { data, error } = await admin
    .from('ambassador_payout_batches')
    .select(
      'id, ambassador_application_id, created_by_user_id, status, currency, total_commission_cents, note, paid_at, processed_at, stripe_connect_account_id, stripe_transfer_id, transfer_group, commission_snapshot_hash, failure_reason'
    )
    .eq('ambassador_application_id', ambassadorApplicationId)
    .eq('currency', currency)
    .eq('commission_snapshot_hash', commissionSnapshotHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AmbassadorPayoutBatchRow | null) ?? null;
}

async function createBatch(
  admin: SupabaseAdmin,
  params: {
    ambassadorApplicationId: string;
    createdByUserId: string;
    currency: string;
    totalCommissionCents: number;
    note: string | null;
    stripeConnectAccountId: string;
    commissionSnapshotHash: string;
  }
): Promise<AmbassadorPayoutBatchRow> {
  const { data, error } = await admin
    .from('ambassador_payout_batches')
    .insert({
      ambassador_application_id: params.ambassadorApplicationId,
      created_by_user_id: params.createdByUserId,
      status: 'draft',
      currency: params.currency,
      total_commission_cents: params.totalCommissionCents,
      note: params.note,
      stripe_connect_account_id: params.stripeConnectAccountId,
      commission_snapshot_hash: params.commissionSnapshotHash,
    })
    .select(
      'id, ambassador_application_id, created_by_user_id, status, currency, total_commission_cents, note, paid_at, processed_at, stripe_connect_account_id, stripe_transfer_id, transfer_group, commission_snapshot_hash, failure_reason'
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as AmbassadorPayoutBatchRow;
}

async function attachCommissionsToBatch(
  admin: SupabaseAdmin,
  batchId: string,
  commissions: AmbassadorCommissionRow[]
): Promise<void> {
  if (!commissions.length) return;

  const { error } = await admin
    .from('ambassador_payout_batch_items')
    .upsert(
      commissions.map((commission) => ({
        payout_batch_id: batchId,
        ambassador_commission_id: commission.id,
        amount_cents: commission.commission_amount_cents,
      })),
      { onConflict: 'ambassador_commission_id' }
    );

  if (error) {
    throw new Error(error.message);
  }
}

async function updateBatchStatus(
  admin: SupabaseAdmin,
  batchId: string,
  values: Record<string, string | number | null>
): Promise<void> {
  const { error } = await admin
    .from('ambassador_payout_batches')
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  if (error) {
    throw new Error(error.message);
  }
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
    .from('ambassador_commissions')
    .update({
      status: 'paid',
      paid_out_at: now,
      payout_batch_id: params.batchId,
      stripe_transfer_id: params.transferId,
      updated_at: now,
    })
    .in('id', params.commissionIds);

  if (commissionError) {
    throw new Error(commissionError.message);
  }

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
    if (message) {
      return message;
    }
  }

  return 'Stripe payout failed.';
}

export async function payAmbassadorCommissions(params: {
  admin: SupabaseAdmin;
  founderUserId: string;
  ambassadorApplicationId: string;
  currency: string;
  note?: string | null;
  stripeConfigured: boolean;
}): Promise<AmbassadorPayoutResult> {
  if (!params.stripeConfigured) {
    return {
      ok: false,
      code: 'stripe_not_configured',
      error: 'Stripe secret key is not configured for the current mode.',
    };
  }

  try {
    const ambassador = await loadAmbassadorPayoutCandidate(
      params.admin,
      params.ambassadorApplicationId
    );

    if (!ambassador) {
      return {
        ok: false,
        code: 'not_found',
        error: 'Ambassador application not found.',
      };
    }

    if (!ambassador.stripe_connect_account_id || !ambassador.stripe_payouts_enabled) {
      return {
        ok: false,
        code: 'not_ready',
        error: 'Ambassador has not finished Stripe payout setup yet.',
      };
    }

    const currency = normalizeCurrency(params.currency);
    const commissions = await loadPendingCommissions(
      params.admin,
      params.ambassadorApplicationId,
      currency
    );

    if (!commissions.length) {
      return {
        ok: false,
        code: 'no_pending_commissions',
        error: 'No pending commissions are ready to pay for this ambassador.',
      };
    }

    const totalCommissionCents = commissions.reduce(
      (sum, commission) => sum + (commission.commission_amount_cents ?? 0),
      0
    );
    const commissionSnapshotHash = buildCommissionSnapshotHash(
      params.ambassadorApplicationId,
      currency,
      commissions
    );
    const note = params.note?.trim() || null;

    let batch = await findExistingBatch(
      params.admin,
      params.ambassadorApplicationId,
      currency,
      commissionSnapshotHash
    );

    if (!batch) {
      batch = await createBatch(params.admin, {
        ambassadorApplicationId: params.ambassadorApplicationId,
        createdByUserId: params.founderUserId,
        currency,
        totalCommissionCents,
        note,
        stripeConnectAccountId: ambassador.stripe_connect_account_id,
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
        ambassadorApplicationId: params.ambassadorApplicationId,
        ambassadorName: ambassador.full_name,
      };
    }

    await attachCommissionsToBatch(params.admin, batch.id, commissions);

    if (batch.note !== note || batch.total_commission_cents !== totalCommissionCents) {
      await updateBatchStatus(params.admin, batch.id, {
        note,
        total_commission_cents: totalCommissionCents,
      });
    }

    const transferGroup = batch.transfer_group || `ambassador_batch_${batch.id}`;

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
        ambassadorApplicationId: params.ambassadorApplicationId,
        ambassadorName: ambassador.full_name,
      };
    }

    await updateBatchStatus(params.admin, batch.id, {
      status: 'processing',
      transfer_group: transferGroup,
      stripe_connect_account_id: ambassador.stripe_connect_account_id,
      failure_reason: null,
    });

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: totalCommissionCents,
          currency: currency.toLowerCase(),
          destination: ambassador.stripe_connect_account_id,
          transfer_group: transferGroup,
          metadata: {
            ambassador_application_id: params.ambassadorApplicationId,
            ambassador_name: ambassador.full_name,
            ambassador_email: ambassador.email,
            payout_batch_id: batch.id,
            payout_type: 'ambassador_commissions',
          },
        },
        {
          idempotencyKey: `ambassador-payout:${batch.id}`,
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
        ambassadorApplicationId: params.ambassadorApplicationId,
        ambassadorName: ambassador.full_name,
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
    if (isMissingAmbassadorSchemaError(message)) {
      return {
        ok: false,
        code: 'schema_missing',
        error: 'Ambassador payout storage is not ready yet. Run the latest ambassador migrations first.',
      };
    }

    return {
      ok: false,
      code: 'unknown',
      error: message,
    };
  }
}
