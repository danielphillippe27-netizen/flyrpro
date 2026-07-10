import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

function parseRange(start?: string | null, end?: string | null): { start: string; end: string } {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate: Date;
  if (start) {
    startDate = new Date(start);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setUTCHours(0, 0, 0, 0);
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

type TeamMapMode = 'routes' | 'knocked_homes' | 'live';

function resolveMode(value: string | null): TeamMapMode {
  if (value === 'knocked_homes' || value === 'live') return value;
  return 'routes';
}

function displayNameFromProfile(profile?: { first_name: string | null; last_name: string | null } | null): string {
  const displayName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return displayName || 'Member';
}

async function loadTeamMembers(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  const { data: memberRows, error } = await supabase
    .from('workspace_members')
    .select('user_id, color')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const userIds = ((memberRows ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
  const { data: profiles } = userIds.length
    ? await supabase
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> };

  const profileByUserId = new Map(
    ((profiles ?? []) as Array<{ user_id: string; first_name: string | null; last_name: string | null }>).map(
      (profile) => [profile.user_id, profile]
    )
  );

  return ((memberRows ?? []) as Array<{ user_id: string; color: string | null }>).map((row) => ({
    user_id: row.user_id,
    display_name: displayNameFromProfile(profileByUserId.get(row.user_id)),
    color: row.color ?? '#3B82F6',
  }));
}

async function loadLivePresence(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  const members = await loadTeamMembers(supabase, workspaceId);
  const memberByUserId = new Map(members.map((member) => [member.user_id, member]));

  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('id, title, name')
    .eq('workspace_id', workspaceId);

  if (campaignsError) throw campaignsError;

  const campaignRows = (campaigns ?? []) as Array<{ id: string; title: string | null; name: string | null }>;
  const campaignIds = campaignRows.map((campaign) => campaign.id);
  if (campaignIds.length === 0) {
    return { members, livePresence: [] };
  }

  const campaignById = new Map(campaignRows.map((campaign) => [campaign.id, campaign]));
  const freshnessCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: presenceRows, error: presenceError } = await supabase
    .from('campaign_presence')
    .select('campaign_id, user_id, session_id, lat, lng, status, updated_at')
    .in('campaign_id', campaignIds)
    .gte('updated_at', freshnessCutoff)
    .neq('status', 'inactive')
    .order('updated_at', { ascending: false });

  if (presenceError) throw presenceError;

  const validPresence = ((presenceRows ?? []) as Array<{
    campaign_id: string;
    user_id: string;
    session_id: string | null;
    lat: number | null;
    lng: number | null;
    status: string | null;
    updated_at: string | null;
  }>).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));

  const sessionIds = Array.from(
    new Set(validPresence.map((row) => row.session_id).filter((id): id is string => typeof id === 'string' && id.length > 0))
  );
  const { data: sessions } = sessionIds.length
    ? await supabase
        .from('sessions')
        .select('id, user_id, campaign_id, start_time, active_seconds, distance_meters, doors_hit, conversations, flyers_delivered')
        .eq('workspace_id', workspaceId)
        .is('end_time', null)
        .in('id', sessionIds)
    : { data: [] as Array<Record<string, unknown>> };

  const sessionById = new Map(((sessions ?? []) as Array<Record<string, unknown>>).map((session) => [String(session.id), session]));

  // Only surface agents who have a currently active (non-ended) session.
  // The presence write endpoint already requires a sessionId, so null means
  // legacy/test data — exclude it here too.
  const presenceWithActiveSession = validPresence.filter(
    (row) => typeof row.session_id === 'string' && row.session_id.length > 0 && sessionById.has(row.session_id)
  );

  return {
    members,
    livePresence: presenceWithActiveSession.map((row) => {
      const member = memberByUserId.get(row.user_id);
      const campaign = campaignById.get(row.campaign_id);
      const session = row.session_id ? sessionById.get(row.session_id) : null;
      return {
        user_id: row.user_id,
        display_name: member?.display_name ?? 'Member',
        color: member?.color ?? '#3B82F6',
        campaign_id: row.campaign_id,
        campaign_name: campaign?.title || campaign?.name || 'Campaign',
        session_id: row.session_id,
        lat: row.lat,
        lng: row.lng,
        status: row.status ?? 'active',
        updated_at: row.updated_at,
        started_at: typeof session?.start_time === 'string' ? session.start_time : null,
        active_seconds: Number(session?.active_seconds ?? 0) || 0,
        distance_meters: Number(session?.distance_meters ?? 0) || 0,
        doors_hit: Number(session?.doors_hit ?? 0) || 0,
        conversations: Number(session?.conversations ?? 0) || 0,
        flyers_delivered: Number(session?.flyers_delivered ?? 0) || 0,
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const resolution = await resolveTeamDashboardMode(
      supabase as unknown as MinimalSupabaseClient,
      user.id,
      workspaceId
    );
    if (resolution.error || !resolution.workspaceId || resolution.mode !== 'team_owner') {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '500', 10) || 500));
    const mode = resolveMode(searchParams.get('mode'));

    if (mode === 'live') {
      const live = await loadLivePresence(supabase, resolution.workspaceId);
      return NextResponse.json({
        members: live.members,
        sessions: [],
        knockPoints: [],
        livePresence: live.livePresence,
      });
    }

    const rpcArgs = {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
      p_mode: mode,
      p_limit_sessions: limit,
    };

    let { data, error } = await authClient.rpc('get_team_map_data', rpcArgs);

    const missingModeSignature =
      !!error &&
      typeof error.message === 'string' &&
      error.message.includes('get_team_map_data') &&
      error.message.includes('p_mode');

    // Backward compatibility: older DBs exposed get_team_map_data(workspace_id, start, end, limit).
    if (missingModeSignature) {
      const legacy = await authClient.rpc('get_team_map_data', {
        p_workspace_id: resolution.workspaceId,
        p_start_ts: start,
        p_end_ts: end,
        p_limit_sessions: limit,
      });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      console.error('[team/map] RPC error (falling back):', error);

      const members = await loadTeamMembers(supabase, resolution.workspaceId);

      let sessions: Array<Record<string, unknown>> = [];
      try {
        const { data: sessionRows } = await supabase
          .from('sessions')
          .select('id, user_id, start_time, end_time, active_seconds, distance_meters, doors_hit, conversations, flyers_delivered, path_geojson')
          .eq('workspace_id', resolution.workspaceId)
          .gte('start_time', start)
          .lte('start_time', end)
          .order('start_time', { ascending: false })
          .limit(limit);
        sessions = ((sessionRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
          session_id: row.id,
          user_id: row.user_id,
          started_at: row.start_time,
          ended_at: row.end_time,
          duration_seconds: row.active_seconds ?? 0,
          distance_meters: row.distance_meters ?? 0,
          doors_hit: row.doors_hit ?? 0,
          conversations: row.conversations ?? 0,
          flyers_delivered: row.flyers_delivered ?? 0,
          path_geojson: row.path_geojson ?? null,
        }));
      } catch {
        sessions = [];
      }

      let knockPoints: Array<Record<string, unknown>> = [];
      try {
        const { data: knockRows } = await supabase
          .from('session_events')
          .select('id, user_id, event_time, event_type, payload')
          .eq('workspace_id', resolution.workspaceId)
          .eq('event_type', 'knock')
          .gte('event_time', start)
          .lte('event_time', end)
          .order('event_time', { ascending: false });
        knockPoints = (knockRows ?? []) as Array<Record<string, unknown>>;
      } catch {
        knockPoints = [];
      }

      return NextResponse.json({
        members,
        sessions,
        knockPoints,
        degraded: true,
      });
    }

    const result = data as { error?: string; members?: unknown[]; sessions?: unknown[]; knockPoints?: unknown[] };
    if (result?.error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      members: result?.members ?? [],
      sessions: result?.sessions ?? [],
      knockPoints: result?.knockPoints ?? [],
    });
  } catch (err) {
    console.error('[team/map] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
