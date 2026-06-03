import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser } from '@/app/api/_utils/workspace';
import { normalizeCalendarEventPayload } from '@/lib/calendar/api';
import type { CalendarEventRow } from '@/lib/calendar/types';

const SELECT_COLUMNS = [
  'id',
  'user_id',
  'workspace_id',
  'title',
  'start_at',
  'end_at',
  'is_all_day',
  'event_type',
  'contact_id',
  'contact_name',
  'contact_address',
  'source_kind',
  'source_id',
  'notes',
  'location',
  'color_key',
  'created_at',
  'updated_at',
  'deleted_at',
].join(',');
const DERIVED_ROWS_LIMIT = 1000;
const SESSION_EVENT_TYPE = 'session';

type DerivedOptions = {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string | null;
  userId: string;
  scopedUserIds: string[] | null;
  eventTypes: string[];
  start: string;
  end: string;
  existingKeys: Set<string>;
  fallbackUserIds: () => Promise<string[]>;
};

function parseDateParam(value: string | null, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message || '';
  }
  return '';
}

function isMissingRelation(error: unknown, table: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes(`relation "${table}" does not exist`) ||
    message.includes(`relation ${table} does not exist`)
  );
}

function isMissingColumn(error: unknown, table: string, column: string): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes(`column ${table}.${column}`) && message.includes('does not exist');
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

function intersectsRange(startAt: string, endAt: string, rangeStart: string, rangeEnd: string): boolean {
  return new Date(endAt).getTime() > new Date(rangeStart).getTime()
    && new Date(startAt).getTime() < new Date(rangeEnd).getTime();
}

function wantsEventType(eventTypes: string[], eventType: string): boolean {
  return eventTypes.length === 0 || eventTypes.includes(eventType);
}

function sourceKey(sourceKind: string | null, sourceId: string | null, eventType: string): string {
  return `${sourceKind ?? ''}|${sourceId ?? ''}|${eventType}`;
}

