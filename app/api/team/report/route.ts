import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';

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

    const userId = searchParams.get('userId') ?? user.id;
    const period = (searchParams.get('period') ?? 'weekly') as 'weekly' | 'monthly' | 'yearly';
    if (!['weekly', 'monthly', 'yearly'].includes(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const { data, error } = await authClient.rpc('get_agent_report', {
      p_workspace_id: resolution.workspaceId,
      p_user_id: userId,
      p_period: period,
    });

    if (error) {
      console.error('[team/report] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as { error?: string; buckets?: unknown[] } | Record<string, unknown>;
    if (result?.error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = (result ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      totals: {
        knocks: payload.knocks ?? 0,
        conversations: payload.conversations ?? 0,
        flyers_delivered: payload.flyers_delivered ?? 0,
        sessions_count: payload.sessions_count ?? 0,
        active_days: payload.active_days ?? 0,
        avg_knocks_per_session: payload.avg_knocks_per_session ?? 0,
      },
      buckets: Array.isArray(payload.buckets) ? payload.buckets : [],
      period_start: payload.period_start ?? null,
      period_end: payload.period_end ?? null,
    });
  } catch (err) {
    console.error('[team/report] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
