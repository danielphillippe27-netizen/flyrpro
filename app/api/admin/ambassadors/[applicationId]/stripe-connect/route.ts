import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { stripe } from '@/lib/stripe';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import {
  buildConnectBusinessProfilePrefill,
  isMissingStripeConnectAccountError,
} from '@/app/lib/billing/stripe-connect-prefill';
import {
  ensureAmbassadorReferralCode,
  isMissingAmbassadorSchemaError,
  syncAmbassadorStripePromotionCode,
} from '@/app/lib/billing/ambassador-program';
import { sendAmbassadorStripeOnboardingEmail } from '@/lib/email/resend';

const stripeConnectPayloadSchema = z.object({
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  referralCodeMaxUses: z.preprocess((value) => {
    if (value === '' || value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.union([z.number().int().min(1).max(10000), z.null()]).optional()),
  commissionRateBps: z.preprocess((value) => {
    if (value === '' || value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.union([z.number().int().min(1).max(10000), z.null()]).optional()),
  commissionDurationMonths: z.preprocess((value) => {
    if (value === '' || value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.union([z.number().int().min(1).max(36), z.null()]).optional()),
});

type AmbassadorApplicationRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  stripe_connect_account_id: string | null;
  referral_code: string | null;
  referral_code_max_uses: number | null;
  stripe_promotion_code_id: string | null;
  commission_rate_bps: number | null;
  commission_duration_months: number | null;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ applicationId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isStripeSecretKeyConfigured()) {
      return NextResponse.json(
        { error: 'Stripe secret key is not configured for the current mode.' },
        { status: 500 }
      );
    }

    const { applicationId } = await context.params;
    if (!applicationId) {
      return NextResponse.json({ error: 'Application ID is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = stripeConnectPayloadSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid approval payload.' },
        { status: 400 }
      );
    }

    const { data, error } = await auth.admin
      .from('ambassador_applications')
      .select(
        'id, email, full_name, status, stripe_connect_account_id, referral_code, referral_code_max_uses, stripe_promotion_code_id, commission_rate_bps, commission_duration_months'
      )
      .eq('id', applicationId)
      .maybeSingle();

    if (error) {
      if (isMissingAmbassadorSchemaError(error.message)) {
        return NextResponse.json(
          {
            error:
              'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const application = data as AmbassadorApplicationRow | null;
    if (!application) {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    }

    const referralCode = await ensureAmbassadorReferralCode(auth.admin, {
      applicationId: application.id,
      fullName: application.full_name,
      existingReferralCode: application.referral_code,
      preferredReferralCode: parsed.data.referralCode,
    });

    const normalizedReferralCodeMaxUses =
      parsed.data.referralCodeMaxUses !== undefined
        ? parsed.data.referralCodeMaxUses
        : application.referral_code_max_uses;
    const normalizedCommissionRateBps =
      parsed.data.commissionRateBps !== undefined
        ? parsed.data.commissionRateBps
        : application.commission_rate_bps;
    const normalizedCommissionDurationMonths =
      parsed.data.commissionDurationMonths !== undefined
        ? parsed.data.commissionDurationMonths
        : application.commission_duration_months;

    let stripePromotionCodeId = application.stripe_promotion_code_id;
    let stripePromotionCodeWarning: string | null = null;

    const promoSync = await syncAmbassadorStripePromotionCode({
      applicationId: application.id,
      referralCode,
      referralCodeMaxUses: normalizedReferralCodeMaxUses,
      existingPromotionCodeId: stripePromotionCodeId,
    });
    stripePromotionCodeId = promoSync.promotionCodeId;
    stripePromotionCodeWarning = promoSync.skippedReason;

    let accountId = application.stripe_connect_account_id;
    const businessProfile = buildConnectBusinessProfilePrefill({
      origin: request.nextUrl.origin,
      productDescription: 'FLYR ambassador commissions and creator partnership payouts',
    });

    const createAccount = async () => {
      const account = await stripe.accounts.create({
        type: 'express',
        email: application.email,
        business_type: 'individual',
        business_profile: businessProfile,
        metadata: {
          ambassador_application_id: application.id,
          ambassador_name: application.full_name,
          source: 'flyr_ambassador_program',
        },
      });
      return account.id;
    };

    if (!accountId) {
      accountId = await createAccount();
    } else {
      try {
        const existingAccount = await stripe.accounts.retrieve(accountId);
        if (!existingAccount.details_submitted) {
          await stripe.accounts.update(accountId, {
            business_profile: businessProfile,
          });
        }
      } catch (error) {
        if (isMissingStripeConnectAccountError(error)) {
          accountId = await createAccount();
        } else {
          console.warn('[api/admin/ambassadors/:id/stripe-connect] Stripe prefill update failed:', error);
        }
      }
    }

    const createAccountLink = async (stripeAccountId: string) =>
      stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${request.nextUrl.origin}/ambassador?stripeOnboarding=refresh`,
        return_url: `${request.nextUrl.origin}/ambassador?stripeOnboarding=complete`,
        type: 'account_onboarding',
      });

    let accountLink;
    try {
      accountLink = await createAccountLink(accountId);
    } catch (error) {
      if (!isMissingStripeConnectAccountError(error)) throw error;
      accountId = await createAccount();
      accountLink = await createAccountLink(accountId);
    }

    const account = await stripe.accounts.retrieve(accountId);

    const { error: updateError } = await auth.admin
      .from('ambassador_applications')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        stripe_connect_account_id: accountId,
        stripe_onboarding_completed: account.details_submitted ?? false,
        stripe_details_submitted: account.details_submitted ?? false,
        stripe_charges_enabled: account.charges_enabled ?? false,
        stripe_payouts_enabled: account.payouts_enabled ?? false,
        referral_code_max_uses: normalizedReferralCodeMaxUses,
        stripe_promotion_code_id: stripePromotionCodeId,
        commission_rate_bps: normalizedCommissionRateBps,
        commission_duration_months: normalizedCommissionDurationMonths,
      })
      .eq('id', application.id);

    if (updateError) {
      if (isMissingAmbassadorSchemaError(updateError.message)) {
        return NextResponse.json(
          {
            error:
              'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    let onboardingEmailSent = false;
    let onboardingEmailWarning: string | null = null;
    try {
      await sendAmbassadorStripeOnboardingEmail({
        to: application.email,
        fullName: application.full_name,
        onboardingUrl: accountLink.url,
        referralCode,
      });
      onboardingEmailSent = true;
    } catch (emailError) {
      onboardingEmailWarning =
        emailError instanceof Error
          ? emailError.message
          : 'Stripe onboarding link was created, but email was not sent.';
    }

    return NextResponse.json({
      ok: true,
      accountId,
      referralCode,
      onboardingUrl: accountLink.url,
      onboardingEmailSent,
      onboardingEmailWarning,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      stripePromotionCodeId,
      stripePromotionCodeWarning,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors/:id/stripe-connect] POST error:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
