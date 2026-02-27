import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

function toBool(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

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

type SessionEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  event_time?: string | null;
  payload: Record<string, unknown> | null;
  created_at?: string | null;
};

type TimestampColumn = 'event_time' | 'created_at';
type ContactActivityType = 'appointment' | 'followup';
type ContactEventRow = {
  id: string;
  user_id: string;
  event_type: ContactActivityType;
  event_time: string;
  ref_id: null;
  payload: Record<string, unknown>;
  created_at: string;
};

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message || '';
  }
  return '';
}

function isMissingSessionEventsColumn(error: unknown, column: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes(`column session_events.${column}`) && message.includes('does not exist');
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

  if (type === 'followup') {
    events.sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
  } else {
    events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
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

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedWorkspaceId = searchParams.get('workspaceId') ?? undefined;
    const typeFilter = (searchParams.get('type') || '').trim() || null;
    const includeMembersRequested = toBool(searchParams.get('includeMembers'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10) || 30));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));

    const admin = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      requestedWorkspaceId
    );

    if (!access.workspaceId) {
      return NextResponse.json(
        { error: access.error ?? 'No workspace available' },
        { status: access.status ?? 400 }
      );
    }

    const canIncludeMembers = access.role === 'owner' || access.role === 'admin';
    const includeMembers = canIncludeMembers && includeMembersRequested;

    const { data: workspaceMembers } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', access.workspaceId);

    const workspaceUserIds = new Set<string>((workspaceMembers ?? []).map((m: { user_id: string }) => m.user_id));

    const workspaceIds = Array.from(workspaceUserIds);
    if (includeMembers && workspaceIds.length === 0) {
      return NextResponse.json({ events: [], total: 0, nextOffset: null, canIncludeMembers, includeMembers });
    }

    if (typeFilter === 'appointment' || typeFilter === 'followup') {
      const contactType = typeFilter;
      const fetchRowsFromTable = async (table: 'contacts' | 'field_leads') => {
        const runQuery = async (withWorkspaceFilter: boolean) => {
          let query = admin
            .from(table)
            .select('*')
            .limit(1000);

          if (withWorkspaceFilter) {
            query = query.eq('workspace_id', access.workspaceId);
          }

          if (!includeMembers) {
            query = query.eq('user_id', user.id);
          } else if (!withWorkspaceFilter) {
            query = query.in('user_id', workspaceIds);
          }

          return query;
        };

        const primary = await runQuery(true);
        if (!primary.error) return primary;

        if (isMissingRelation(primary.error, table)) {
          return { data: [] as Array<Record<string, unknown>>, error: null };
        }

        if (!isMissingColumn(primary.error, table, 'workspace_id')) {
          return primary;
        }

        return runQuery(false);
      };

      let rows: Array<Record<string, unknown>> = [];
      let sourceError: { message: string } | null = null;

      const contactsResult = await fetchRowsFromTable('contacts');
      if (contactsResult.error) {
        sourceError = { message: contactsResult.error.message };
      } else {
        rows = (contactsResult.data ?? []) as Array<Record<string, unknown>>;
      }

      if (rows.length === 0 && !sourceError) {
        const legacyResult = await fetchRowsFromTable('field_leads');
        if (legacyResult.error) {
          sourceError = { message: legacyResult.error.message };
        } else {
          rows = (legacyResult.data ?? []) as Array<Record<string, unknown>>;
        }
      }

      if (sourceError) {
        console.error('[activity] Failed to load contact-derived events:', sourceError);
        return NextResponse.json({ error: sourceError.message }, { status: 500 });
      }

      const filteredRows = rows.filter((row) => {
        const rowUserId = firstNonEmptyString(row.user_id);
        if (!rowUserId) return false;
        return workspaceUserIds.has(rowUserId);
      });

      const contactEvents = normalizeContactEvents(filteredRows, contactType, start, end);
      const total = contactEvents.length;
      const pagedEvents = contactEvents.slice(offset, offset + limit);

      const userIds = Array.from(new Set(pagedEvents.map((row) => row.user_id)));
      const profileMap = await loadProfileMap(admin, userIds);

      const normalizedEvents = pagedEvents.map((event) => ({
        ...event,
        display_name: profileMap.get(event.user_id) ?? 'Member',
      }));

      return NextResponse.json({
        events: normalizedEvents,
        total,
        nextOffset: offset + normalizedEvents.length < total ? offset + normalizedEvents.length : null,
        canIncludeMembers,
        includeMembers,
        workspaceId: access.workspaceId,
      });
    }

    const runEventsQuery = async (
      withWorkspaceFilter: boolean,
      timestampColumn: TimestampColumn
    ) => {
      const selectColumns =
        timestampColumn === 'event_time'
          ? 'id, user_id, event_type, event_time, payload, created_at'
          : 'id, user_id, event_type, created_at, payload';

      let query = admin
        .from('session_events')
        .select(selectColumns, { count: 'exact' })
        .gte(timestampColumn, start)
        .lte(timestampColumn, end)
        .order(timestampColumn, { ascending: false })
        .range(offset, offset + limit - 1);

      if (withWorkspaceFilter) {
        query = query.eq('workspace_id', access.workspaceId);
      }

      if (!includeMembers) {
        query = query.eq('user_id', user.id);
      } else if (!withWorkspaceFilter) {
        query = query.in('user_id', workspaceIds);
      }

      if (typeFilter) {
        query = query.eq('event_type', typeFilter);
      }

      return query;
    };

    const runEventsQueryWithTimestampFallback = async (withWorkspaceFilter: boolean) => {
      const primary = await runEventsQuery(withWorkspaceFilter, 'event_time');
      if (!primary.error || !isMissingSessionEventsColumn(primary.error, 'event_time')) {
        return primary;
      }
      return runEventsQuery(withWorkspaceFilter, 'created_at');
    };

    let { data: rows, error: rowsError, count } = await runEventsQueryWithTimestampFallback(true);

    if (rowsError) {
      // Fallback for older DBs where session_events may not have workspace_id yet
      const fallbackResult = await runEventsQueryWithTimestampFallback(false);
      rows = fallbackResult.data;
      rowsError = fallbackResult.error;
      count = fallbackResult.count;
    }

    if (rowsError) {
      console.error('[activity] Failed to load events:', rowsError);
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }

    const events = ((rows ?? []) as SessionEventRow[]).filter((row) => workspaceUserIds.has(row.user_id));

    const userIds = Array.from(new Set(events.map((row) => row.user_id)));
    const profileMap = await loadProfileMap(admin, userIds);

    const normalizedEvents = events.map((event) => ({
      ...event,
      event_time: event.event_time ?? event.created_at ?? new Date().toISOString(),
      display_name: profileMap.get(event.user_id) ?? 'Member',
      payload: event.payload ?? {},
    }));

    const total = count ?? normalizedEvents.length;

    return NextResponse.json({
      events: normalizedEvents,
      total,
      nextOffset: offset + normalizedEvents.length < total ? offset + normalizedEvents.length : null,
      canIncludeMembers,
      includeMembers,
      workspaceId: access.workspaceId,
    });
  } catch (error) {
    console.error('[activity] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
