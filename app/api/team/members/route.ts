import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type WorkspaceMemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | null;
  color: string | null;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  weekly_door_goal: number | null;
  weekly_sessions_goal: number | null;
  weekly_minutes_goal: number | null;
};

type SessionRow = {
  id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  doors_hit: number | null;
  conversations: number | null;
  flyers_delivered: number | null;
  active_seconds: number | null;
};

type AppointmentRow = {
  user_id: string | null;
};

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

function isMissingRelation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  return error.message.toLowerCase().includes(`relation "${relation}" does not exist`);
}

function buildDisplayName(profile?: ProfileRow | null): string {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName || 'Member';
}

function compareRows(
  left: { doors_knocked: number; conversations: number; last_active_at: string | null },
  right: { doors_knocked: number; conversations: number; last_active_at: string | null }
) {
  if (right.doors_knocked !== left.doors_knocked) {
    return right.doors_knocked - left.doors_knocked;
  }

  if (right.conversations !== left.conversations) {
    return right.conversations - left.conversations;
  }

  return (right.last_active_at ?? '').localeCompare(left.last_active_at ?? '');
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
    const startDate = new Date(start);
    const endDate = new Date(end);
    const intervalMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const previousStart = new Date(startDate.getTime() - intervalMs).toISOString();
    const previousEnd = startDate.toISOString();
    const liveWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: workspaceMemberRows, error: workspaceMembersError } = await supabase
      .from('workspace_members')
      .select('user_id, role, color')
      .eq('workspace_id', resolution.workspaceId)
      .order('created_at', { ascending: true });

    if (workspaceMembersError) {
      console.error('[team/members] workspace_members error:', workspaceMembersError);
      return NextResponse.json({ error: workspaceMembersError.message }, { status: 500 });
    }

    const members = (workspaceMemberRows ?? []) as WorkspaceMemberRow[];
    const userIds = members.map((row) => row.user_id).filter(Boolean);

    if (userIds.length === 0) {
      return NextResponse.json({ members: [] });
    }

    const [profilesRes, currentSessionsRes, previousSessionsRes, liveSessionsRes, appointmentsRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id, first_name, last_name, weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
        .in('user_id', userIds),
      supabase
        .from('sessions')
        .select('id, user_id, start_time, end_time, doors_hit, conversations, flyers_delivered, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .in('user_id', userIds)
        .gte('start_time', start)
        .lte('start_time', end)
        .order('start_time', { ascending: false }),
      supabase
        .from('sessions')
        .select('id, user_id, start_time, end_time, doors_hit, conversations, flyers_delivered, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .in('user_id', userIds)
        .gte('start_time', previousStart)
        .lt('start_time', previousEnd)
        .order('start_time', { ascending: false }),
      supabase
        .from('sessions')
        .select('id, user_id, start_time, end_time, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .in('user_id', userIds)
        .is('end_time', null)
        .gte('start_time', liveWindowStart)
        .order('start_time', { ascending: false }),
      supabase
        .from('crm_events')
        .select('user_id')
        .in('user_id', userIds)
        .not('fub_appointment_id', 'is', null)
        .gte('created_at', start)
        .lte('created_at', end),
    ]);

    if (profilesRes.error) {
      console.error('[team/members] user_profiles error:', profilesRes.error);
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    if (currentSessionsRes.error) {
      console.error('[team/members] current sessions error:', currentSessionsRes.error);
      return NextResponse.json({ error: currentSessionsRes.error.message }, { status: 500 });
    }

    if (previousSessionsRes.error) {
      console.error('[team/members] previous sessions error:', previousSessionsRes.error);
      return NextResponse.json({ error: previousSessionsRes.error.message }, { status: 500 });
    }

    if (liveSessionsRes.error) {
      console.error('[team/members] live sessions error:', liveSessionsRes.error);
      return NextResponse.json({ error: liveSessionsRes.error.message }, { status: 500 });
    }

    if (appointmentsRes.error && !isMissingRelation(appointmentsRes.error, 'crm_events')) {
      console.error('[team/members] crm_events error:', appointmentsRes.error);
      return NextResponse.json({ error: appointmentsRes.error.message }, { status: 500 });
    }

    const profileByUserId = new Map(
      ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
    );

    const currentTotalsByUserId = new Map<
      string,
      {
        doors_knocked: number;
        conversations: number;
        flyers_delivered: number;
        sessions_count: number;
        active_days: number;
        total_duration_seconds: number;
        last_active_at: string | null;
        best_day_doors: number;
        best_day_date: string | null;
      }
    >();
    const currentDayBucketsByUserId = new Map<string, Map<string, number>>();

    for (const session of (currentSessionsRes.data ?? []) as SessionRow[]) {
      if (!session.user_id) continue;
      const existing = currentTotalsByUserId.get(session.user_id) ?? {
        doors_knocked: 0,
        conversations: 0,
        flyers_delivered: 0,
        sessions_count: 0,
        active_days: 0,
        total_duration_seconds: 0,
        last_active_at: null,
        best_day_doors: 0,
        best_day_date: null,
      };

      const eventTime = session.end_time ?? session.start_time ?? null;
      const dayKey = session.start_time ? session.start_time.slice(0, 10) : null;
      const dayBuckets = currentDayBucketsByUserId.get(session.user_id) ?? new Map<string, number>();
      if (dayKey) {
        dayBuckets.set(dayKey, (dayBuckets.get(dayKey) ?? 0) + (Number(session.doors_hit ?? 0) || 0));
        currentDayBucketsByUserId.set(session.user_id, dayBuckets);
      }

      currentTotalsByUserId.set(session.user_id, {
        doors_knocked: existing.doors_knocked + (Number(session.doors_hit ?? 0) || 0),
        conversations: existing.conversations + (Number(session.conversations ?? 0) || 0),
        flyers_delivered: existing.flyers_delivered + (Number(session.flyers_delivered ?? 0) || 0),
        sessions_count: existing.sessions_count + 1,
        active_days: existing.active_days,
        total_duration_seconds: existing.total_duration_seconds + (Number(session.active_seconds ?? 0) || 0),
        last_active_at: existing.last_active_at ?? eventTime,
        best_day_doors: existing.best_day_doors,
        best_day_date: existing.best_day_date,
      });
    }

    for (const [userId, buckets] of currentDayBucketsByUserId.entries()) {
      const entry = currentTotalsByUserId.get(userId);
      if (!entry) continue;

      entry.active_days = buckets.size;

      let bestDayDate: string | null = null;
      let bestDayDoors = 0;
      for (const [date, doors] of buckets.entries()) {
        if (doors > bestDayDoors) {
          bestDayDoors = doors;
          bestDayDate = date;
        }
      }

      entry.best_day_doors = bestDayDoors;
      entry.best_day_date = bestDayDate;
    }

    const previousTotalsByUserId = new Map<
      string,
      { doors_knocked: number; conversations: number; last_active_at: string | null }
    >();

    for (const session of (previousSessionsRes.data ?? []) as SessionRow[]) {
      if (!session.user_id) continue;
      const existing = previousTotalsByUserId.get(session.user_id) ?? {
        doors_knocked: 0,
        conversations: 0,
        last_active_at: null,
      };
      previousTotalsByUserId.set(session.user_id, {
        doors_knocked: existing.doors_knocked + (Number(session.doors_hit ?? 0) || 0),
        conversations: existing.conversations + (Number(session.conversations ?? 0) || 0),
        last_active_at: existing.last_active_at ?? (session.end_time ?? session.start_time ?? null),
      });
    }

    const appointmentCountByUserId = new Map<string, number>();
    for (const row of ((appointmentsRes.data ?? []) as AppointmentRow[])) {
      if (!row.user_id) continue;
      appointmentCountByUserId.set(row.user_id, (appointmentCountByUserId.get(row.user_id) ?? 0) + 1);
    }

    const liveSessionByUserId = new Map<
      string,
      { current_session_started_at: string | null; current_session_duration_seconds: number }
    >();
    const now = Date.now();
    for (const session of (liveSessionsRes.data ?? []) as Array<Pick<SessionRow, 'user_id' | 'start_time' | 'active_seconds'>>) {
      if (!session.user_id || liveSessionByUserId.has(session.user_id)) continue;
      const startedAt = session.start_time;
      const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
      const durationSeconds =
        Number(session.active_seconds ?? 0) > 0
          ? Number(session.active_seconds ?? 0)
          : Number.isNaN(startedMs)
            ? 0
            : Math.max(0, Math.floor((now - startedMs) / 1000));

      liveSessionByUserId.set(session.user_id, {
        current_session_started_at: startedAt ?? null,
        current_session_duration_seconds: durationSeconds,
      });
    }

    const currentRanked = members
      .map((member) => {
        const totals = currentTotalsByUserId.get(member.user_id) ?? {
          doors_knocked: 0,
          conversations: 0,
          last_active_at: null,
        };
        return {
          user_id: member.user_id,
          doors_knocked: totals.doors_knocked,
          conversations: totals.conversations,
          last_active_at: totals.last_active_at,
        };
      })
      .sort(compareRows);

    const previousRanked = members
      .map((member) => {
        const totals = previousTotalsByUserId.get(member.user_id) ?? {
          doors_knocked: 0,
          conversations: 0,
          last_active_at: null,
        };
        return {
          user_id: member.user_id,
          doors_knocked: totals.doors_knocked,
          conversations: totals.conversations,
          last_active_at: totals.last_active_at,
        };
      })
      .sort(compareRows);

    const currentRankByUserId = new Map(currentRanked.map((entry, index) => [entry.user_id, index + 1]));
    const previousRankByUserId = new Map(
      previousRanked
        .filter((entry) => entry.doors_knocked > 0 || entry.conversations > 0)
        .map((entry, index) => [entry.user_id, index + 1])
    );

    const responseMembers = members
      .map((member) => {
        const profile = profileByUserId.get(member.user_id);
        const totals = currentTotalsByUserId.get(member.user_id) ?? {
          doors_knocked: 0,
          conversations: 0,
          flyers_delivered: 0,
          sessions_count: 0,
          active_days: 0,
          total_duration_seconds: 0,
          last_active_at: null,
          best_day_doors: 0,
          best_day_date: null,
        };
        const live = liveSessionByUserId.get(member.user_id);
        const currentRank = currentRankByUserId.get(member.user_id) ?? null;
        const previousRank = previousRankByUserId.get(member.user_id) ?? null;

        return {
          user_id: member.user_id,
          display_name: buildDisplayName(profile),
          role: member.role ?? 'member',
          color: member.color ?? '#3B82F6',
          last_active_at: totals.last_active_at,
          inactive_days: daysSince(totals.last_active_at),
          doors_knocked: totals.doors_knocked,
          conversations: totals.conversations,
          flyers_delivered: totals.flyers_delivered,
          followups: 0,
          appointments: appointmentCountByUserId.get(member.user_id) ?? 0,
          sessions_count: totals.sessions_count,
          active_days: totals.active_days,
          total_duration_seconds: totals.total_duration_seconds,
          weekly_door_goal: profile?.weekly_door_goal ?? 100,
          weekly_sessions_goal: profile?.weekly_sessions_goal ?? null,
          weekly_minutes_goal: profile?.weekly_minutes_goal ?? null,
          current_rank: currentRank,
          rank_delta: currentRank && previousRank ? previousRank - currentRank : null,
          best_day_doors: totals.best_day_doors,
          best_day_date: totals.best_day_date,
          is_live: Boolean(live),
          current_session_started_at: live?.current_session_started_at ?? null,
          current_session_duration_seconds: live?.current_session_duration_seconds ?? 0,
        };
      })
      .sort(compareRows);

    return NextResponse.json({ members: responseMembers });
  } catch (err) {
    console.error('[team/members] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
