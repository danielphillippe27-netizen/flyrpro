import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  isMissingSalespeopleSchemaError,
  resolveActiveSalespersonReferralCode,
} from '@/app/lib/billing/salespeople';
import { getTrackingMetadata } from '@/app/lib/ambassador/tracking';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ referralCode: string }> }
) {
  const { referralCode } = await context.params;
  const code = decodeURIComponent(referralCode ?? '').trim().toUpperCase();
  const redirectPath = request.nextUrl.searchParams.get('redirect')?.trim();
  const safeRedirectPath =
    redirectPath && redirectPath.startsWith('/') && !redirectPath.startsWith('//')
      ? redirectPath
      : '/onboarding';
  const redirectUrl = new URL(safeRedirectPath, request.nextUrl.origin);

  if (!code) {
    return NextResponse.redirect(redirectUrl);
  }

  const admin = createAdminClient();
  const salesperson = await resolveActiveSalespersonReferralCode(admin, code).catch((error) => {
    console.warn('[salesperson referral redirect] lookup failed', error);
    return null;
  });

  if (!salesperson?.referral_code) {
    return NextResponse.redirect(redirectUrl);
  }

  const referralCodeValue = salesperson.referral_code.trim().toUpperCase();
  const metadata = getTrackingMetadata(request);

  await admin
    .from('salesperson_click_events')
    .insert({
      salesperson_id: salesperson.id,
      referral_code: referralCodeValue,
      source: metadata.source,
      campaign: metadata.campaign,
      ip_hash: metadata.ipHash,
      user_agent: metadata.userAgent,
      referer: metadata.referer,
    })
    .then(({ error }) => {
      if (error && !isMissingSalespeopleSchemaError(error.message)) {
        console.warn('[salesperson referral redirect] click tracking failed', error);
      }
    });

  redirectUrl.searchParams.set('referralCode', referralCodeValue);
  if (metadata.source) redirectUrl.searchParams.set('source', metadata.source);
  if (metadata.campaign) redirectUrl.searchParams.set('campaign', metadata.campaign);
  return NextResponse.redirect(redirectUrl);
}
