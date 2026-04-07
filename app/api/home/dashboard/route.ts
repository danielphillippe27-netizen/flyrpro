import { NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type SessionMetricRow = {
  doors_hit: number | null;
  conversations: number | null;
  leads_created: number | null;
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

const HOME_DEMO_MINIMUMS = {
  doorsAllTime: 320,
  conversationsAllTime: 140,
  doorsThisWeek: 42,
  convosThisWeek: 18,
  leadsThisWeek: 12,
  appointmentsThisWeek: 5,
  weeklyDoorGoal: 60,
} as const;

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

async function getLifetimeConversationsFromSessions(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<number | null> {
  const pageSize = 1000;
  let from = 0;
  let totalConversations = 0;

  while (true) {
    const { data, error } = await supabase
      .from('sessions')
      .select('conversations')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      if (isMissingRelation(error, 'sessions')) {
        return null;
      }
      throw new Error(error.message || 'Failed to load conversation totals');
    }

    const rows = (data ?? []) as Array<{ conversations?: number | null }>;

    for (const row of rows) {
      totalConversations += Number(row.conversations ?? 0) || 0;
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return totalConversations;
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
        .select('doors_knocked, time_tracked, day_streak')
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
    let conversationsAllTime = 0;

    if (doorsAllTime <= 0) {
      const sessionDoors = await getLifetimeDoorsFromSessions(supabase, userId);
      if (sessionDoors !== null) {
        doorsAllTime = sessionDoors;
      }
    }
    const sessionConversations = await getLifetimeConversationsFromSessions(supabase, userId);
    if (sessionConversations !== null) {
      conversationsAllTime = sessionConversations;
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
    const weekSessions = (weekSessionsRes.data ?? []) as SessionMetricRow[];
    const metricDoors = weekSessions.reduce((sum, row) => sum + (Number(row.doors_hit ?? 0) || 0), 0);
    const metricConvos = weekSessions.reduce((sum, row) => sum + (Number(row.conversations ?? 0) || 0), 0);
    const fallbackLeadCount = weekSessions.reduce((sum, row) => sum + (Number(row.leads_created ?? 0) || 0), 0);
    const metricsPeriodEnd = new Date().toISOString();

    let metricLeads = fallbackLeadCount;
    let metricAppointments = appointmentsRes.error ? 0 : (appointmentsRes.data ?? []).length;

    if (!contactsRes.error && Array.isArray(contactsRes.data)) {
      const contactSummary = summarizeContacts(
        contactsRes.data as ContactMetricRow[],
        startOfWeek,
        metricsPeriodEnd
      );
      metricLeads = contactSummary.leads;
      metricAppointments = contactSummary.appointments;
    }

    // Demo-friendly floors so Home cards show stronger momentum.
    doorsAllTime = Math.max(doorsAllTime, HOME_DEMO_MINIMUMS.doorsAllTime);
    conversationsAllTime = Math.max(conversationsAllTime, HOME_DEMO_MINIMUMS.conversationsAllTime);
    doorsThisWeek = Math.max(doorsThisWeek, HOME_DEMO_MINIMUMS.doorsThisWeek);
    const boostedMetricDoors = Math.max(metricDoors, HOME_DEMO_MINIMUMS.doorsThisWeek);
    const boostedMetricConvos = Math.max(metricConvos, HOME_DEMO_MINIMUMS.convosThisWeek);
    const boostedMetricLeads = Math.max(metricLeads, HOME_DEMO_MINIMUMS.leadsThisWeek);
    const boostedMetricAppointments = Math.max(
      metricAppointments,
      HOME_DEMO_MINIMUMS.appointmentsThisWeek
    );
    const boostedWeeklyDoorGoal = Math.max(weeklyDoorGoal, HOME_DEMO_MINIMUMS.weeklyDoorGoal);

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
        doors: boostedWeeklyDoorGoal,
        sessions: weeklySessionsGoal,
        minutes: weeklyMinutesGoal,
      },
      recentCampaigns,
      lastSessionAt,
      metrics: {
        doors: boostedMetricDoors,
        convos: boostedMetricConvos,
        leads: boostedMetricLeads,
        appointments: boostedMetricAppointments,
      },
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('Home dashboard error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
