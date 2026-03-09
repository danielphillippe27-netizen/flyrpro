import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

const MERGE_FETCH_LIMIT = 1000;

type TimestampColumn = 'event_time' | 'created_at';
type EventTable = 'session_events' | 'activity_events';
type ContactActivityType = 'appointment' | 'followup';

type ActivityEvent = {
  id: string;
  user_id: string;
  event_type: string;
  event_time: string;
  ref_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  display_name?: string;
};

type ContactEventRow = {
  id: string;
  user_id: string;
  event_type: ContactActivityType;
  event_time: string;
  ref_id: null;
  payload: Record<string, unknown>;
  created_at: string;
};

type SessionEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  event_time?: string | null;
  ref_id?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

function parseRange(start?: string | null, end?: string | null): { start: string; end: string } {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate: Date;
  if (start) {
    startDate = new Date(start);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
    startDate.setUTCHours(0, 0, 0, 0);
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message || '';
  }
  return '';
}

function isMissingColumn(error: unknown, table: string, column: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes(`column ${table}.${column}`) && message.includes('does not exist');
}

function isMissingRelation(error: unknown, table: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(`relation ${table} does not exist`)
  );
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isWithinRange(iso: string, start: string, end: string): boolean {
  const value = new Date(iso).getTime();
  const min = new Date(start).getTime();
  const max = new Date(end).getTime();
  return value >= min && value <= max;
}

function isAppointmentStatus(rawStatus: string): boolean {
  const normalized = rawStatus.trim().toLowerCase();
  return normalized === 'interested' || normalized === 'hot' || normalized === 'appointment';
}

function needsFollowUp(status: string, reminderDateIso: string | null): boolean {
  if (reminderDateIso) return true;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === 'follow_up' ||
    normalized === 'follow-up' ||
    normalized === 'not_home' ||
    normalized === 'no_answer' ||
    normalized === 'warm'
  );
}

function normalizeContactEvents(
  rawRows: Array<Record<string, unknown>>,
  type: ContactActivityType,
  start: string,
  end: string
): ContactEventRow[] {
  const events: ContactEventRow[] = [];

  for (const row of rawRows) {
    const id = firstNonEmptyString(row.id);
    const userId = firstNonEmptyString(row.user_id);
    const status = firstNonEmptyString(row.status)?.toLowerCase() ?? '';
    const contactName = firstNonEmptyString(row.full_name, row.name);
    const address = firstNonEmptyString(row.address) ?? '';
    const reminderDateIso = toIsoOrNull(row.reminder_date);
    const updatedAtIso = toIsoOrNull(row.updated_at);
    const createdAtIso = toIsoOrNull(row.created_at) ?? updatedAtIso ?? new Date().toISOString();

    if (!id || !userId) continue;

    if (type === 'appointment' && !isAppointmentStatus(status)) continue;
    if (type === 'followup' && !needsFollowUp(status, reminderDateIso)) continue;

    const eventTime = type === 'followup'
      ? reminderDateIso ?? updatedAtIso ?? createdAtIso
      : updatedAtIso ?? createdAtIso;

    if (!isWithinRange(eventTime, start, end)) continue;

    const summary = contactName
      ? address
        ? `${contactName} • ${address}`
        : contactName
      : address || (type === 'followup' ? 'Follow up due' : 'Appointment');

    events.push({
      id: `contact-${type}-${id}`,
      user_id: userId,
      event_type: type,
      event_time: eventTime,
      ref_id: null,
      created_at: createdAtIso,
      payload: {
        summary,
        contact_name: contactName,
        address,
        status,
        reminder_date: reminderDateIso,
      },
    });
  }

  return events;
}

async function loadProfileMap(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map<string, string>();

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);

  return new Map(
    (profiles ?? []).map((profile: { user_id: string; first_name: string | null; last_name: string | null }) => {
      const fullName = [profile.first_name, profile.last_name]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .trim();
      return [profile.user_id, fullName || 'Member'];
    })
  );
}

async function fetchContactRows(
  admin: ReturnType<typeof createAdminClient>,
  table: 'contacts' | 'field_leads',
  workspaceId: string,
  workspaceUserIds: string[],
  memberId: string | undefined
): Promise<Array<Record<string, unknown>>> {
  const runQuery = async (withWorkspaceFilter: boolean) => {
    let query = admin
      .from(table)
      .select('*')
      .limit(MERGE_FETCH_LIMIT);

    if (withWorkspaceFilter) {
      query = query.eq('workspace_id', workspaceId);
    }

    if (memberId) {
      query = query.eq('user_id', memberId);
    } else if (!withWorkspaceFilter) {
      query = query.in('user_id', workspaceUserIds);
    }

    return query;
  };

  const primary = await runQuery(true);
  if (!primary.error) {
    return (primary.data ?? []) as Array<Record<string, unknown>>;
  }

  if (isMissingRelation(primary.error, table)) {
    return [];
  }

  if (!isMissingColumn(primary.error, table, 'workspace_id')) {
    throw new Error(primary.error.message);
  }

  const fallback = await runQuery(false);
  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  return (fallback.data ?? []) as Array<Record<string, unknown>>;
}

