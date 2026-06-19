import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  AMBASSADOR_TRIAL_DAYS,
  WORKSPACE_TRIAL_DAYS,
} from '@/app/lib/billing/workspace-trial';
import { validateAmbassadorReferralCodeForOnboarding } from '@/app/lib/billing/ambassador-program';
import {
  normalizeSalespersonReferralCodeInput,
  resolveActiveSalespersonReferralCode,
} from '@/app/lib/billing/salespeople';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const referralCode =
      typeof body?.referralCode === 'string' ? body.referralCode : null;
    const admin = createAdminClient();

    const result = await validateAmbassadorReferralCodeForOnboarding(admin, referralCode);

    if (result.ok) {
      return NextResponse.json({
        valid: true,
        referralCode: result.referralCode,
        trialDays: AMBASSADOR_TRIAL_DAYS,
        partnerName: result.ambassador.full_name,
        ambassadorName: result.ambassador.full_name,
        referralType: 'ambassador',
      });
    }

    if (result.reason === 'maxed') {
      return NextResponse.json(
        {
          valid: false,
          referralCode: result.referralCode,
          reason: result.reason,
          error: result.message,
        },
        { status: 400 }
      );
    }

    const salespersonReferralCode =
      typeof referralCode === 'string'
        ? normalizeSalespersonReferralCodeInput(referralCode)
        : '';
    const salesperson = await resolveActiveSalespersonReferralCode(
      admin,
      salespersonReferralCode
    );

    if (salesperson?.referral_code) {
      return NextResponse.json({
        valid: true,
        referralCode: salesperson.referral_code.trim().toUpperCase(),
        trialDays: WORKSPACE_TRIAL_DAYS,
        partnerName: salesperson.full_name,
        salespersonName: salesperson.full_name,
        referralType: 'salesperson',
      });
    }

    return NextResponse.json({
      referralCode: result.referralCode,
      valid: false,
      reason: result.reason,
      error: result.message,
    }, { status: result.reason === 'empty' ? 200 : 400 });
  } catch (error) {
    console.error('[onboarding referral-code] validation failed:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate referral code' },
      { status: 500 }
    );
  }
}
