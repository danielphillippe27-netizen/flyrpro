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

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  const now = new Date();
  const ms = now.getTime() - then.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
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

    const { data, error } = await authClient.rpc('get_team_members_with_stats', {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
    });

    if (error) {
      console.error('[team/members] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const raw = data as { error?: string } | unknown[];
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'error' in raw && (raw as { error: string }).error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const list = Array.isArray(raw) ? raw : [];
    const members = list.map((row: Record<string, unknown>) => {
      const last = (row.last_active_at as string) ?? null;
      return {
        user_id: row.user_id,
        display_name: row.display_name ?? 'Member',
        role: row.role,
        color: row.color ?? '#3B82F6',
        last_active_at: last,
        inactive_days: daysSince(last),
        doors_knocked: row.doors_knocked ?? 0,
        conversations: row.conversations ?? 0,
        flyers_delivered: row.flyers_delivered ?? 0,
        followups: row.followups ?? 0,
        appointments: row.appointments ?? 0,
        sessions_count: row.sessions_count ?? 0,
        active_days: row.active_days ?? 0,
      };
    });

    return NextResponse.json({ members });
  } catch (err) {
    console.error('[team/members] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
