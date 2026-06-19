import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { isStripeSecretKeyConfigured } from '@/app/lib/billing/stripe-env';
import {
  buildConnectBusinessProfilePrefill,
  buildIndividualConnectPrefill,
  isMissingStripeConnectAccountError,
} from '@/app/lib/billing/stripe-connect-prefill';
import { SALESPERSON_STRIPE_ONBOARDING_POLICY } from '@/app/lib/billing/salesperson-stripe-policy';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { isMissingSalespeopleSchemaError } from '@/app/lib/billing/salespeople';

type SalespersonRow = {
  id: string;
  email: string;
  full_name: string;
  status: 'active' | 'paused' | 'inactive';
  workspace_id: string | null;
  stripe_connect_account_id: string | null;
};

function hasOpenAccountRequirements(account: Awaited<ReturnType<typeof stripe.accounts.retrieve>>): boolean {
  const requirements = account.requirements;
  return Boolean(
    (requirements?.currently_due?.length ?? 0) > 0 ||
      (requirements?.past_due?.length ?? 0) > 0 ||
      (requirements?.errors?.length ?? 0) > 0 ||
      requirements?.disabled_reason?.startsWith('requirements.')
  );
}

async function findActiveSalespersonForRequest(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const normalizedEmail = requestUser.email.trim().toLowerCase();
  const { data, error } = await admin
    .from('salespeople')
    .select('id, email, full_name, status, workspace_id, stripe_connect_account_id')
    .eq('email', normalizedEmail)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    if (isMissingSalespeopleSchemaError(error.message)) {
      return {
        error: NextResponse.json(
          { error: 'Salesperson payout setup is not ready yet.' },
          { status: 500 }
        ),
      };
    }
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  const salesperson = data as SalespersonRow | null;
  if (!salesperson) {
    return {
      error: NextResponse.json(
        { error: 'Salesperson access is required for payout setup.' },
        { status: 403 }
      ),
    };
  }

  return { admin, salesperson };
}

async function syncSalespersonStripeStatus(
  admin: ReturnType<typeof createAdminClient>,
  salespersonId: string,
  accountId: string
) {
  let account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (error) {
    if (!isMissingStripeConnectAccountError(error)) throw error;

    const { error: updateError } = await admin
      .from('salespeople')
      .update({
        stripe_connect_account_id: null,
        stripe_onboarding_completed: false,
        stripe_details_submitted: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', salespersonId);

    if (updateError) throw new Error(updateError.message);

    return {
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }

  const updatePayload = {
    stripe_connect_account_id: accountId,
    stripe_onboarding_completed: account.details_submitted ?? false,
    stripe_details_submitted: account.details_submitted ?? false,
    stripe_charges_enabled: account.charges_enabled ?? false,
    stripe_payouts_enabled: account.payouts_enabled ?? false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from('salespeople').update(updatePayload).eq('id', salespersonId);
  if (error) {
    throw new Error(error.message);
  }

  return {
    accountId,
    chargesEnabled: updatePayload.stripe_charges_enabled,
    payoutsEnabled: updatePayload.stripe_payouts_enabled,
    detailsSubmitted: updatePayload.stripe_details_submitted,
    disabledReason: account.requirements?.disabled_reason ?? null,
    requirementsDue: [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ],
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!isStripeSecretKeyConfigured()) {
      return NextResponse.json(
        { error: 'Stripe is not configured for payout onboarding.' },
        { status: 500 }
      );
    }

    const result = await findActiveSalespersonForRequest(request);
    if ('error' in result) return result.error;

    const { admin, salesperson } = result;
    if (!salesperson.stripe_connect_account_id) {
      return NextResponse.json({
        ok: true,
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        disabledReason: null,
        requirementsDue: [],
      });
    }

    const synced = await syncSalespersonStripeStatus(
      admin,
      salesperson.id,
      salesperson.stripe_connect_account_id
    );

    return NextResponse.json({ ok: true, ...synced });
  } catch (error) {
    console.error('[api/salesperson/stripe-connect] GET error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isStripeSecretKeyConfigured()) {
      return NextResponse.json(
        { error: 'Stripe is not configured for payout onboarding.' },
        { status: 500 }
      );
    }

    const result = await findActiveSalespersonForRequest(request);
    if ('error' in result) return result.error;

    const { admin, salesperson } = result;
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
          source: 'flyr_salesperson_settings',
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

        if (
          existingAccount.details_submitted &&
          !hasOpenAccountRequirements(existingAccount)
        ) {
          const synced = await syncSalespersonStripeStatus(admin, salesperson.id, accountId);
          return NextResponse.json({
            ok: true,
            onboardingUrl: null,
            message: existingAccount.payouts_enabled
              ? 'Stripe payouts are ready.'
              : `Stripe has your details. ${SALESPERSON_STRIPE_ONBOARDING_POLICY}`,
            ...synced,
          });
        }
      } catch (error) {
        if (isMissingStripeConnectAccountError(error)) {
          accountId = await createAccount();
        } else {
          console.warn('[api/salesperson/stripe-connect] Stripe prefill update failed:', error);
        }
      }
    }

    const createAccountLink = async (stripeAccountId: string) =>
      stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${request.nextUrl.origin}/settings?stripeOnboarding=refresh`,
        return_url: `${request.nextUrl.origin}/settings?stripeOnboarding=complete`,
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

    const synced = await syncSalespersonStripeStatus(admin, salesperson.id, accountId);

    return NextResponse.json({
      ok: true,
      onboardingUrl: accountLink.url,
      ...synced,
    });
  } catch (error) {
    console.error('[api/salesperson/stripe-connect] POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
