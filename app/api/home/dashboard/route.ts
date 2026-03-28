import { NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';

function isMissingRelation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes(`relation "${relation}" does not exist`);
}

/**
 * Week start: Monday 00:00 UTC.
 * TODO: Support user timezone preference for startOfWeek when available.
 */
function getStartOfWeekUTC(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

async function getLifetimeDoorsFromSessions(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<number | null> {
  const pageSize = 1000;
  let from = 0;
  let totalDoors = 0;

  while (true) {
    const { data, error } = await supabase
      .from('sessions')
      .select('doors_hit')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      if (isMissingRelation(error, 'sessions')) {
        return null;
      }
      throw new Error(error.message || 'Failed to load session totals');
    }

    const rows = (data ?? []) as Array<{ doors_hit?: number | null }>;

    for (const row of rows) {
      totalDoors += Number(row.doors_hit ?? 0) || 0;
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return totalDoors;
}

/**
 * Doors hit = count of scan_events for campaigns owned by the user (QR scans).
 * Fallback: if we add "addresses marked visited/attempted" elsewhere, document there and keep UI consistent.
 */
export async function GET(request: Request) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const url = new URL(request.url);
    const requestedWorkspaceId = url.searchParams.get('workspaceId');
    const firstName =
      (user.user_metadata?.name as string)?.split(/\s+/)[0] ||
      (user.email?.split('@')[0] as string) ||
      'User';

    const supabase = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as MinimalSupabaseClient,
      userId,
      requestedWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;
    const startOfWeek = getStartOfWeekUTC();

    // Run independent fetches in parallel
    const [userStatsRes, profileRes, campaignsRes] = await Promise.all([
      supabase
        .from('user_stats')
        .select('doors_knocked, time_tracked, day_streak')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('campaigns')
        .select('id, title, name')
        .eq('workspace_id', targetWorkspaceId)
        .order('created_at', { ascending: false }),
    ]);

    const userStats = userStatsRes.data;
    const profile = profileRes.data;
    const campaignsData = campaignsRes.data ?? [];

    let doorsAllTime = userStats?.doors_knocked ?? 0;
    const totalMinutesAllTime = userStats?.time_tracked ?? 0;
    const dayStreak = userStats?.day_streak ?? 0;

    if (doorsAllTime <= 0) {
      const sessionDoors = await getLifetimeDoorsFromSessions(supabase, userId);
      if (sessionDoors !== null) {
        doorsAllTime = sessionDoors;
      }
    }

    const weeklyDoorGoal = profile?.weekly_door_goal ?? 100;
    const weeklySessionsGoal = profile?.weekly_sessions_goal ?? undefined;
    const weeklyMinutesGoal = profile?.weekly_minutes_goal ?? undefined;

    const campaignIds = campaignsData.map((c) => c.id);
    const recentCampaigns = campaignsData.slice(0, 3).map((c) => ({
      id: c.id,
      name: (c as { title?: string; name?: string }).title || (c as { name?: string }).name || 'Unnamed Campaign',
    }));

    // Doors this week + last session: run both scan_events queries in parallel
    let doorsThisWeek = 0;
    let lastSessionAt: string | null = null;

    if (campaignIds.length > 0) {
      try {
        const [countRes, lastScanRes] = await Promise.all([
          supabase
            .from('scan_events')
            .select('*', { count: 'exact', head: true })
            .in('campaign_id', campaignIds)
            .gte('scanned_at', startOfWeek),
          supabase
            .from('scan_events')
            .select('scanned_at')
            .in('campaign_id', campaignIds)
            .order('scanned_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!countRes.error) {
          doorsThisWeek = countRes.count ?? 0;
        }
        if (lastScanRes.data?.scanned_at) {
          lastSessionAt = lastScanRes.data.scanned_at;
        }
      } catch {
        // scan_events may not exist in some deployments
      }
    }

    // TODO: minutesThisWeek and sessionsThisWeek when session/time tracking exists
    const minutesThisWeek = 0;
    const sessionsThisWeek = 0;

    const body = {
      user: { firstName },
      stats: {
        doorsAllTime,
        totalMinutesAllTime,
        doorsThisWeek,
        minutesThisWeek,
        sessionsThisWeek,
        dayStreak,
      },
      weeklyGoals: {
        doors: weeklyDoorGoal,
        sessions: weeklySessionsGoal,
        minutes: weeklyMinutesGoal,
      },
      recentCampaigns,
      lastSessionAt,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('Home dashboard error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
