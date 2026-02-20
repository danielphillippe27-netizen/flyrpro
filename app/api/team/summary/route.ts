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

    const { data, error } = await authClient.rpc('get_team_dashboard_summary', {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
    });

    if (error) {
      console.error('[team/summary] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as { error?: string; totals?: Record<string, number>; previousTotals?: Record<string, number>; deltas?: Record<string, number>; doorsByDay?: Array<{ day_date?: string; doors?: number }> };
    if (result?.error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const doorsByDay = (result?.doorsByDay ?? []).map((row: { day_date?: string; doors?: number }) => ({
      date: row.day_date ?? null,
      doors: row.doors ?? 0,
    }));

    return NextResponse.json({
      period: { start, end },
      totals: result?.totals ?? { doors: 0, convos: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      previousTotals: result?.previousTotals ?? { doors: 0, convos: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      deltas: result?.deltas ?? { doors: 0, convos: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      trend: { doorsByDay },
    });
  } catch (err) {
    console.error('[team/summary] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
