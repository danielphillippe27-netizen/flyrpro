import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { stripe } from '@/lib/stripe';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import {
  buildConnectBusinessProfilePrefill,
  buildIndividualConnectPrefill,
  isMissingStripeConnectAccountError,
} from '@/app/lib/billing/stripe-connect-prefill';
import { ensureSalespersonReferralCode } from '@/app/lib/billing/salespeople';

const stripeConnectPayloadSchema = z.object({
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  commissionRateBps: z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number().int().min(1).max(10000).optional()),
  commissionDurationMonths: z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number().int().min(1).max(36).optional()),
});

type SalespersonRow = {
  id: string;
  email: string;
  full_name: string;
  status: 'active' | 'paused' | 'inactive';
  stripe_connect_account_id: string | null;
  referral_code: string | null;
  commission_rate_bps: number;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ salespersonId: string }> }
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

    const { salespersonId } = await context.params;
    if (!salespersonId) {
      return NextResponse.json({ error: 'Salesperson ID is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = stripeConnectPayloadSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid Stripe connect payload.' },
        { status: 400 }
      );
    }

    const { data, error } = await auth.admin
      .from('salespeople')
      .select(
        'id, email, full_name, status, stripe_connect_account_id, referral_code, commission_rate_bps'
      )
      .eq('id', salespersonId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const salesperson = data as SalespersonRow | null;
    if (!salesperson) {
      return NextResponse.json({ error: 'Salesperson not found.' }, { status: 404 });
    }

    const referralCode = await ensureSalespersonReferralCode(auth.admin, {
      salespersonId: salesperson.id,
      fullName: salesperson.full_name,
      existingReferralCode: salesperson.referral_code,
      preferredReferralCode: parsed.data.referralCode,
    });

    let accountId = salesperson.stripe_connect_account_id;
    const individual = buildIndividualConnectPrefill({
      email: salesperson.email,
      fullName: salesperson.full_name,
      title: 'Salesperson',
    });
    const businessProfile = buildConnectBusinessProfilePrefill({
      origin: request.nextUrl.origin,
      productDescription: 'FLYR direct sales commissions and salesperson payouts',
    });

    const createAccount = async () => {
      const account = await stripe.accounts.create({
        type: 'express',
        email: salesperson.email,
        business_type: 'individual',
        individual,
        business_profile: businessProfile,
        metadata: {
          salesperson_id: salesperson.id,
          salesperson_name: salesperson.full_name,
          source: 'flyr_salespeople_program',
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
            individual,
          });
        }
      } catch (error) {
        if (isMissingStripeConnectAccountError(error)) {
          accountId = await createAccount();
        } else {
          console.warn('[api/admin/salespeople/:id/stripe-connect] Stripe prefill update failed:', error);
        }
      }
    }

    const createAccountLink = async (stripeAccountId: string) =>
      stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${request.nextUrl.origin}/salespeople?stripeOnboarding=refresh`,
        return_url: `${request.nextUrl.origin}/salespeople?stripeOnboarding=complete`,
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
    const updatePayload: Record<string, string | number | boolean | null> = {
      status: 'active',
      approved_at: new Date().toISOString(),
      stripe_connect_account_id: accountId,
      stripe_onboarding_completed: account.details_submitted ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
    };

    if (parsed.data.commissionRateBps !== undefined) {
      updatePayload.commission_rate_bps = parsed.data.commissionRateBps;
    }
    if (parsed.data.commissionDurationMonths !== undefined) {
      updatePayload.commission_duration_months = parsed.data.commissionDurationMonths;
    }

    let { error: updateError } = await auth.admin
      .from('salespeople')
      .update(updatePayload)
      .eq('id', salesperson.id);

    if (
      updateError &&
      updateError.message.toLowerCase().includes('commission_duration_months') &&
      'commission_duration_months' in updatePayload
    ) {
      delete updatePayload.commission_duration_months;
      const retry = await auth.admin
        .from('salespeople')
        .update(updatePayload)
        .eq('id', salesperson.id);
      updateError = retry.error;
    }

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      accountId,
      referralCode,
      onboardingUrl: accountLink.url,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
    });
  } catch (error) {
    console.error('[api/admin/salespeople/:id/stripe-connect] POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
