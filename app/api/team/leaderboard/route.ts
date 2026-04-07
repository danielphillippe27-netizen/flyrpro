import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type TeamLeaderboardRow = {
  user_id: string;
  display_name: string;
  color?: string | null;
  doors_knocked?: number;
  conversations?: number;
  flyers_delivered?: number;
  sessions_count?: number;
  active_days?: number;
  total_duration_seconds?: number;
  distance_meters?: number;
  last_active_at?: string | null;
};

type WorkspaceMemberRow = {
  user_id: string;
  color: string | null;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type SessionRow = {
  user_id: string | null;
  doors_hit: number | null;
  conversations: number | null;
  flyers_delivered: number | null;
  active_seconds: number | null;
  distance_meters: number | null;
  start_time: string | null;
};

type TeamLeaderboardDiagnostics = {
  source: 'sessions' | 'user_stats_fallback';
  message: string | null;
  member_count: number;
  workspace_session_count: number;
  member_unscoped_session_count: number;
  member_other_workspace_session_count: number;
};

function parseRange(start?: string | null, end?: string | null): { start: string; end: string } {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate: Date;
  if (start) {
    startDate = new Date(start);
  } else {
    startDate = new Date(0);
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

function toNumber(value: unknown): number {
  return Number(value) || 0;
}

function buildDisplayName(profile?: ProfileRow): string {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName || 'Member';
}

async function buildMemberVisibleLeaderboardRows(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  start: string,
  end: string
): Promise<TeamLeaderboardRow[]> {
  const { data: workspaceMembers, error: workspaceMembersError } = await supabase
    .from('workspace_members')
    .select('user_id, color')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (workspaceMembersError) {
    throw workspaceMembersError;
  }

  const members = (workspaceMembers ?? []) as WorkspaceMemberRow[];
  const memberIds = members.map((row) => row.user_id).filter(Boolean);
  if (memberIds.length === 0) {
    return [];
  }

  const [profilesRes, sessionsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', memberIds),
    supabase
      .from('sessions')
      .select('user_id, doors_hit, conversations, flyers_delivered, active_seconds, distance_meters, start_time')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .gte('start_time', start)
      .lte('start_time', end)
      .order('start_time', { ascending: false }),
  ]);

  if (profilesRes.error) {
    throw profilesRes.error;
  }
  if (sessionsRes.error) {
    throw sessionsRes.error;
  }

  const profileByUserId = new Map(
    ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
  );

  const totalsByUserId = new Map<
    string,
    {
      doors_knocked: number;
      conversations: number;
      flyers_delivered: number;
      sessions_count: number;
      total_duration_seconds: number;
      distance_meters: number;
      last_active_at: string | null;
    }
  >();

  for (const session of (sessionsRes.data ?? []) as SessionRow[]) {
    if (!session.user_id) continue;
    const existing = totalsByUserId.get(session.user_id) ?? {
      doors_knocked: 0,
      conversations: 0,
      flyers_delivered: 0,
      sessions_count: 0,
      total_duration_seconds: 0,
      distance_meters: 0,
      last_active_at: null,
    };
    totalsByUserId.set(session.user_id, {
      doors_knocked: existing.doors_knocked + toNumber(session.doors_hit),
      conversations: existing.conversations + toNumber(session.conversations),
      flyers_delivered: existing.flyers_delivered + toNumber(session.flyers_delivered),
      sessions_count: existing.sessions_count + 1,
      total_duration_seconds: existing.total_duration_seconds + toNumber(session.active_seconds),
      distance_meters: existing.distance_meters + toNumber(session.distance_meters),
      last_active_at: existing.last_active_at ?? (session.start_time ?? null),
    });
  }

  return members
    .map((member) => {
      const totals = totalsByUserId.get(member.user_id);
      return {
        user_id: member.user_id,
        display_name: buildDisplayName(profileByUserId.get(member.user_id)),
        color: member.color ?? '#3B82F6',
        doors_knocked: totals?.doors_knocked ?? 0,
        conversations: totals?.conversations ?? 0,
        flyers_delivered: totals?.flyers_delivered ?? 0,
        sessions_count: totals?.sessions_count ?? 0,
        total_duration_seconds: totals?.total_duration_seconds ?? 0,
        distance_meters: totals?.distance_meters ?? 0,
        last_active_at: totals?.last_active_at ?? null,
      } satisfies TeamLeaderboardRow;
    })
    .sort((left, right) => {
      const doorDelta = toNumber(right.doors_knocked) - toNumber(left.doors_knocked);
      if (doorDelta !== 0) return doorDelta;
      const convoDelta = toNumber(right.conversations) - toNumber(left.conversations);
      if (convoDelta !== 0) return convoDelta;
      return (right.last_active_at ?? '').localeCompare(left.last_active_at ?? '');
    });
}

function summarizeRows(rows: TeamLeaderboardRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.doors += toNumber(row.doors_knocked);
      acc.conversations += toNumber(row.conversations);
      acc.flyers_delivered += toNumber(row.flyers_delivered);
      acc.sessions_count += toNumber(row.sessions_count);
      acc.total_duration_seconds += toNumber(row.total_duration_seconds);
      acc.distance_meters += toNumber(row.distance_meters);
      return acc;
    },
    { doors: 0, conversations: 0, flyers_delivered: 0, sessions_count: 0, total_duration_seconds: 0, distance_meters: 0 }
  );
}

