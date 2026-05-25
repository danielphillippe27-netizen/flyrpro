import { NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type SessionMetricRow = {
  doors_hit: number | null;
  conversations: number | null;
  leads_created: number | null;
};

type WorkspaceMembershipRow = {
  role: 'owner' | 'admin' | 'member' | null;
};

type WorkspaceGoalsRow = {
  weekly_door_goal: number | null;
  weekly_sessions_goal: number | null;
};

type ProfileGoalRow = {
  user_id: string;
  weekly_door_goal: number | null;
  weekly_sessions_goal: number | null;
};

type ContactMetricRow = {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  campaign_id?: string | null;
  status?: string | null;
  appointment_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function isMissingRelation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes(`relation "${relation}" does not exist`);
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function isMissingContactsColumn(error: unknown, column: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes(`column contacts.${column}`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`'${column}' column`) ||
    message.includes(`${column} does not exist`)
  );
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

async function getLifetimeSessionTotals(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<{ doors_hit: number; conversations: number } | null> {
  const [doorsResult, convsResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('doors_hit')
      .eq('user_id', userId)
      .not('end_time', 'is', null),
    supabase
      .from('sessions')
      .select('conversations')
      .eq('user_id', userId)
      .not('end_time', 'is', null),
  ]);

  if (doorsResult.error || convsResult.error) {
    const error = doorsResult.error ?? convsResult.error;
    if (isMissingRelation(error, 'sessions')) {
      return null;
    }
    throw new Error(error?.message || 'Failed to load session totals');
  }

  const doorRows = (doorsResult.data ?? []) as Array<{ doors_hit?: number | null }>;
  const conversationRows = (convsResult.data ?? []) as Array<{ conversations?: number | null }>;

  return {
    doors_hit: doorRows.reduce((total, row) => total + (Number(row.doors_hit ?? 0) || 0), 0),
    conversations: conversationRows.reduce((total, row) => total + (Number(row.conversations ?? 0) || 0), 0),
  };
}

function contactSignature(row: ContactMetricRow): string {
  return [
    (row.full_name ?? '').trim().toLowerCase(),
    (row.phone ?? '').trim(),
    (row.email ?? '').trim().toLowerCase(),
    (row.address ?? '').trim().toLowerCase(),
    (row.campaign_id ?? '').trim(),
  ].join('|');
}

function isAppointmentStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'interested' || normalized === 'hot' || normalized === 'appointment';
}

function isInRange(iso: string | null | undefined, startMs: number, endMs: number): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time >= startMs && time <= endMs;
}

function summarizeContacts(rows: ContactMetricRow[], startIso: string, endIso: string) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const leadSignatures = new Set<string>();
  const appointmentSignatures = new Set<string>();

  for (const row of rows) {
    const signature = contactSignature(row);
    if (isInRange(row.created_at, startMs, endMs)) {
      leadSignatures.add(signature);
    }

    const changedInRange =
      isInRange(row.updated_at, startMs, endMs) || isInRange(row.created_at, startMs, endMs);
    const appointmentInRange = isInRange(row.appointment_at, startMs, endMs);
    if (appointmentInRange || (changedInRange && isAppointmentStatus(row.status))) {
      appointmentSignatures.add(signature);
    }
  }

  return {
    leads: leadSignatures.size,
    appointments: appointmentSignatures.size,
  };
}

