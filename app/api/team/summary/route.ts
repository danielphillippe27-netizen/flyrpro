import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type SessionRow = {
  user_id: string | null;
  start_time: string | null;
  doors_hit: number | null;
  conversations: number | null;
  leads_created: number | null;
  flyers_delivered: number | null;
  active_seconds: number | null;
};

type AppointmentRow = {
  user_id: string | null;
  created_at: string | null;
};

type ContactRow = {
  user_id: string | null;
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

type ProfileGoalRow = {
  user_id: string;
  weekly_door_goal: number | null;
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

function parseMemberIds(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isMissingRelation(error: unknown, relation: string): boolean {
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') {
    return false;
  }

  return error.message.toLowerCase().includes(`relation "${relation}" does not exist`);
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

function summarizeSessions(rows: SessionRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.doors += Number(row.doors_hit ?? 0) || 0;
      acc.convos += Number(row.conversations ?? 0) || 0;
      acc.leads += Number(row.leads_created ?? 0) || 0;
      acc.flyers += Number(row.flyers_delivered ?? 0) || 0;
      acc.sessions_count += 1;
      acc.total_duration_seconds += Number(row.active_seconds ?? 0) || 0;

      const day = row.start_time ? row.start_time.slice(0, 10) : null;
      if (day) {
        acc.doorsByDay.set(day, (acc.doorsByDay.get(day) ?? 0) + (Number(row.doors_hit ?? 0) || 0));
      }

      return acc;
    },
    {
      doors: 0,
      convos: 0,
      leads: 0,
      flyers: 0,
      sessions_count: 0,
      total_duration_seconds: 0,
      doorsByDay: new Map<string, number>(),
    }
  );
}

function countAppointments(rows: AppointmentRow[]) {
  return rows.reduce((count, row) => count + (row.user_id ? 1 : 0), 0);
}

function contactSignature(row: ContactRow): string {
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

function summarizeContacts(rows: ContactRow[], startIso: string, endIso: string) {
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

async function fetchContactRows(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  selectedUserIds: string[]
) {
  const runQuery = (selectColumns: string) =>
    supabase
      .from('contacts')
      .select(selectColumns)
      .eq('workspace_id', workspaceId)
      .in('user_id', selectedUserIds);

  const result = await runQuery(
    'user_id, full_name, phone, email, address, campaign_id, status, appointment_at, created_at, updated_at'
  );

  if (!result.error || !isMissingContactsColumn(result.error, 'appointment_at')) {
    return result;
  }

  return runQuery(
    'user_id, full_name, phone, email, address, campaign_id, status, created_at, updated_at'
  );
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
    const requestedMemberIds = parseMemberIds(searchParams.get('memberIds'));
    const [{ data: workspace, error: workspaceError }, { data: workspaceMembers, error: membersError }] =
      await Promise.all([
        supabase
          .from('workspaces')
          .select('weekly_sessions_goal')
          .eq('id', resolution.workspaceId)
          .maybeSingle(),
        supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', resolution.workspaceId),
      ]);

    if (workspaceError) {
      console.error('[team/summary] workspace error:', workspaceError);
      return NextResponse.json({ error: workspaceError.message }, { status: 500 });
    }

    if (membersError) {
      console.error('[team/summary] workspace_members error:', membersError);
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const goals = {
      weekly_door_goal: null as number | null,
      weekly_sessions_goal: workspace?.weekly_sessions_goal ?? null,
      source:
        workspace?.weekly_sessions_goal != null
          ? ('workspace' as const)
          : ('member_aggregate' as const),
    };

    const workspaceUserIds = (workspaceMembers ?? [])
      .map((row) => row.user_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const selectedUserIds =
      requestedMemberIds.length > 0
        ? workspaceUserIds.filter((userId) => requestedMemberIds.includes(userId))
        : workspaceUserIds;

    const emptyPayload = {
      period: { start, end },
      goals,
      totals: { doors: 0, convos: 0, leads: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      previousTotals: { doors: 0, convos: 0, leads: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      deltas: { doors: 0, convos: 0, leads: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 },
      trend: { doorsByDay: [] as Array<{ date: string | null; doors: number }> },
    };

    if (selectedUserIds.length === 0) {
      return NextResponse.json(emptyPayload);
    }

    const { data: goalProfiles, error: goalProfilesError } = await supabase
      .from('user_profiles')
      .select('user_id, weekly_door_goal')
      .in('user_id', selectedUserIds);

    if (goalProfilesError) {
      console.error('[team/summary] goal profiles error:', goalProfilesError);
      return NextResponse.json({ error: goalProfilesError.message }, { status: 500 });
    }

    goals.weekly_door_goal = ((goalProfiles ?? []) as ProfileGoalRow[]).reduce(
      (sum, profile) => sum + Math.max(0, profile.weekly_door_goal ?? 100),
      0
    );

    const startDate = new Date(start);
    const endDate = new Date(end);
    const intervalMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const previousStart = new Date(startDate.getTime() - intervalMs).toISOString();
    const previousEnd = startDate.toISOString();

    const [
      currentSessionsRes,
      previousSessionsRes,
      currentAppointmentsRes,
      previousAppointmentsRes,
      contactsRes,
    ] = await Promise.all([
      supabase
        .from('sessions')
        .select('user_id, start_time, doors_hit, conversations, leads_created, flyers_delivered, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .in('user_id', selectedUserIds)
        .gte('start_time', start)
        .lte('start_time', end),
      supabase
        .from('sessions')
        .select('user_id, start_time, doors_hit, conversations, leads_created, flyers_delivered, active_seconds')
        .eq('workspace_id', resolution.workspaceId)
        .in('user_id', selectedUserIds)
        .gte('start_time', previousStart)
        .lt('start_time', previousEnd),
      supabase
        .from('crm_events')
        .select('user_id, created_at')
        .in('user_id', selectedUserIds)
        .not('fub_appointment_id', 'is', null)
        .gte('created_at', start)
        .lte('created_at', end),
      supabase
        .from('crm_events')
        .select('user_id, created_at')
        .in('user_id', selectedUserIds)
        .not('fub_appointment_id', 'is', null)
        .gte('created_at', previousStart)
        .lt('created_at', previousEnd),
      fetchContactRows(supabase, resolution.workspaceId, selectedUserIds),
    ]);

    if (currentSessionsRes.error) {
      console.error('[team/summary] current sessions error:', currentSessionsRes.error);
      return NextResponse.json({ error: currentSessionsRes.error.message }, { status: 500 });
    }

    if (previousSessionsRes.error) {
      console.error('[team/summary] previous sessions error:', previousSessionsRes.error);
      return NextResponse.json({ error: previousSessionsRes.error.message }, { status: 500 });
    }

    let currentAppointments = currentAppointmentsRes.data ?? [];
    let previousAppointments = previousAppointmentsRes.data ?? [];

    if (currentAppointmentsRes.error && !isMissingRelation(currentAppointmentsRes.error, 'crm_events')) {
      console.error('[team/summary] current appointments error:', currentAppointmentsRes.error);
      return NextResponse.json({ error: currentAppointmentsRes.error.message }, { status: 500 });
    }

    if (previousAppointmentsRes.error && !isMissingRelation(previousAppointmentsRes.error, 'crm_events')) {
      console.error('[team/summary] previous appointments error:', previousAppointmentsRes.error);
      return NextResponse.json({ error: previousAppointmentsRes.error.message }, { status: 500 });
    }

    if (contactsRes.error && !isMissingRelation(contactsRes.error, 'contacts')) {
      console.error('[team/summary] contacts error:', contactsRes.error);
      return NextResponse.json({ error: contactsRes.error.message }, { status: 500 });
    }

    if (currentAppointmentsRes.error) currentAppointments = [];
    if (previousAppointmentsRes.error) previousAppointments = [];

    const currentSummary = summarizeSessions((currentSessionsRes.data ?? []) as SessionRow[]);
    const previousSummary = summarizeSessions((previousSessionsRes.data ?? []) as SessionRow[]);
    const contacts = contactsRes.error ? [] : ((contactsRes.data ?? []) as ContactRow[]);
    const currentContactSummary = summarizeContacts(contacts, start, end);
    const previousContactSummary = summarizeContacts(contacts, previousStart, previousEnd);
    const currentAppointmentsCount =
      contacts.length > 0 ? currentContactSummary.appointments : countAppointments(currentAppointments as AppointmentRow[]);
    const previousAppointmentsCount =
      contacts.length > 0 ? previousContactSummary.appointments : countAppointments(previousAppointments as AppointmentRow[]);
    const currentLeadCount = contacts.length > 0 ? currentContactSummary.leads : currentSummary.leads;
    const previousLeadCount = contacts.length > 0 ? previousContactSummary.leads : previousSummary.leads;

    const doorsByDay = Array.from(currentSummary.doorsByDay.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, doors]) => ({ date, doors }));

    return NextResponse.json({
      period: { start, end },
      goals,
      totals: {
        doors: currentSummary.doors,
        convos: currentSummary.convos,
        leads: currentLeadCount,
        flyers: currentSummary.flyers,
        followups: 0,
        appointments: currentAppointmentsCount,
        sessions_count: currentSummary.sessions_count,
        total_duration_seconds: currentSummary.total_duration_seconds,
      },
      previousTotals: {
        doors: previousSummary.doors,
        convos: previousSummary.convos,
        leads: previousLeadCount,
        flyers: previousSummary.flyers,
        followups: 0,
        appointments: previousAppointmentsCount,
        sessions_count: previousSummary.sessions_count,
        total_duration_seconds: previousSummary.total_duration_seconds,
      },
      deltas: {
        doors: currentSummary.doors - previousSummary.doors,
        convos: currentSummary.convos - previousSummary.convos,
        leads: currentLeadCount - previousLeadCount,
        flyers: currentSummary.flyers - previousSummary.flyers,
        followups: 0,
        appointments: currentAppointmentsCount - previousAppointmentsCount,
        sessions_count: currentSummary.sessions_count - previousSummary.sessions_count,
        total_duration_seconds: currentSummary.total_duration_seconds - previousSummary.total_duration_seconds,
      },
      trend: { doorsByDay },
    });
  } catch (err) {
    console.error('[team/summary] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