async function fetchContactEvents(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  workspaceUserIds: string[],
  memberId: string | undefined,
  start: string,
  end: string,
  typeFilter: string | undefined
): Promise<ActivityEvent[]> {
  const requestedTypes: ContactActivityType[] = [];
  if (!typeFilter || typeFilter === 'appointment') requestedTypes.push('appointment');
  if (!typeFilter || typeFilter === 'followup') requestedTypes.push('followup');
  if (requestedTypes.length === 0) return [];

  const contactTables: Array<'contacts' | 'field_leads'> = ['contacts', 'field_leads'];
  let rows: Array<Record<string, unknown>> = [];
  for (const table of contactTables) {
    rows = await fetchContactRows(admin, table, workspaceId, workspaceUserIds, memberId);
    if (rows.length > 0) break;
  }

  const allowedUsers = new Set(workspaceUserIds);
  const filteredRows = rows.filter((row) => {
    const rowUserId = firstNonEmptyString(row.user_id);
    if (!rowUserId || !allowedUsers.has(rowUserId)) return false;
    return memberId ? rowUserId === memberId : true;
  });

  return requestedTypes.flatMap((type) => normalizeContactEvents(filteredRows, type, start, end));
}

async function fetchEventTableRows(
  admin: ReturnType<typeof createAdminClient>,
  table: EventTable,
  workspaceId: string,
  workspaceUserIds: string[],
  memberId: string | undefined,
  start: string,
  end: string,
  typeFilter: string | undefined
): Promise<ActivityEvent[] | null> {
  let timestampColumn: TimestampColumn = 'event_time';
  let includePayload = true;
  let includeRefId = table === 'activity_events';
  let withWorkspaceFilter = true;

  while (true) {
    const selectParts = ['id', 'user_id', 'event_type'];
    if (timestampColumn === 'event_time') {
      selectParts.push('event_time');
    }
    if (includeRefId) {
      selectParts.push('ref_id');
    }
    if (includePayload) {
      selectParts.push('payload');
    }
    selectParts.push('created_at');

    let query = admin
      .from(table)
      .select(selectParts.join(','))
      .gte(timestampColumn, start)
      .lte(timestampColumn, end)
      .order(timestampColumn, { ascending: false })
      .limit(MERGE_FETCH_LIMIT);

    if (withWorkspaceFilter) {
      query = query.eq('workspace_id', workspaceId);
    }
    if (memberId) {
      query = query.eq('user_id', memberId);
    } else if (!withWorkspaceFilter) {
      query = query.in('user_id', workspaceUserIds);
    }
    if (typeFilter) {
      query = query.eq('event_type', typeFilter);
    }

    const { data, error } = await query;

    if (!error) {
      const allowedUsers = new Set(workspaceUserIds);
      return ((data ?? []) as SessionEventRow[])
        .filter((row) => {
          if (!allowedUsers.has(row.user_id)) return false;
          return memberId ? row.user_id === memberId : true;
        })
        .map((row) => ({
          id: row.id,
          user_id: row.user_id,
          event_type: row.event_type,
          event_time: row.event_time ?? row.created_at ?? new Date().toISOString(),
          ref_id: row.ref_id ?? null,
          payload: row.payload ?? {},
          created_at: row.created_at ?? row.event_time ?? new Date().toISOString(),
        }));
    }

    if (isMissingRelation(error, table)) {
      return null;
    }
    if (withWorkspaceFilter && isMissingColumn(error, table, 'workspace_id')) {
      withWorkspaceFilter = false;
      continue;
    }
    if (timestampColumn === 'event_time' && isMissingColumn(error, table, 'event_time')) {
      timestampColumn = 'created_at';
      continue;
    }
    if (includePayload && isMissingColumn(error, table, 'payload')) {
      includePayload = false;
      continue;
    }
    if (includeRefId && isMissingColumn(error, table, 'ref_id')) {
      includeRefId = false;
      continue;
    }

    throw new Error(error.message);
  }
}