async function fetchContactMetricsRows(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string
) {
  const runQuery = (selectColumns: string) =>
    supabase
      .from('contacts')
      .select(selectColumns)
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

  const result = await runQuery(
    'full_name, phone, email, address, campaign_id, status, appointment_at, created_at, updated_at'
  );
  if (!result.error || !isMissingContactsColumn(result.error, 'appointment_at')) {
    return result;
  }

  return runQuery('full_name, phone, email, address, campaign_id, status, created_at, updated_at');
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
    const [userStatsRes, profileRes, campaignsRes, weekSessionsRes, appointmentsRes, contactsRes] = await Promise.all([
      supabase
        .from('user_stats')
        .select('doors_knocked, time_tracked, day_streak, conversations')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('first_name, last_name, weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('campaigns')
        .select('id, title, name')
        .eq('workspace_id', targetWorkspaceId)
        .order('created_at', { ascending: false }),
      supabase
        .from('sessions')
        .select('doors_hit, conversations, leads_created')
        .eq('workspace_id', targetWorkspaceId)
        .eq('user_id', userId)
        .gte('start_time', startOfWeek),
      supabase
        .from('crm_events')
        .select('created_at')
        .eq('user_id', userId)
        .not('fub_appointment_id', 'is', null)
        .gte('created_at', startOfWeek),
      fetchContactMetricsRows(supabase, targetWorkspaceId, userId),
    ]);

    const userStats = userStatsRes.data;
    const profile = profileRes.data;
    const campaignsData = campaignsRes.data ?? [];
    const profileFullName =
      [profile?.first_name, profile?.last_name]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .trim() || '';
    const metadataName =
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
      '';
    const emailLocalPart = (user.email?.split('@')[0] ?? '').trim();
    const fullName = profileFullName || metadataName || emailLocalPart || 'User';
    const firstName =
      (typeof profile?.first_name === 'string' && profile.first_name.trim()) ||
      fullName.split(/\s+/)[0] ||
      'User';

    let doorsAllTime = userStats?.doors_knocked ?? 0;
    const totalMinutesAllTime = userStats?.time_tracked ?? 0;
    const dayStreak = userStats?.day_streak ?? 0;
    let conversationsAllTime = userStats?.conversations ?? 0;

    if (doorsAllTime <= 0 || conversationsAllTime <= 0) {
      const sessionTotals = await getLifetimeSessionTotals(supabase, userId);
      if (sessionTotals !== null) {
        if (doorsAllTime <= 0) {
          doorsAllTime = sessionTotals.doors_hit;
        }
        if (conversationsAllTime <= 0) {
          conversationsAllTime = sessionTotals.conversations;
        }
      }
    }

    let weeklyDoorGoal = profile?.weekly_door_goal ?? 100;
    let weeklySessionsGoal = profile?.weekly_sessions_goal ?? undefined;
    let weeklyMinutesGoal = profile?.weekly_minutes_goal ?? undefined;

    const { data: membershipData } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', targetWorkspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    const membership = (membershipData ?? null) as WorkspaceMembershipRow | null;

    if (membership?.role === 'member') {
      const [{ data: workspaceGoalsData }, { data: workspaceMembersData }] = await Promise.all([
        supabase
          .from('workspaces')
          .select('weekly_door_goal, weekly_sessions_goal')
          .eq('id', targetWorkspaceId)
          .maybeSingle(),
        supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', targetWorkspaceId),
      ]);

      const workspaceGoals = (workspaceGoalsData ?? null) as WorkspaceGoalsRow | null;
      const workspaceUserIds = (workspaceMembersData ?? [])
        .map((row) => row.user_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);

      let aggregateDoorGoal = 0;
      let aggregateSessionsGoal = 0;
      let hasAggregateSessionsGoal = false;

      if (workspaceUserIds.length > 0) {
        const { data: profileGoalsData } = await supabase
          .from('user_profiles')
          .select('user_id, weekly_door_goal, weekly_sessions_goal')
          .in('user_id', workspaceUserIds);

        const profileGoalMap = new Map(
          ((profileGoalsData ?? []) as ProfileGoalRow[]).map((goalRow) => [goalRow.user_id, goalRow])
        );

        for (const workspaceUserId of workspaceUserIds) {
          const goalProfile = profileGoalMap.get(workspaceUserId);
          aggregateDoorGoal += Math.max(0, goalProfile?.weekly_door_goal ?? 100);

          if (goalProfile?.weekly_sessions_goal != null) {
            aggregateSessionsGoal += Math.max(0, goalProfile.weekly_sessions_goal);
            hasAggregateSessionsGoal = true;
          }
        }
      }

      weeklyDoorGoal = workspaceGoals?.weekly_door_goal ?? aggregateDoorGoal;
      weeklySessionsGoal =
        workspaceGoals?.weekly_sessions_goal ??
        (hasAggregateSessionsGoal ? aggregateSessionsGoal : undefined);
      weeklyMinutesGoal = undefined;
    }

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
    const weekSessions = (weekSessionsRes.data ?? []) as SessionMetricRow[];
    const metricDoors = weekSessions.reduce((sum, row) => sum + (Number(row.doors_hit ?? 0) || 0), 0);
    const metricConvos = weekSessions.reduce((sum, row) => sum + (Number(row.conversations ?? 0) || 0), 0);
    const fallbackLeadCount = weekSessions.reduce((sum, row) => sum + (Number(row.leads_created ?? 0) || 0), 0);
    const metricsPeriodEnd = new Date().toISOString();

    let metricLeads = fallbackLeadCount;
    let metricAppointments = appointmentsRes.error ? 0 : (appointmentsRes.data ?? []).length;

    if (!contactsRes.error && Array.isArray(contactsRes.data)) {
      const contactSummary = summarizeContacts(
        contactsRes.data as unknown as ContactMetricRow[],
        startOfWeek,
        metricsPeriodEnd
      );
      metricLeads = contactSummary.leads;
      metricAppointments = contactSummary.appointments;
    }

    const body = {
      user: { firstName, fullName },
      stats: {
        doorsAllTime,
        conversationsAllTime,
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
      metrics: {
        doors: metricDoors,
        convos: metricConvos,
        leads: metricLeads,
        appointments: metricAppointments,
      },
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('Home dashboard error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
