import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';

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
    const resolution = await resolveTeamDashboardMode(supabase as any, user.id, workspaceId);
    if (resolution.error || !resolution.workspaceId || resolution.mode !== 'team_owner') {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));

    const { data, error } = await authClient.rpc('get_team_leaderboard', {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
    });

    if (error) {
      console.error('[team/leaderboard] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as { error?: string } | unknown[];
    if (result && typeof result === 'object' && 'error' in result && (result as { error: string }).error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = Array.isArray(result) ? result : [];
    const inactiveMembers = rows.filter((row) => {
      const item = row as { sessions_count?: number; last_active_at?: string | null };
      return (item.sessions_count ?? 0) === 0 || !item.last_active_at;
    });
    const summaryCards = rows.reduce(
      (acc, row) => {
        const item = row as {
          doors_knocked?: number;
          conversations?: number;
          flyers_delivered?: number;
          sessions_count?: number;
          total_duration_seconds?: number;
          distance_meters?: number;
        };
        acc.doors += item.doors_knocked ?? 0;
        acc.conversations += item.conversations ?? 0;
        acc.flyers_delivered += item.flyers_delivered ?? 0;
        acc.sessions_count += item.sessions_count ?? 0;
        acc.total_duration_seconds += item.total_duration_seconds ?? 0;
        acc.distance_meters += item.distance_meters ?? 0;
        return acc;
      },
      { doors: 0, conversations: 0, flyers_delivered: 0, sessions_count: 0, total_duration_seconds: 0, distance_meters: 0 }
    );

    return NextResponse.json({
      rows,
      inactiveMembers,
      summaryCards,
      trend: null,
    });
  } catch (err) {
    console.error('[team/leaderboard] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
