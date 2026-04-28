import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { payAmbassadorCommissions } from '@/app/lib/billing/ambassador-payouts';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';

const payoutRequestSchema = z.object({
  ambassadorApplicationId: z.string().uuid(),
  currency: z.string().trim().min(3).max(3),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => null);
    const parsed = payoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid payout request.' },
        { status: 400 }
      );
    }

    const result = await payAmbassadorCommissions({
      admin: auth.admin,
      founderUserId: auth.user.id,
      ambassadorApplicationId: parsed.data.ambassadorApplicationId,
      currency: parsed.data.currency,
      note: parsed.data.note,
      stripeConfigured: isStripeSecretKeyConfigured(),
    });

    if (!result.ok) {
      const status =
        result.code === 'not_found'
          ? 404
          : result.code === 'not_ready' ||
              result.code === 'no_pending_commissions'
            ? 409
            : 500;

      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    return NextResponse.json({
      ok: true,
      alreadyPaid: result.alreadyPaid,
      batchId: result.batchId,
      transferId: result.transferId,
      transferGroup: result.transferGroup,
      ambassadorApplicationId: result.ambassadorApplicationId,
      ambassadorName: result.ambassadorName,
      currency: result.currency,
      totalCommissionCents: result.totalCommissionCents,
      commissionCount: result.commissionCount,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors/payouts] POST error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
