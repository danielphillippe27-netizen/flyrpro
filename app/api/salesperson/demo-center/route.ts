import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  ensureSalespersonReferralCode,
  isMissingSalespeopleSchemaError,
} from '@/app/lib/billing/salespeople';
import {
  getSalespersonDialerSettings,
  resolveSalespersonForUser,
} from '@/lib/dialer/salesperson-settings';
import {
  DEMO_EMAIL_DOMAIN,
  buildFallbackDemoEmailHandle,
  resolveAvailableDemoEmailHandle,
} from '@/lib/dialer/demo-email-handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getPublicOrigin(request: NextRequest): string {
  void request;
  return 'https://flyr.software';
}

function getPreferredReferralCode(
  salesperson: { full_name?: string | null; email?: string | null },
  userEmail?: string | null
): string | null {
  const haystack = `${salesperson.full_name ?? ''} ${salesperson.email ?? ''} ${userEmail ?? ''}`.toLowerCase();
  return haystack.includes('daniel') || haystack.includes('danielsales@gmail.com')
    ? 'DANIELPHILLIPPE'
    : null;
}

function buildSegmentLink(origin: string, referralCode: string, campaign: string): string {
  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, origin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', campaign);
  return url.toString();
}

async function safeCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count, error } = await query;
  if (error && !isMissingSalespeopleSchemaError(error.message)) {
    console.warn('[salesperson/demo-center] count failed', error);
  }
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const salesperson = await resolveSalespersonForUser(admin, {
      userId: requestUser.id,
      email: requestUser.email,
    });

    if (!salesperson?.id) {
      return NextResponse.json({ error: 'Salesperson access required.' }, { status: 403 });
    }

    const preferredReferralCode = getPreferredReferralCode(salesperson, requestUser.email);
    const referralCode = await ensureSalespersonReferralCode(admin, {
      salespersonId: salesperson.id,
      fullName: salesperson.full_name || salesperson.email || 'Salesperson',
      existingReferralCode: salesperson.referral_code,
      preferredReferralCode,
    });

    const [dialerSettings, clickCount, demoViewCount, demoStartCount, trialCount] = await Promise.all([
      getSalespersonDialerSettings(admin, salesperson.id),
      safeCount(
        admin
          .from('salesperson_click_events')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', salesperson.id)
      ),
      safeCount(
        admin
          .from('salesperson_demo_video_events')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', salesperson.id)
          .eq('event_type', 'page_view')
      ),
      safeCount(
        admin
          .from('salesperson_demo_video_events')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', salesperson.id)
          .eq('event_type', 'video_started')
      ),
      safeCount(
        admin
          .from('workspaces')
          .select('id', { count: 'exact', head: true })
          .ilike('referral_code_used', referralCode)
      ),
    ]);

    const origin = getPublicOrigin(request);

    const demoHandle =
      salesperson.demo_email_handle ||
      (await resolveAvailableDemoEmailHandle(admin, salesperson, requestUser.email)) ||
      buildFallbackDemoEmailHandle(salesperson, requestUser.email);

    return NextResponse.json({
      salesperson: {
        id: salesperson.id,
        fullName: preferredReferralCode ?? salesperson.full_name,
        email: salesperson.email,
        referralCode,
        demoEmailAddress: `${demoHandle}@${DEMO_EMAIL_DOMAIN}`,
        assignedPhoneNumber: dialerSettings?.assigned_phone_number ?? null,
        phoneForwardTo: dialerSettings?.inbound_forward_to ?? null,
      },
      links: {
        realEstateAgentUrl: buildSegmentLink(origin, referralCode, 'real-estate-agent'),
        realEstateTeamUrl: buildSegmentLink(origin, referralCode, 'real-estate-team'),
        roofingUrl: buildSegmentLink(origin, referralCode, 'roofing'),
        solarUrl: buildSegmentLink(origin, referralCode, 'solar'),
        homeServiceUrl: buildSegmentLink(origin, referralCode, 'home-service'),
      },
      stats: {
        clicks: clickCount,
        demoViews: demoViewCount,
        videoStarts: demoStartCount,
        trials: trialCount,
        emailOpens: 0,
        emailOpenTrackingEnabled: false,
      },
    });
  } catch (error) {
    console.error('[salesperson/demo-center] GET error:', error);
    return NextResponse.json({ error: 'Failed to load demo center.' }, { status: 500 });
  }
}