function shouldUseUserStatsFallback(rows: TeamLeaderboardRow[], summary: ReturnType<typeof summarizeRows>): boolean {
  return (
    rows.length > 0 &&
    summary.sessions_count === 0 &&
    summary.doors === 0 &&
    summary.conversations === 0 &&
    summary.flyers_delivered === 0
  );
}

async function countSessionRows(
  supabase: ReturnType<typeof createAdminClient>,
  memberIds: string[],
  workspaceId: string,
  mode: 'workspace' | 'unscoped' | 'other_workspace'
): Promise<number> {
  if (memberIds.length === 0) return 0;

  let query = supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .in('user_id', memberIds);

  if (mode === 'workspace') {
    query = query.eq('workspace_id', workspaceId);
  } else if (mode === 'unscoped') {
    query = query.is('workspace_id', null);
  } else {
    query = query.not('workspace_id', 'is', null).neq('workspace_id', workspaceId);
  }

  const { count, error } = await query;
  if (error) {
    console.warn('[team/leaderboard] diagnostics session count failed:', error.message);
    return 0;
  }

  return count ?? 0;
}

async function buildFallbackRowsFromUserStats(
  supabase: ReturnType<typeof createAdminClient>,
  rows: TeamLeaderboardRow[]
): Promise<TeamLeaderboardRow[] | null> {
  const memberIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
  if (memberIds.length === 0) return null;

  const { data: statsRows, error } = await supabase
    .from('user_stats')
    .select('user_id, flyers, conversations, distance_walked, time_tracked, updated_at')
    .in('user_id', memberIds);
  if (error) {
    console.warn('[team/leaderboard] user_stats fallback query failed:', error.message);
    return null;
  }

  const statsByUser = new Map<string, Record<string, unknown>>();
  for (const stat of (statsRows ?? []) as Record<string, unknown>[]) {
    const userId = String(stat.user_id ?? '');
    if (userId) statsByUser.set(userId, stat);
  }

  let hasAnyFallbackValues = false;
  const merged = rows.map((row) => {
    const stat = statsByUser.get(row.user_id);
    if (!stat) return row;

    const doorsKnocked = toNumber(stat.flyers);
    const conversations = toNumber(stat.conversations);
    const distanceMeters = Math.round(toNumber(stat.distance_walked) * 1000);
    const durationSeconds = Math.round(toNumber(stat.time_tracked) * 60);

    if (doorsKnocked > 0 || conversations > 0 || distanceMeters > 0 || durationSeconds > 0) {
      hasAnyFallbackValues = true;
    }

    return {
      ...row,
      doors_knocked: doorsKnocked,
      conversations,
      distance_meters: distanceMeters,
      total_duration_seconds: durationSeconds,
      last_active_at: row.last_active_at ?? (typeof stat.updated_at === 'string' ? stat.updated_at : null),
    };
  });

  return hasAnyFallbackValues ? merged : null;
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
    if (resolution.error || !resolution.workspaceId || !resolution.role) {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));

    const canUseTeamOwnerRpc = resolution.mode === 'team_owner';
    let rows: TeamLeaderboardRow[] = [];

    if (canUseTeamOwnerRpc) {
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

      rows = (Array.isArray(result) ? result : []) as TeamLeaderboardRow[];
    } else {
      rows = await buildMemberVisibleLeaderboardRows(
        supabase,
        resolution.workspaceId,
        start,
        end
      );
    }

    const inactiveMembers = rows.filter((row) => {
      const item = row as { sessions_count?: number; last_active_at?: string | null };
      return (item.sessions_count ?? 0) === 0 || !item.last_active_at;
    });
    let summaryCards = summarizeRows(rows);

    const memberIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    const [workspaceSessionCount, memberUnscopedSessionCount, memberOtherWorkspaceSessionCount] = await Promise.all([
      countSessionRows(supabase, memberIds, resolution.workspaceId, 'workspace'),
      countSessionRows(supabase, memberIds, resolution.workspaceId, 'unscoped'),
      countSessionRows(supabase, memberIds, resolution.workspaceId, 'other_workspace'),
    ]);

    let diagnostics: TeamLeaderboardDiagnostics = {
      source: 'sessions',
      message: null,
      member_count: rows.length,
      workspace_session_count: workspaceSessionCount,
      member_unscoped_session_count: memberUnscopedSessionCount,
      member_other_workspace_session_count: memberOtherWorkspaceSessionCount,
    };

    if (shouldUseUserStatsFallback(rows, summaryCards)) {
      const fallbackRows = await buildFallbackRowsFromUserStats(supabase, rows);
      if (fallbackRows) {
        rows = fallbackRows;
        summaryCards = summarizeRows(rows);
        diagnostics = {
          ...diagnostics,
          source: 'user_stats_fallback',
          message:
            'Team sessions are not yet attributed to this workspace. Showing temporary totals from member lifetime stats.',
        };
      } else if (memberUnscopedSessionCount > 0 || memberOtherWorkspaceSessionCount > 0) {
        diagnostics = {
          ...diagnostics,
          source: 'sessions',
          message:
            'No sessions are currently linked to this workspace. Existing sessions were found without workspace attribution.',
        };
      }
    }

    return NextResponse.json({
      rows,
      inactiveMembers,
      summaryCards,
      diagnostics,
      trend: null,
    });
  } catch (err) {
    console.error('[team/leaderboard] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
