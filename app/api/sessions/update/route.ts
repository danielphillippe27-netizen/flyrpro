import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionUpdateBody = {
  sessionId?: string | null;
  campaignId?: string | null;
  workspaceId?: string | null;
  routeAssignmentId?: string;
  farmId?: string;
  farmTouchId?: string;
  mode?: string;
  goalType?: string | null;
  goalAmount?: number | null;
  notes?: string | null;
  endedReason?: string | null;
  path?: Array<{ latitude: number; longitude: number; timestampEpochMs?: number | null; accuracyMeters?: number | null }>;
  distanceMeters?: number;
  elapsedSeconds?: number;
  doorsHit?: number;
  flyersDelivered?: number;
  conversations?: number;
  leadsCreated?: number;
  endSession?: boolean;
  autoConfirmedCount?: number;
  averageAccuracyMeters?: number | null;
};

function isMissingColumn(error: unknown, table: string, column: string) {
  if (!error || typeof error !== 'object') return false;
  const text = `${(error as { message?: string }).message ?? ''} ${(error as { details?: string | null }).details ?? ''}`.toLowerCase();
  return text.includes(table) && text.includes(column) && text.includes('does not exist');
}

function lineStringGeoJson(path: Array<{ latitude: number; longitude: number }> | undefined) {
  const coordinates = (path ?? [])
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .map((point) => [point.longitude, point.latitude]);
  if (coordinates.length < 2) return null;
  return JSON.stringify({ type: 'LineString', coordinates });
}

function emptyLineStringGeoJson() {
  return JSON.stringify({ type: 'LineString', coordinates: [] });
}

