import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionStartBody = {
  campaignId?: string | null;
  workspaceId?: string | null;
  routeAssignmentId?: string | null;
  farmId?: string | null;
  farmTouchId?: string | null;
  mode?: string | null;
  goalType?: string | null;
  goalAmount?: number | null;
  notes?: string | null;
  startedAtEpochMs?: number | null;
};

function isMissingColumn(error: unknown, table: string, column: string) {
  if (!error || typeof error !== 'object') return false;
  const text = `${(error as { message?: string }).message ?? ''} ${(error as { details?: string | null }).details ?? ''}`.toLowerCase();
  return text.includes(table) && text.includes(column) && text.includes('does not exist');
}

function emptyLineStringGeoJson() {
  return JSON.stringify({ type: 'LineString', coordinates: [] });
}

async function resolveCampaignScopedWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string | undefined,
  userId: string
): Promise<string | null> {
  if (!campaignId) return null;
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, owner_id, workspace_id')
    .eq('id', campaignId)
    .maybeSingle();
  const campaignRow = campaign as { owner_id?: string | null; workspace_id?: string | null } | null;
  if (!campaignRow?.workspace_id) return null;
  if (campaignRow.owner_id === userId) return campaignRow.workspace_id;

  const [{ data: workspaceMember }, { data: campaignMember }] = await Promise.all([
    admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', campaignRow.workspace_id)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('campaign_members')
      .select('user_id')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  return workspaceMember || campaignMember ? campaignRow.workspace_id : null;
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SessionStartBody;
  const campaignId = typeof body.campaignId === 'string' && body.campaignId.trim()
    ? body.campaignId.trim()
    : null;

  const admin = createAdminClient();
  const requestedWorkspaceId =
    typeof body.workspaceId === 'string' && body.workspaceId.trim()
      ? body.workspaceId.trim()
      : null;
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );
  const campaignScopedWorkspaceId = !workspace.workspaceId && campaignId
    ? await resolveCampaignScopedWorkspace(admin, campaignId, requestUser.id)
    : null;
  const resolvedWorkspaceId = workspace.workspaceId ?? campaignScopedWorkspaceId;
  if (!resolvedWorkspaceId) {
    return NextResponse.json({ error: workspace.error ?? 'Workspace not found' }, { status: workspace.status ?? 403 });
  }

  const startedAt =
    typeof body.startedAtEpochMs === 'number' && Number.isFinite(body.startedAtEpochMs)
      ? new Date(body.startedAtEpochMs)
      : new Date();
  const goalAmount = body.goalAmount == null ? 0 : Math.max(0, Number(body.goalAmount) || 0);
  const sessionInsert = {
    workspace_id: resolvedWorkspaceId,
    user_id: requestUser.id,
    campaign_id: campaignId,
    route_assignment_id: body.routeAssignmentId ?? null,
    farm_id: body.farmId ?? null,
    farm_touch_id: body.farmTouchId ?? null,
    start_time: startedAt.toISOString(),
    end_time: null as string | null,
    goal_type: body.goalType ?? 'doors',
    goal_amount: goalAmount,
    notes: body.notes ?? null,
    session_mode: body.mode ?? 'door_knocking',
    active_seconds: 0,
    distance_meters: 0,
    doors_hit: 0,
    conversations: 0,
    leads_created: 0,
    flyers_delivered: 0,
    path_geojson: emptyLineStringGeoJson(),
  };

  let result = await admin.from('sessions').insert(sessionInsert).select('id').single();
  let routeAssignmentColumnMissing = false;
  if (result.error && isMissingColumn(result.error, 'sessions', 'route_assignment_id')) {
    routeAssignmentColumnMissing = true;
    const fallback: Partial<typeof sessionInsert> = { ...sessionInsert };
    delete fallback.route_assignment_id;
    result = await admin.from('sessions').insert(fallback).select('id').single();
  }
  if (result.error && isMissingColumn(result.error, 'sessions', 'leads_created')) {
    const fallback: Partial<typeof sessionInsert> = { ...sessionInsert };
    if (routeAssignmentColumnMissing) delete fallback.route_assignment_id;
    delete fallback.leads_created;
    result = await admin.from('sessions').insert(fallback).select('id').single();
  }

  if (result.error || !result.data?.id) {
    return NextResponse.json(
      { error: result.error?.message ?? 'Unable to start session' },
      { status: 500 }
    );
  }

  if (campaignId) {
    const joinedAt = new Date().toISOString();
    const participantUpsert = await admin.from('session_participants').upsert(
      {
        session_id: result.data.id,
        campaign_id: campaignId,
        user_id: requestUser.id,
        role: 'host',
        joined_at: joinedAt,
        left_at: null,
        last_seen_at: joinedAt,
      },
      { onConflict: 'session_id,user_id' }
    );
    if (participantUpsert.error) {
      console.warn('[api/sessions/start] participant upsert failed', participantUpsert.error);
    }
  }

  return NextResponse.json({
    success: true,
    session_id: result.data.id,
    sessionId: result.data.id,
    workspace_id: resolvedWorkspaceId,
    workspaceId: resolvedWorkspaceId,
  });
}
