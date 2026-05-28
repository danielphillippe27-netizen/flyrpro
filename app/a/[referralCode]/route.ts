import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getApprovedAmbassadorByReferralCode } from '@/app/lib/billing/ambassador-access';
import { getTrackingMetadata } from '@/app/lib/ambassador/tracking';
import { isMissingAmbassadorSchemaError } from '@/app/lib/billing/ambassador-program';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ referralCode: string }> }
) {
  const { referralCode } = await context.params;
  const code = decodeURIComponent(referralCode ?? '').trim().toUpperCase();
  const redirectUrl = new URL('/onboarding', request.nextUrl.origin);

  if (!code) {
    return NextResponse.redirect(redirectUrl);
  }

  const admin = createAdminClient();
  const ambassador = await getApprovedAmbassadorByReferralCode(admin, code).catch((error) => {
    console.warn('[ambassador referral redirect] lookup failed', error);
    return null;
  });

  if (!ambassador?.referral_code) {
    return NextResponse.redirect(redirectUrl);
  }

  const metadata = getTrackingMetadata(request);
  await admin
    .from('ambassador_click_events')
    .insert({
      ambassador_application_id: ambassador.id,
      referral_code: ambassador.referral_code.trim().toUpperCase(),
      source: metadata.source,
      campaign: metadata.campaign,
      ip_hash: metadata.ipHash,
      user_agent: metadata.userAgent,
      referer: metadata.referer,
    })
    .then(({ error }) => {
      if (error && !isMissingAmbassadorSchemaError(error.message)) {
        console.warn('[ambassador referral redirect] click tracking failed', error);
      }
    });

  redirectUrl.searchParams.set('referralCode', ambassador.referral_code.trim().toUpperCase());
  if (metadata.source) redirectUrl.searchParams.set('source', metadata.source);
  if (metadata.campaign) redirectUrl.searchParams.set('campaign', metadata.campaign);
  return NextResponse.redirect(redirectUrl);
}