async function fetchSessionEvents(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  workspaceUserIds: string[],
  memberId: string | undefined,
  start: string,
  end: string,
  typeFilter: string | undefined
): Promise<ActivityEvent[]> {
  const sessionRows = await fetchEventTableRows(
    admin,
    'session_events',
    workspaceId,
    workspaceUserIds,
    memberId,
    start,
    end,
    typeFilter
  );
  if (sessionRows) return sessionRows;

  const legacyRows = await fetchEventTableRows(
    admin,
    'activity_events',
    workspaceId,
    workspaceUserIds,
    memberId,
    start,
    end,
    typeFilter
  );
  return legacyRows ?? [];
}

async function fetchSyntheticSessionEvents(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  memberId: string | undefined,
  start: string,
  end: string
): Promise<ActivityEvent[]> {
  let query = admin
    .from('sessions')
    .select('id, user_id, start_time, end_time, active_seconds, distance_meters, doors_hit, conversations, flyers_delivered, created_at')
    .eq('workspace_id', workspaceId)
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: false })
    .limit(MERGE_FETCH_LIMIT);

  if (memberId) {
    query = query.eq('user_id', memberId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error, 'sessions')) {
      return [];
    }
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    event_type: 'session_completed',
    event_time: firstNonEmptyString(row.end_time, row.start_time) ?? new Date().toISOString(),
    ref_id: String(row.id),
    created_at: firstNonEmptyString(row.created_at, row.end_time, row.start_time) ?? new Date().toISOString(),
    payload: {
      doors_hit: Number(row.doors_hit ?? 0) || 0,
      conversations: Number(row.conversations ?? 0) || 0,
      flyers_delivered: Number(row.flyers_delivered ?? 0) || 0,
      active_seconds: Number(row.active_seconds ?? 0) || 0,
      distance_meters: Number(row.distance_meters ?? 0) || 0,
    },
  }));
}

function sortEvents(events: ActivityEvent[], typeFilter: string | undefined): ActivityEvent[] {
  const ascending = typeFilter === 'followup';
  return [...events].sort((a, b) => {
    const aTime = new Date(a.event_time).getTime();
    const bTime = new Date(b.event_time).getTime();
    return ascending ? aTime - bTime : bTime - aTime;
  });
}

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const resolution = await resolveTeamDashboardMode(
      admin as unknown as MinimalSupabaseClient,
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
    const typeFilter = searchParams.get('type') || undefined;
    const memberId = searchParams.get('memberId') || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

    const { data: workspaceMembers, error: workspaceMembersError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', resolution.workspaceId);

    if (workspaceMembersError) {
      return NextResponse.json({ error: workspaceMembersError.message }, { status: 500 });
    }

    const workspaceUserIds = (workspaceMembers ?? []).map((member: { user_id: string }) => member.user_id);
    if (workspaceUserIds.length === 0) {
      return NextResponse.json({ events: [], items: [], total: 0, nextOffset: null });
    }

    const events: ActivityEvent[] = [];

    if (!typeFilter || typeFilter === 'appointment' || typeFilter === 'followup') {
      const contactEvents = await fetchContactEvents(
        admin,
        resolution.workspaceId,
        workspaceUserIds,
        memberId,
        start,
        end,
        typeFilter
      );
      events.push(...contactEvents);
    }

    if (!typeFilter || (typeFilter !== 'appointment' && typeFilter !== 'followup')) {
      const sessionEvents = await fetchSessionEvents(
        admin,
        resolution.workspaceId,
        workspaceUserIds,
        memberId,
        start,
        end,
        typeFilter
      );
      events.push(...sessionEvents);

      const needsSyntheticSessions =
        (typeFilter === undefined || typeFilter === 'session_completed') &&
        !sessionEvents.some((event) => event.event_type === 'session_completed');

      if (needsSyntheticSessions) {
        const syntheticSessions = await fetchSyntheticSessionEvents(
          admin,
          resolution.workspaceId,
          memberId,
          start,
          end
        );
        events.push(...syntheticSessions);
      }
    }

    const dedupedEvents = Array.from(
      new Map(events.map((event) => [`${event.event_type}:${event.id}`, event] as const)).values()
    );
    const sortedEvents = sortEvents(dedupedEvents, typeFilter);
    const pagedEvents = sortedEvents.slice(offset, offset + limit);

    const profileMap = await loadProfileMap(
      admin,
      Array.from(new Set(pagedEvents.map((event) => event.user_id)))
    );

    const normalizedEvents = pagedEvents.map((event) => ({
      ...event,
      display_name: profileMap.get(event.user_id) ?? 'Member',
    }));

    return NextResponse.json({
      events: normalizedEvents,
      items: normalizedEvents,
      total: sortedEvents.length,
      nextOffset: offset + normalizedEvents.length < sortedEvents.length ? offset + normalizedEvents.length : null,
    });
  } catch (err) {
    console.error('[team/activity] error:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Internal server error',
    }, { status: 500 });
  }
}
