import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { stripe } from '@/lib/stripe';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';

type AmbassadorApplicationRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  stripe_connect_account_id: string | null;
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

    const { data, error } = await auth.admin
      .from('ambassador_applications')
      .select('id, email, full_name, status, stripe_connect_account_id')
      .eq('id', applicationId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const application = data as AmbassadorApplicationRow | null;
    if (!application) {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    }

    let accountId = application.stripe_connect_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: application.email,
        business_type: 'individual',
        business_profile: {
          product_description: 'FLYR ambassador commissions and creator partnership payouts',
        },
        metadata: {
          ambassador_application_id: application.id,
          ambassador_name: application.full_name,
          source: 'flyr_ambassador_program',
        },
      });
      accountId = account.id;
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${request.nextUrl.origin}/admin`,
      return_url: `${request.nextUrl.origin}/admin`,
      type: 'account_onboarding',
    });

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
      })
      .eq('id', application.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      accountId,
      onboardingUrl: accountLink.url,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors/:id/stripe-connect] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
