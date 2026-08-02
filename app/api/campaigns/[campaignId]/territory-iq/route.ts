import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';
import { TerritoryIQService } from '@/lib/territory-iq/TerritoryIQService';
import { GRID_SCORE_MODEL_VERSION, profileForIndustry } from '@/lib/territory-iq/scoring';
import { responseFromRows, type CellRow, type ScoreRow } from './_response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ campaignId: string }> };

async function assignedAddressScope(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  workspaceId: string,
  userId: string,
  ownerId: string | null
): Promise<Set<string> | null> {
  if (ownerId === userId) return null;
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membership?.role === 'owner' || membership?.role === 'admin') return null;
  const { data: assignments } = await admin
    .from('campaign_assignments')
    .select('id, mode')
    .eq('campaign_id', campaignId)
    .eq('assigned_to_user_id', userId)
    .in('status', ['assigned', 'accepted', 'in_progress']);
  // Campaign access is the default. Only narrow the result when this member
  // has an explicit address assignment; otherwise Territory IQ would render
  // a misleading empty campaign for every unassigned workspace member.
  if (!(assignments ?? []).length) return null;
  if ((assignments ?? []).some((assignment) => assignment.mode === 'whole_team')) return null;
  const assignmentIds = (assignments ?? []).map((assignment) => assignment.id);
  if (!assignmentIds.length) return new Set<string>();
  const { data: homes } = await admin
    .from('campaign_assignment_homes')
    .select('campaign_address_id')
    .in('assignment_id', assignmentIds);
  return new Set((homes ?? []).map((home) => home.campaign_address_id));
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { campaignId } = await context.params;
    const admin = createAdminClient();
    if (!(await ensureCampaignAccess(admin, campaignId, user.id))) {
      return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
    }
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, workspace_id, workspaces!inner(owner_id, industry)')
      .eq('id', campaignId)
      .single();
    if (!campaign?.workspace_id) {
      return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
    }
    const workspace = Array.isArray(campaign?.workspaces)
      ? campaign.workspaces[0]
      : campaign?.workspaces as { owner_id?: string | null; industry?: string | null } | undefined;
    const profile = profileForIndustry(workspace?.industry);

    const { data: score } = await admin
      .from('campaign_territory_iq_scores')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let queuedTargetHomeCount = 0;
    if (!score) {
      const { count: campaignHomeCount } = await admin
        .from('campaign_addresses')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId);
      queuedTargetHomeCount = campaignHomeCount ?? 0;
      const { data: latestRun } = await admin
        .from('territory_iq_score_runs')
        .select('status, completed_at, error_message')
        .eq('campaign_id', campaignId)
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRun?.status === 'completed') {
        return NextResponse.json({
          status: 'insufficient_data',
          model: { key: profile.key, displayName: profile.displayName, version: GRID_SCORE_MODEL_VERSION },
          overall: {
            score: null,
            confidence: 0,
            confidenceLabel: 'very_low',
            targetHomeCount: queuedTargetHomeCount,
            explanation: 'Campaign homes need valid coordinates before Territory IQ can score this area.',
            benchmark: 'campaign area',
            calculatedAt: latestRun.completed_at,
          },
          factors: [],
          cells: { type: 'FeatureCollection', features: [] },
          sources: [],
          insights: [],
          missingFactors: [],
          retryMessage: 'Refresh after campaign map preparation completes.',
        });
      }
      if (latestRun?.status === 'failed') {
        return NextResponse.json({
          status: 'failed',
          model: { key: profile.key, displayName: profile.displayName, version: GRID_SCORE_MODEL_VERSION },
          overall: {
            score: null,
            confidence: 0,
            confidenceLabel: 'very_low',
            targetHomeCount: queuedTargetHomeCount,
            explanation: 'Territory IQ could not safely calculate this campaign.',
            benchmark: 'campaign area',
            calculatedAt: latestRun.completed_at,
          },
          factors: [],
          cells: { type: 'FeatureCollection', features: [] },
          sources: [],
          insights: [],
          missingFactors: [],
          retryMessage: 'An owner or admin can retry the calculation.',
        });
      }
      await new TerritoryIQService(admin).enqueue(campaignId, user.id);
    }
    if (!score) {
      return NextResponse.json({
        status: 'queued',
        model: { key: profile.key, displayName: profile.displayName, version: GRID_SCORE_MODEL_VERSION },
        overall: {
          score: null,
          confidence: 0,
          confidenceLabel: 'very_low',
          targetHomeCount: queuedTargetHomeCount,
          explanation: 'Territory IQ is preparing this campaign.',
          benchmark: 'campaign area',
          calculatedAt: null,
        },
        factors: [],
        cells: { type: 'FeatureCollection', features: [] },
        sources: [],
        insights: [],
        missingFactors: [],
        retryMessage: 'Check again shortly.',
      });
    }
    const { data: cells } = await admin
      .from('campaign_territory_iq_cells')
      .select('cell_key, geom, target_home_count, target_address_ids, score, confidence, confidence_label, rank, factors, census_dguid')
      .eq('score_id', score.id)
      .order('rank', { ascending: true, nullsFirst: false });
    const scope = await assignedAddressScope(
      admin,
      campaignId,
      campaign.workspace_id,
      user.id,
      workspace?.owner_id ?? null
    );
    const response = responseFromRows(score as ScoreRow, (cells ?? []) as CellRow[], scope);
    const { data: latestRun } = await admin
      .from('territory_iq_score_runs')
      .select('status, queued_at')
      .eq('campaign_id', campaignId)
      .in('status', ['queued', 'processing'])
      .order('queued_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      latestRun &&
      Date.parse(latestRun.queued_at) > Date.parse(score.calculated_at)
    ) {
      response.status = latestRun.status as 'queued' | 'processing';
      response.retryMessage = 'A newer GRID SCORE is being calculated.';
    }
    return NextResponse.json(response);
  } catch (error) {
    console.error('[territory-iq] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Territory IQ failed safely' },
      { status: 500 }
    );
  }
}
