import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignManagerAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';
import { TerritoryIQService } from '@/lib/territory-iq/TerritoryIQService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { campaignId } = await context.params;
    const admin = createAdminClient();
    if (!(await ensureCampaignManagerAccess(admin, campaignId, user.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [{ data: campaign }, { data: profile }] = await Promise.all([
      admin
        .from('campaigns')
        .select('workspaces!inner(territory_iq_enabled)')
        .eq('id', campaignId)
        .single(),
      admin
        .from('user_profiles')
        .select('is_founder')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    const workspace = Array.isArray(campaign?.workspaces)
      ? campaign.workspaces[0]
      : campaign?.workspaces as { territory_iq_enabled?: boolean } | undefined;
    const forceEnabled =
      process.env.TERRITORY_IQ_FORCE_ENABLED === '1' ||
      process.env.NEXT_PUBLIC_TERRITORY_IQ_PREVIEW === '1';
    if (!workspace?.territory_iq_enabled && profile?.is_founder !== true && !forceEnabled) {
      return NextResponse.json({ error: 'Territory IQ is not enabled for this workspace' }, { status: 403 });
    }
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await admin
      .from('territory_iq_score_runs')
      .select('id, status, queued_at')
      .eq('campaign_id', campaignId)
      .gte('queued_at', oneMinuteAgo)
      .order('queued_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      return NextResponse.json(
        { error: 'GRID SCORE was refreshed recently. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    const result = await new TerritoryIQService(admin).enqueue(campaignId, user.id);
    return NextResponse.json({
      ...result,
      retryMessage: 'GRID SCORE refresh queued. Check again shortly.',
    }, { status: 202 });
  } catch (error) {
    console.error('[territory-iq] refresh failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refresh failed' },
      { status: 500 }
    );
  }
}
