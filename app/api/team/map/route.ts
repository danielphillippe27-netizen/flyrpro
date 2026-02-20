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
    const mode = searchParams.get('mode') === 'knocked_homes' ? 'knocked_homes' : 'routes';

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

      const { data: memberRows } = await supabase
        .from('workspace_members')
        .select('user_id, color')
        .eq('workspace_id', resolution.workspaceId)
        .order('created_at', { ascending: true });

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

      const members = ((memberRows ?? []) as Array<{ user_id: string; color: string | null }>).map((row) => {
        const profile = profileByUserId.get(row.user_id);
        const displayName = [profile?.first_name, profile?.last_name]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join(' ')
          .trim();
        return {
          user_id: row.user_id,
          display_name: displayName || 'Member',
          color: row.color ?? '#3B82F6',
        };
      });

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
