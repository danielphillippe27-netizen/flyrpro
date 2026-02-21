import { NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';

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
    const metadataName = ((user.user_metadata?.name as string) ?? '').trim();
    const [metadataFirstName = '', ...metadataLastNameParts] = metadataName.split(/\s+/);
    const metadataLastName = metadataLastNameParts.join(' ').trim();
    const emailFallbackFirstName = (user.email?.split('@')[0] as string) || 'User';

    const supabase = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      requestedWorkspaceId
    );
    if (!access.workspaceId) {
      return NextResponse.json(
        { error: access.error ?? 'Workspace not found' },
        { status: access.status ?? 400 }
      );
    }
    const targetWorkspaceId = access.workspaceId;
    const startOfWeek = getStartOfWeekUTC();

    let campaignsQuery = supabase
      .from('campaigns')
      .select('id, title, name')
      .eq('workspace_id', targetWorkspaceId)
      .order('created_at', { ascending: false });

    if (access.level === 'member') {
      campaignsQuery = campaignsQuery.eq('owner_id', userId);
    }

    // Run independent fetches in parallel
    const [userStatsRes, profileRes, campaignsRes] = await Promise.all([
      supabase
        .from('user_stats')
        .select('doors_knocked, time_tracked, day_streak')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('first_name, last_name, weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
        .eq('user_id', userId)
        .maybeSingle(),
      campaignsQuery,
    ]);

    const userStats = userStatsRes.data;
    const profile = profileRes.data;
    const campaignsData = campaignsRes.data ?? [];

    const doorsAllTime = userStats?.doors_knocked ?? 0;
    const totalMinutesAllTime = userStats?.time_tracked ?? 0;
    const dayStreak = userStats?.day_streak ?? 0;

    const weeklyDoorGoal = profile?.weekly_door_goal ?? 100;
    const weeklySessionsGoal = profile?.weekly_sessions_goal ?? undefined;
    const weeklyMinutesGoal = profile?.weekly_minutes_goal ?? undefined;
    const profileFirstName = (profile?.first_name ?? '').trim();
    const profileLastName = (profile?.last_name ?? '').trim();
    const firstName = profileFirstName || metadataFirstName || emailFallbackFirstName;
    const lastName = profileLastName || metadataLastName;

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
      user: { firstName, lastName },
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