async function loadWorkspaceUserIds(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string | null,
  fallbackUserId: string
): Promise<string[]> {
  if (!workspaceId) return [fallbackUserId];
  const { data, error } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);

  if (error || !data?.length) return [fallbackUserId];
  return Array.from(
    new Set(
      data
        .map((row) => (typeof row.user_id === 'string' ? row.user_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );
}

async function fetchContactSourceRows(
  options: Pick<DerivedOptions, 'admin' | 'workspaceId' | 'userId' | 'scopedUserIds' | 'fallbackUserIds'>,
  table: 'contacts' | 'field_leads'
): Promise<Array<Record<string, unknown>>> {
  const runQuery = async (withWorkspaceFilter: boolean, userIds: string[] | null) => {
    let query = options.admin.from(table).select('*').limit(DERIVED_ROWS_LIMIT);

    if (withWorkspaceFilter && options.workspaceId) {
      query = query.eq('workspace_id', options.workspaceId);
    }
    if (!options.workspaceId) {
      query = query.eq('user_id', options.userId);
    } else if (userIds?.length === 1) {
      query = query.eq('user_id', userIds[0]);
    } else if (userIds && userIds.length > 1) {
      query = query.in('user_id', userIds);
    }

    return query;
  };

  const primary = await runQuery(Boolean(options.workspaceId), options.scopedUserIds);
  if (!primary.error) return (primary.data ?? []) as Array<Record<string, unknown>>;
  if (isMissingRelation(primary.error, table)) return [];
  if (!isMissingColumn(primary.error, table, 'workspace_id')) {
    throw new Error(primary.error.message);
  }

  const fallbackUserIds = options.scopedUserIds ?? await options.fallbackUserIds();
  const fallback = await runQuery(false, fallbackUserIds);
  if (fallback.error) {
    if (isMissingRelation(fallback.error, table)) return [];
    throw new Error(fallback.error.message);
  }
  return (fallback.data ?? []) as Array<Record<string, unknown>>;
}

async function fetchDerivedContactEvents(options: DerivedOptions): Promise<CalendarEventRow[]> {
  if (!wantsEventType(options.eventTypes, 'appointment') && !wantsEventType(options.eventTypes, 'follow_up')) {
    return [];
  }

  const [contacts, fieldLeads] = await Promise.all([
    fetchContactSourceRows(options, 'contacts'),
    fetchContactSourceRows(options, 'field_leads'),
  ]);
  const rows = [
    ...contacts.map((row) => ({ row, table: 'contacts' as const })),
    ...fieldLeads.map((row) => ({ row, table: 'field_leads' as const })),
  ];
  const events: CalendarEventRow[] = [];
  const seen = new Set(options.existingKeys);
  const now = new Date().toISOString();

  for (const { row, table } of rows) {
    const id = firstNonEmptyString(row.id);
    const userId = firstNonEmptyString(row.user_id);
    if (!id || !userId) continue;

    const workspaceId = firstNonEmptyString(row.workspace_id) ?? options.workspaceId;
    const fullName = firstNonEmptyString(row.full_name, row.name) ?? 'Lead';
    const address = firstNonEmptyString(row.address);
    const notes = firstNonEmptyString(row.notes);
    const contactId = table === 'contacts' ? id : null;
    const followUpAt = toIsoOrNull(row.follow_up_at) ?? toIsoOrNull(row.reminder_date);
    const appointmentAt = toIsoOrNull(row.appointment_at);
    const sourcePrefix = table === 'contacts' ? 'contact' : 'field_lead';

    if (followUpAt && wantsEventType(options.eventTypes, 'follow_up')) {
      const key = sourceKey(`${sourcePrefix}_follow_up`, id, 'follow_up');
      const endAt = addMinutes(followUpAt, 30);
      if (!seen.has(key) && intersectsRange(followUpAt, endAt, options.start, options.end)) {
        seen.add(key);
        events.push({
          id: `derived-${sourcePrefix}-follow-up-${id}`,
          user_id: userId,
          workspace_id: workspaceId,
          title: `Follow up: ${fullName}`,
          start_at: followUpAt,
          end_at: endAt,
          is_all_day: false,
          event_type: 'follow_up',
          contact_id: contactId,
          contact_name: fullName,
          contact_address: address,
          source_kind: `${sourcePrefix}_follow_up`,
          source_id: id,
          notes,
          location: address,
          color_key: 'blue',
          created_at: toIsoOrNull(row.created_at) ?? now,
          updated_at: toIsoOrNull(row.updated_at) ?? now,
          deleted_at: null,
          kind: 'reminder',
        });
      }
    }

    if (appointmentAt && wantsEventType(options.eventTypes, 'appointment')) {
      const key = sourceKey(`${sourcePrefix}_appointment`, id, 'appointment');
      const endAt = addMinutes(appointmentAt, 60);
      if (!seen.has(key) && intersectsRange(appointmentAt, endAt, options.start, options.end)) {
        seen.add(key);
        events.push({
          id: `derived-${sourcePrefix}-appointment-${id}`,
          user_id: userId,
          workspace_id: workspaceId,
          title: `Appointment: ${fullName}`,
          start_at: appointmentAt,
          end_at: endAt,
          is_all_day: false,
          event_type: 'appointment',
          contact_id: contactId,
          contact_name: fullName,
          contact_address: address,
          source_kind: `${sourcePrefix}_appointment`,
          source_id: id,
          notes,
          location: address,
          color_key: 'red',
          created_at: toIsoOrNull(row.created_at) ?? now,
          updated_at: toIsoOrNull(row.updated_at) ?? now,
          deleted_at: null,
          kind: 'reminder',
        });
      }
    }
  }

  return events;
}

async function fetchDerivedSessionEvents(options: DerivedOptions): Promise<CalendarEventRow[]> {
  if (!options.workspaceId || !wantsEventType(options.eventTypes, SESSION_EVENT_TYPE)) return [];

  let query = options.admin
    .from('sessions')
    .select('id,user_id,workspace_id,campaign_id,start_time,end_time,doors_hit,conversations,flyers_delivered,leads_created,notes,created_at,updated_at')
    .eq('workspace_id', options.workspaceId)
    .gte('start_time', options.start)
    .lte('start_time', options.end)
    .order('start_time', { ascending: true })
    .limit(DERIVED_ROWS_LIMIT);

  if (options.scopedUserIds?.length === 1) {
    query = query.eq('user_id', options.scopedUserIds[0]);
  } else if (options.scopedUserIds && options.scopedUserIds.length > 1) {
    query = query.in('user_id', options.scopedUserIds);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error, 'sessions') || isMissingColumn(error, 'sessions', 'workspace_id')) return [];
    throw new Error(error.message);
  }

  const events: CalendarEventRow[] = [];
  const seen = new Set(options.existingKeys);
  const now = new Date().toISOString();

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const id = firstNonEmptyString(row.id);
    const userId = firstNonEmptyString(row.user_id);
    const startAt = toIsoOrNull(row.start_time);
    if (!id || !userId || !startAt) continue;

    const key = sourceKey('session', id, SESSION_EVENT_TYPE);
    if (seen.has(key)) continue;
    seen.add(key);

    const endAt = toIsoOrNull(row.end_time) ?? addMinutes(startAt, 60);
    const doors = Number(row.doors_hit ?? 0) || 0;
    const conversations = Number(row.conversations ?? 0) || 0;
    const flyers = Number(row.flyers_delivered ?? 0) || 0;
    const leads = Number(row.leads_created ?? 0) || 0;
    const summary = [
      doors ? `${doors} doors` : null,
      conversations ? `${conversations} conversations` : null,
      flyers ? `${flyers} flyers` : null,
      leads ? `${leads} leads` : null,
    ].filter(Boolean).join(', ');

    events.push({
      id: `derived-session-${id}`,
      user_id: userId,
      workspace_id: firstNonEmptyString(row.workspace_id) ?? options.workspaceId,
      title: summary ? `Session: ${summary}` : 'Session',
      start_at: startAt,
      end_at: endAt,
      is_all_day: false,
      event_type: SESSION_EVENT_TYPE,
      contact_id: null,
      contact_name: null,
      contact_address: null,
      source_kind: 'session',
      source_id: id,
      notes: firstNonEmptyString(row.notes) ?? (summary || null),
      location: null,
      color_key: 'green',
      created_at: toIsoOrNull(row.created_at) ?? now,
      updated_at: toIsoOrNull(row.updated_at) ?? now,
      deleted_at: null,
      kind: 'session',
    });
  }

  return events;
}