async function resolveCampaignScopedWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string | null | undefined,
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

  const [{ data: workspaceMember }, { data: campaignMember }, { data: participant }] =
    await Promise.all([
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
      admin
        .from('session_participants')
        .select('user_id')
        .eq('campaign_id', campaignId)
        .eq('user_id', userId)
        .is('left_at', null)
        .maybeSingle(),
    ]);

  return workspaceMember || campaignMember || participant ? campaignRow.workspace_id : null;
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SessionUpdateBody;
  const admin = createAdminClient();
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    typeof body.workspaceId === 'string' && body.workspaceId.trim() ? body.workspaceId.trim() : null
  );
  const campaignScopedWorkspaceId = !workspace.workspaceId
    ? await resolveCampaignScopedWorkspace(admin, body.campaignId, requestUser.id)
    : null;
  const resolvedWorkspaceId = workspace.workspaceId ?? campaignScopedWorkspaceId;
  if (!resolvedWorkspaceId) {
    return NextResponse.json({ error: workspace.error ?? 'Workspace not found' }, { status: workspace.status ?? 403 });
  }

  const shouldEndSession = body.endSession !== false;
  const endedAt = new Date();
  const elapsedSeconds = Math.max(0, Number(body.elapsedSeconds ?? 0) || 0);
  const startedAt = new Date(endedAt.getTime() - elapsedSeconds * 1000);
  const path = body.path ?? [];
  const touchedStops = Math.max(0, Number(body.doorsHit ?? 0) || 0);
  const goalAmount = body.goalAmount == null ? null : Math.max(0, Number(body.goalAmount) || 0);
  const autoConfirmedCount = Math.max(0, Number(body.autoConfirmedCount ?? 0) || 0);
  const averageAccuracyMeters = body.averageAccuracyMeters == null
    ? null
    : Math.max(0, Number(body.averageAccuracyMeters) || 0);
  const sessionMeta = {
    goalType: body.goalType ?? null,
    goalAmount,
    notes: body.notes ?? null,
    endedReason: body.endedReason ?? null,
    autoConfirmedCount,
    averageAccuracyMeters,
    pathSampleCount: path.length,
  };
  const sessionInsert = {
    workspace_id: resolvedWorkspaceId,
    user_id: requestUser.id,
    campaign_id: body.campaignId ?? null,
    route_assignment_id: body.routeAssignmentId ?? null,
    farm_id: body.farmId ?? null,
    farm_touch_id: body.farmTouchId ?? null,
    start_time: startedAt.toISOString(),
    end_time: endedAt.toISOString(),
    goal_type: body.goalType ?? 'doors',
    goal_amount: goalAmount ?? 0,
    notes: body.notes ?? null,
    session_mode: body.mode ?? 'door_knocking',
    active_seconds: elapsedSeconds,
    distance_meters: Number(body.distanceMeters ?? 0) || 0,
    doors_hit: touchedStops,
    conversations: Math.max(0, Number(body.conversations ?? 0) || 0),
    leads_created: Math.max(0, Number(body.leadsCreated ?? 0) || 0),
    flyers_delivered: Math.max(0, Number(body.flyersDelivered ?? 0) || 0),
    path_geojson: lineStringGeoJson(path) ?? emptyLineStringGeoJson(),
  };

  if (body.sessionId && !shouldEndSession) {
    const activeUpdate = {
      workspace_id: resolvedWorkspaceId,
      campaign_id: body.campaignId ?? null,
      route_assignment_id: body.routeAssignmentId ?? null,
      farm_id: body.farmId ?? null,
      farm_touch_id: body.farmTouchId ?? null,
      goal_type: body.goalType ?? 'doors',
      goal_amount: goalAmount ?? 0,
      notes: body.notes ?? null,
      session_mode: body.mode ?? 'door_knocking',
      active_seconds: elapsedSeconds,
      distance_meters: Number(body.distanceMeters ?? 0) || 0,
      doors_hit: touchedStops,
      conversations: Math.max(0, Number(body.conversations ?? 0) || 0),
      leads_created: Math.max(0, Number(body.leadsCreated ?? 0) || 0),
      flyers_delivered: Math.max(0, Number(body.flyersDelivered ?? 0) || 0),
      path_geojson: lineStringGeoJson(path) ?? emptyLineStringGeoJson(),
      updated_at: endedAt.toISOString(),
    };

    let activeResult = await admin
      .from('sessions')
      .update(activeUpdate)
      .eq('id', body.sessionId)
      .eq('user_id', requestUser.id)
      .select('id')
      .maybeSingle();
    if (activeResult.error && isMissingColumn(activeResult.error, 'sessions', 'route_assignment_id')) {
      const fallback: Partial<typeof activeUpdate> = { ...activeUpdate };
      delete fallback.route_assignment_id;
      activeResult = await admin
        .from('sessions')
        .update(fallback)
        .eq('id', body.sessionId)
        .eq('user_id', requestUser.id)
        .select('id')
        .maybeSingle();
    }
    if (activeResult.error && isMissingColumn(activeResult.error, 'sessions', 'leads_created')) {
      const fallback: Partial<typeof activeUpdate> = { ...activeUpdate };
      delete fallback.leads_created;
      activeResult = await admin
        .from('sessions')
        .update(fallback)
        .eq('id', body.sessionId)
        .eq('user_id', requestUser.id)
        .select('id')
        .maybeSingle();
    }
    if (activeResult.error) {
      return NextResponse.json({ error: activeResult.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sessionId: activeResult.data?.id ?? body.sessionId });
  }

  let result = body.sessionId
    ? await admin
        .from('sessions')
        .update({
          workspace_id: resolvedWorkspaceId,
          campaign_id: body.campaignId ?? null,
          route_assignment_id: body.routeAssignmentId ?? null,
          farm_id: body.farmId ?? null,
          farm_touch_id: body.farmTouchId ?? null,
          end_time: endedAt.toISOString(),
          goal_type: body.goalType ?? 'doors',
          goal_amount: goalAmount ?? 0,
          notes: body.notes ?? null,
          session_mode: body.mode ?? 'door_knocking',
          active_seconds: elapsedSeconds,
          distance_meters: Number(body.distanceMeters ?? 0) || 0,
          doors_hit: touchedStops,
          conversations: Math.max(0, Number(body.conversations ?? 0) || 0),
          leads_created: Math.max(0, Number(body.leadsCreated ?? 0) || 0),
          flyers_delivered: Math.max(0, Number(body.flyersDelivered ?? 0) || 0),
          path_geojson: lineStringGeoJson(path) ?? emptyLineStringGeoJson(),
          updated_at: endedAt.toISOString(),
        })
        .eq('id', body.sessionId)
        .eq('user_id', requestUser.id)
        .select('id')
        .maybeSingle()
    : await admin.from('sessions').insert(sessionInsert).select('id').single();
  if (body.sessionId && !result.error && !result.data) {
    result = await admin.from('sessions').insert(sessionInsert).select('id').single();
  }
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
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const [statsRefresh, leaderboardRefresh] = await Promise.all([
    admin.rpc('refresh_user_stats_from_sessions', { p_user_id: requestUser.id }),
    admin.rpc('refresh_leaderboard_rollups_for_user', { p_user_id: requestUser.id }),
  ]);
  if (statsRefresh.error) {
    console.warn('[api/sessions/update] user stats refresh failed', statsRefresh.error);
  }
  if (leaderboardRefresh.error) {
    console.warn('[api/sessions/update] leaderboard rollup refresh failed', leaderboardRefresh.error);
  }

  if (body.routeAssignmentId) {
    const { error: assignmentError } = await admin
      .from('route_assignments')
      .update({
        status: 'completed',
        completed_at: endedAt.toISOString(),
        progress: {
          doorsHit: touchedStops,
          flyersDelivered: Math.max(0, Number(body.flyersDelivered ?? 0) || 0),
          conversations: Math.max(0, Number(body.conversations ?? 0) || 0),
          leadsCreated: Math.max(0, Number(body.leadsCreated ?? 0) || 0),
          distanceMeters: Number(body.distanceMeters ?? 0) || 0,
          elapsedSeconds,
          ...sessionMeta,
          sessionId: result.data?.id ?? null,
        },
        updated_at: endedAt.toISOString(),
      })
      .eq('id', body.routeAssignmentId)
      .eq('workspace_id', resolvedWorkspaceId)
      .eq('assigned_to_user_id', requestUser.id);

    if (assignmentError) {
      console.warn('[api/sessions/update] route assignment progress update failed', assignmentError);
    }
  }

  if (body.farmId) {
    const touchUpdates = {
      status: 'completed',
      completed: true,
      completed_at: endedAt.toISOString(),
      last_completed_at: endedAt.toISOString(),
      completed_by_user_id: requestUser.id,
      homes_reached: touchedStops,
      session_id: result.data?.id ?? null,
      execution_metrics: {
        doorsHit: touchedStops,
        flyersDelivered: Math.max(0, Number(body.flyersDelivered ?? 0) || 0),
        conversations: Math.max(0, Number(body.conversations ?? 0) || 0),
        leadsCreated: Math.max(0, Number(body.leadsCreated ?? 0) || 0),
        distanceMeters: Number(body.distanceMeters ?? 0) || 0,
        elapsedSeconds,
        ...sessionMeta,
      },
      updated_at: endedAt.toISOString(),
    };

    let touchQuery = admin
      .from('farm_touches')
      .update(touchUpdates)
      .eq('farm_id', body.farmId)
      .eq('workspace_id', resolvedWorkspaceId);

    if (body.farmTouchId) {
      touchQuery = touchQuery.eq('id', body.farmTouchId);
    } else {
      touchQuery = touchQuery
        .neq('status', 'completed')
        .order('scheduled_date', { ascending: true })
        .limit(1);
    }

    const { error: touchError } = await touchQuery;

    if (touchError) {
      console.warn('[api/sessions/update] farm touch progress update failed', touchError);
    }
  }

  return NextResponse.json({ ok: true, sessionId: result.data?.id ?? null });
}
