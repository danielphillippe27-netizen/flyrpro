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
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '500', 10) || 500));
    const mode = searchParams.get('mode') === 'knocked_homes' ? 'knocked_homes' : 'routes';

    const { data, error } = await authClient.rpc('get_team_map_data', {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
      p_mode: mode,
      p_limit_sessions: limit,
    });

    if (error) {
      console.error('[team/map] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
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