export async function GET(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const workspaceIdParam = params.get('workspaceId');
  const includeMembers = params.get('includeMembers') === 'true';
  const limit = Math.min(Math.max(Number(params.get('limit') ?? 250), 1), 500);
  const offset = Math.max(Number(params.get('offset') ?? 0), 0);
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setMonth(defaultStart.getMonth() - 1);
  const defaultEnd = new Date(now);
  defaultEnd.setMonth(defaultEnd.getMonth() + 2);
  const start = parseDateParam(params.get('start'), defaultStart);
  const end = parseDateParam(params.get('end'), defaultEnd);
  const eventTypes = (params.get('eventTypes') ?? params.get('type') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const memberIds = (params.get('memberIds') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const admin = createAdminClient();
  let workspaceId: string | null = null;
  let role: string | null = null;

  if (workspaceIdParam) {
    const membership = await resolveWorkspaceMembershipForUser(admin, user.id, workspaceIdParam);
    if (membership.error || !membership.workspaceId) {
      return NextResponse.json(
        { error: membership.error ?? 'Workspace access denied' },
        { status: membership.status ?? 403 }
      );
    }
    workspaceId = membership.workspaceId;
    role = membership.role;
  }

  const canIncludeMembers = role === 'owner';
  const scopedUserIds = workspaceId && includeMembers && canIncludeMembers && memberIds.length > 0
    ? memberIds
    : !workspaceId
      ? [user.id]
      : null;
  let fallbackUserIdsPromise: Promise<string[]> | null = null;
  const fallbackUserIds = () => {
    fallbackUserIdsPromise ??= loadWorkspaceUserIds(admin, workspaceId, user.id);
    return fallbackUserIdsPromise;
  };

  let query = admin
    .from('calendar_events')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .gt('end_at', start)
    .lt('start_at', end)
    .is('deleted_at', null)
    .order('start_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (workspaceId) {
    if (includeMembers && canIncludeMembers) {
      query = query.eq('workspace_id', workspaceId);
      if (memberIds.length > 0) {
        query = query.in('user_id', memberIds);
      }
    } else {
      query = query.or(
        `workspace_id.eq.${workspaceId},and(user_id.eq.${user.id},workspace_id.is.null)`
      );
    }
  } else {
    query = query.eq('user_id', user.id);
  }

  if (eventTypes.length > 0) {
    query = query.in('event_type', eventTypes);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as CalendarEventRow[];
  const existingKeys = new Set(
    rows
      .filter((row) => row.source_kind && row.source_id)
      .map((row) => sourceKey(row.source_kind, row.source_id, row.event_type))
  );
  const derivedRows = offset === 0
    ? await Promise.all([
        fetchDerivedSessionEvents({
          admin,
          workspaceId,
          userId: user.id,
          scopedUserIds,
          eventTypes,
          start,
          end,
          existingKeys,
          fallbackUserIds,
        }),
        fetchDerivedContactEvents({
          admin,
          workspaceId,
          userId: user.id,
          scopedUserIds,
          eventTypes,
          start,
          end,
          existingKeys,
          fallbackUserIds,
        }),
      ]).then(([sessions, contacts]) => [...sessions, ...contacts])
    : [];
  const allRows = [...rows, ...derivedRows].sort(
    (left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime()
  );
  const userIds = Array.from(new Set(allRows.map((row) => row.user_id).filter(Boolean))) as string[];
  const profileNames = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('user_profiles')
      .select('user_id, full_name, first_name, last_name')
      .in('user_id', userIds);

    for (const profile of profiles ?? []) {
      const fullName = typeof profile.full_name === 'string' ? profile.full_name.trim() : '';
      const firstName = typeof profile.first_name === 'string' ? profile.first_name.trim() : '';
      const lastName = typeof profile.last_name === 'string' ? profile.last_name.trim() : '';
      const displayName = fullName || [firstName, lastName].filter(Boolean).join(' ');
      if (profile.user_id && displayName) {
        profileNames.set(profile.user_id, displayName);
      }
    }
  }

  const events = allRows.map((row) => ({
    ...row,
    display_name: row.user_id ? profileNames.get(row.user_id) ?? null : null,
    kind: row.kind ?? 'standalone',
  }));
  const nextOffset = typeof count === 'number' && offset + limit < count ? offset + limit : null;

  return NextResponse.json({
    events,
    total: (count ?? rows.length) + derivedRows.length,
    nextOffset,
    canIncludeMembers,
  });
}

export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const workspaceIdParam =
    typeof body.workspaceId === 'string'
      ? body.workspaceId.trim()
      : typeof body.workspace_id === 'string'
        ? body.workspace_id.trim()
        : request.nextUrl.searchParams.get('workspaceId')?.trim() ?? null;

  const admin = createAdminClient();
  let workspaceId: string | null = null;
  if (workspaceIdParam) {
    const membership = await resolveWorkspaceMembershipForUser(admin, user.id, workspaceIdParam);
    if (membership.error || !membership.workspaceId) {
      return NextResponse.json(
        { error: membership.error ?? 'Workspace access denied' },
        { status: membership.status ?? 403 }
      );
    }
    workspaceId = membership.workspaceId;
  }

  let normalized;
  try {
    normalized = normalizeCalendarEventPayload(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid calendar event' },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('calendar_events')
    .insert({
      ...normalized,
      user_id: user.id,
      workspace_id: workspaceId,
      source_kind: null,
      source_id: null,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { event: { ...(data as unknown as CalendarEventRow), display_name: null, kind: 'standalone' } },
    { status: 201 }
  );
}
