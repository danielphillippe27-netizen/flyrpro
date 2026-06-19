import { NextRequest, NextResponse } from 'next/server';
import { requireApprovedAmbassadorApi, ensureApprovedAmbassadorReferralCode } from '@/app/lib/billing/ambassador-access';
import {
  AMBASSADOR_RE_TEAM_CAMPAIGN,
  buildAmbassadorReTeamLandingPath,
  buildPublicLandingPath,
  withFlyrOrigin,
} from '@/app/lib/ambassador/portal';
import { getOrCreateAmbassadorLandingPage } from '@/app/lib/ambassador/landing-page';
import { isMissingAmbassadorSchemaError } from '@/app/lib/billing/ambassador-program';

async function safeExactCount(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await query;
  if (error) {
    if (isMissingAmbassadorSchemaError(error.message)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const { admin, ambassador } = auth.context;
    const referralCode = await ensureApprovedAmbassadorReferralCode(admin, ambassador);
    const landingPage = await getOrCreateAmbassadorLandingPage(admin, {
      ...ambassador,
      referral_code: referralCode,
    });

    const [
      totalClicks,
      landingPageViews,
      workspaceCount,
      paidActiveReferralCount,
      reTeamLandingPageViews,
      reTeamClicks,
      reTeamSignupCount,
      pendingCommissionsRes,
      paidCommissionsRes,
      recentCommissionsRes,
    ] = await Promise.all([
      safeExactCount(
        admin
          .from('ambassador_click_events')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
      ),
      safeExactCount(
        admin
          .from('ambassador_landing_page_events')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
      ),
      safeExactCount(
        admin
          .from('workspaces')
          .select('id', { count: 'exact', head: true })
          .ilike('referral_code_used', referralCode)
      ),
      safeExactCount(
        admin
          .from('ambassador_referrals')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
          .eq('status', 'active')
      ),
      safeExactCount(
        admin
          .from('ambassador_landing_page_events')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
          .eq('campaign', AMBASSADOR_RE_TEAM_CAMPAIGN)
      ),
      safeExactCount(
        admin
          .from('ambassador_click_events')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
          .eq('campaign', AMBASSADOR_RE_TEAM_CAMPAIGN)
      ),
      safeExactCount(
        admin
          .from('ambassador_referrals')
          .select('id', { count: 'exact', head: true })
          .eq('ambassador_application_id', ambassador.id)
          .eq('campaign', AMBASSADOR_RE_TEAM_CAMPAIGN)
      ),
      admin
        .from('ambassador_commissions')
        .select('commission_amount_cents')
        .eq('ambassador_application_id', ambassador.id)
        .eq('status', 'pending'),
      admin
        .from('ambassador_commissions')
        .select('commission_amount_cents')
        .eq('ambassador_application_id', ambassador.id)
        .eq('status', 'paid'),
      admin
        .from('ambassador_commissions')
        .select('id, referred_user_id, commission_amount_cents, status, earned_at, created_at')
        .eq('ambassador_application_id', ambassador.id)
        .order('earned_at', { ascending: false })
        .limit(10),
    ]);

    const pendingCommissions = pendingCommissionsRes.error &&
      isMissingAmbassadorSchemaError(pendingCommissionsRes.error.message)
      ? []
      : pendingCommissionsRes.data ?? [];
    const paidCommissions = paidCommissionsRes.error &&
      isMissingAmbassadorSchemaError(paidCommissionsRes.error.message)
      ? []
      : paidCommissionsRes.data ?? [];
    const recentCommissions = recentCommissionsRes.error &&
      isMissingAmbassadorSchemaError(recentCommissionsRes.error.message)
      ? []
      : recentCommissionsRes.data ?? [];

    if (pendingCommissionsRes.error && !isMissingAmbassadorSchemaError(pendingCommissionsRes.error.message)) {
      throw new Error(pendingCommissionsRes.error.message);
    }
    if (paidCommissionsRes.error && !isMissingAmbassadorSchemaError(paidCommissionsRes.error.message)) {
      throw new Error(paidCommissionsRes.error.message);
    }
    if (recentCommissionsRes.error && !isMissingAmbassadorSchemaError(recentCommissionsRes.error.message)) {
      throw new Error(recentCommissionsRes.error.message);
    }

    const pendingCommissionCents = pendingCommissions.reduce(
      (sum, row) => sum + Number(row.commission_amount_cents ?? 0),
      0
    );
    const lifetimePaidCommissionCents = paidCommissions.reduce(
      (sum, row) => sum + Number(row.commission_amount_cents ?? 0),
      0
    );

    return NextResponse.json({
      isAmbassador: true,
      referralCode,
      shareLink: withFlyrOrigin(buildPublicLandingPath(landingPage.slug)),
      landingPageUrl: withFlyrOrigin(buildPublicLandingPath(landingPage.slug)),
      reTeamLink: withFlyrOrigin(buildAmbassadorReTeamLandingPath(landingPage.slug)),
      reTeamLandingPageViews,
      reTeamClicks,
      reTeamSignupCount,
      commissionRate: ambassador.commission_rate_bps / 100,
      commissionDurationMonths: ambassador.commission_duration_months,
      totalClicks,
      landingPageViews,
      signupCount: workspaceCount,
      workspaceCount,
      paidActiveReferralCount,
      pendingCommissionCents,
      lifetimePaidCommissionCents,
      recentCommissionActivity: recentCommissions.map((row) => ({
        id: row.id,
        eventType: 'commission',
        amountCents: Number(row.commission_amount_cents ?? 0),
        status: row.status ?? 'pending',
        createdAt: row.earned_at ?? row.created_at,
      })),
    });
  } catch (error) {
    console.error('[api/ambassador/dashboard] GET error:', error);
    return NextResponse.json({ error: 'Failed to load ambassador dashboard' }, { status: 500 });
  }
}
