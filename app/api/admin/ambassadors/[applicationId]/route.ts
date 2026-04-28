import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  ensureAmbassadorReferralCode,
  isMissingAmbassadorSchemaError,
  syncAmbassadorStripePromotionCode,
} from '@/app/lib/billing/ambassador-program';

const referralCodeMaxUsesSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.union([z.number().int().min(1).max(10000), z.null()]).optional());

const commissionRateBpsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.union([z.number().int().min(1).max(10000), z.null()]).optional());

const commissionDurationMonthsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.union([z.number().int().min(1).max(36), z.null()]).optional());

const ambassadorStatusSchema = z.object({
  status: z.enum(['applied', 'approved', 'rejected', 'paused']).optional(),
  reviewNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  referralCodeMaxUses: referralCodeMaxUsesSchema,
  commissionRateBps: commissionRateBpsSchema,
  commissionDurationMonths: commissionDurationMonthsSchema,
});

function normalizeNotes(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ applicationId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { applicationId } = await context.params;
    if (!applicationId) {
      return NextResponse.json({ error: 'Application ID is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = ambassadorStatusSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid update payload.' },
        { status: 400 }
      );
    }

    const { data: current, error: currentError } = await auth.admin
      .from('ambassador_applications')
      .select(
        'id, full_name, referral_code, referral_code_max_uses, stripe_promotion_code_id, commission_rate_bps, commission_duration_months, status, review_notes, approved_at, rejected_at'
      )
      .eq('id', applicationId)
      .maybeSingle();

    if (currentError) {
      if (isMissingAmbassadorSchemaError(currentError.message)) {
        return NextResponse.json(
          {
            error:
              'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ error: currentError.message }, { status: 500 });
    }

    if (!current) {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    }

    const updates: Record<string, string | number | null> = {};
    let shouldEnsureReferralCode = false;
    if (parsed.data.status) {
      updates.status = parsed.data.status;
      if (parsed.data.status === 'approved') {
        updates.approved_at = new Date().toISOString();
        updates.rejected_at = null;
        shouldEnsureReferralCode = true;
      } else if (parsed.data.status === 'rejected') {
        updates.rejected_at = new Date().toISOString();
      } else {
        updates.rejected_at = null;
      }
    }

    if (parsed.data.reviewNotes !== undefined) {
      updates.review_notes = normalizeNotes(parsed.data.reviewNotes);
    }

    if (parsed.data.referralCodeMaxUses !== undefined) {
      updates.referral_code_max_uses = parsed.data.referralCodeMaxUses;
    }

    if (parsed.data.commissionRateBps !== undefined) {
      updates.commission_rate_bps = parsed.data.commissionRateBps;
    }

    if (parsed.data.commissionDurationMonths !== undefined) {
      updates.commission_duration_months = parsed.data.commissionDurationMonths;
    }

    if (parsed.data.referralCode !== undefined) {
      shouldEnsureReferralCode = true;
    }

    if (Object.keys(updates).length === 0 && !shouldEnsureReferralCode) {
      return NextResponse.json({ error: 'No changes provided.' }, { status: 400 });
    }

    let data = current;
    if (Object.keys(updates).length > 0) {
      const response = await auth.admin
        .from('ambassador_applications')
        .update(updates)
        .eq('id', applicationId)
        .select(
          'id, full_name, referral_code, referral_code_max_uses, stripe_promotion_code_id, commission_rate_bps, commission_duration_months, status, review_notes, approved_at, rejected_at'
        )
        .maybeSingle();

      if (response.error) {
        if (isMissingAmbassadorSchemaError(response.error.message)) {
          return NextResponse.json(
            {
              error:
                'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
            },
            { status: 500 }
          );
        }

        return NextResponse.json({ error: response.error.message }, { status: 500 });
      }

      if (!response.data) {
        return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
      }

      data = response.data;
    }

    const referralCode = shouldEnsureReferralCode
      ? await ensureAmbassadorReferralCode(auth.admin, {
          applicationId: data.id,
          fullName: data.full_name,
          existingReferralCode: data.referral_code,
          preferredReferralCode: parsed.data.referralCode,
        })
      : data.referral_code;

    let stripePromotionCodeId = data.stripe_promotion_code_id;
    let stripePromotionCodeWarning: string | null = null;
    const shouldSyncStripePromotionCode =
      Boolean(referralCode) &&
      (parsed.data.referralCode !== undefined ||
        parsed.data.referralCodeMaxUses !== undefined ||
        parsed.data.status === 'approved');

    if (shouldSyncStripePromotionCode && referralCode) {
      const syncResult = await syncAmbassadorStripePromotionCode({
        applicationId: data.id,
        referralCode,
        referralCodeMaxUses:
          parsed.data.referralCodeMaxUses !== undefined
            ? parsed.data.referralCodeMaxUses
            : data.referral_code_max_uses,
        existingPromotionCodeId: stripePromotionCodeId,
      });

      stripePromotionCodeId = syncResult.promotionCodeId;
      stripePromotionCodeWarning = syncResult.skippedReason;

      if (syncResult.promotionCodeId !== data.stripe_promotion_code_id) {
        const { error: promoUpdateError } = await auth.admin
          .from('ambassador_applications')
          .update({
            stripe_promotion_code_id: syncResult.promotionCodeId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', data.id);

        if (promoUpdateError) {
          if (isMissingAmbassadorSchemaError(promoUpdateError.message)) {
            return NextResponse.json(
              {
                error:
                  'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
              },
              { status: 500 }
            );
          }

          return NextResponse.json({ error: promoUpdateError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      application: {
        id: data.id,
        status: data.status,
        referralCode,
        referralCodeMaxUses:
          parsed.data.referralCodeMaxUses !== undefined
            ? parsed.data.referralCodeMaxUses
            : data.referral_code_max_uses,
        reviewNotes: data.review_notes,
        approvedAt: data.approved_at,
        rejectedAt: data.rejected_at,
        stripePromotionCodeId,
        commissionRateBps: data.commission_rate_bps,
        commissionDurationMonths: data.commission_duration_months,
      },
      stripePromotionCodeWarning,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors/:applicationId] PATCH error:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
