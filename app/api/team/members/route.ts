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

    const { data, error } = await authClient.rpc('get_team_members_with_stats', {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
    });

    if (error) {
      console.error('[team/members] RPC error (falling back):', error);

      const { data: memberRows, error: membersError } = await supabase
        .from('workspace_members')
        .select('user_id, role, color')
        .eq('workspace_id', resolution.workspaceId)
        .order('created_at', { ascending: true });

      if (membersError) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const rows = (memberRows ?? []) as Array<{ user_id: string; role?: string | null; color?: string | null }>;
      const userIds = rows.map((row) => row.user_id).filter(Boolean);

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

      let sessionsByUserId = new Map<string, { sessionsCount: number; lastActiveAt: string | null }>();
      try {
        const { data: sessionRows } = userIds.length
          ? await supabase
              .from('sessions')
              .select('user_id, start_time, end_time')
              .eq('workspace_id', resolution.workspaceId)
              .in('user_id', userIds)
              .gte('start_time', start)
              .lte('start_time', end)
              .order('start_time', { ascending: false })
          : { data: [] as Array<{ user_id: string; start_time: string | null; end_time: string | null }> };

        const map = new Map<string, { sessionsCount: number; lastActiveAt: string | null }>();
        for (const session of (sessionRows ?? []) as Array<{ user_id: string; start_time: string | null; end_time: string | null }>) {
          const existing = map.get(session.user_id) ?? { sessionsCount: 0, lastActiveAt: null };
          const eventTime = session.end_time ?? session.start_time ?? null;
          map.set(session.user_id, {
            sessionsCount: existing.sessionsCount + 1,
            lastActiveAt: existing.lastActiveAt ?? eventTime,
          });
        }
        sessionsByUserId = map;
      } catch {
        // Ignore session-derived stats in fallback when sessions schema differs.
      }

      const members = rows.map((row) => {
        const profile = profileByUserId.get(row.user_id);
        const fullName = [profile?.first_name, profile?.last_name]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join(' ')
          .trim();
        const sessionInfo = sessionsByUserId.get(row.user_id);
        const last = sessionInfo?.lastActiveAt ?? null;
        return {
          user_id: row.user_id,
          display_name: fullName || 'Member',
          role: row.role ?? null,
          color: row.color ?? '#3B82F6',
          last_active_at: last,
          inactive_days: daysSince(last),
          doors_knocked: 0,
          conversations: 0,
          flyers_delivered: 0,
          followups: 0,
          appointments: 0,
          sessions_count: sessionInfo?.sessionsCount ?? 0,
          active_days: 0,
        };
      });

      return NextResponse.json({
        members,
        degraded: true,
      });
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
