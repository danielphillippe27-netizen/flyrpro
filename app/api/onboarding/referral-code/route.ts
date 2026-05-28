import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { AMBASSADOR_TRIAL_DAYS } from '@/app/lib/billing/workspace-trial';
import { validateAmbassadorReferralCodeForOnboarding } from '@/app/lib/billing/ambassador-program';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const referralCode =
      typeof body?.referralCode === 'string' ? body.referralCode : null;

    const result = await validateAmbassadorReferralCodeForOnboarding(
      createAdminClient(),
      referralCode
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          valid: false,
          referralCode: result.referralCode,
          reason: result.reason,
          error: result.message,
        },
        { status: result.reason === 'empty' ? 200 : 400 }
      );
    }

    return NextResponse.json({
      valid: true,
      referralCode: result.referralCode,
      trialDays: AMBASSADOR_TRIAL_DAYS,
      ambassadorName: result.ambassador.full_name,
    });
  } catch (error) {
    console.error('[onboarding referral-code] validation failed:', error);
    return NextResponse.json(
      { valid: false, error: 'Failed to validate referral code' },
      { status: 500 }
    );
  }
}
