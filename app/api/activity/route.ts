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
  ref_id?: string | null;
  session_id?: string | null;
  campaign_id?: string | null;
  payload: Record<string, unknown> | null;
  created_at?: string | null;
};

type TimestampColumn = 'event_time' | 'created_at';
type ContactActivityType = 'appointment' | 'followup';
type AddressStatusForeignKeyColumn = 'campaign_address_id' | 'address_id';
type ContactEventRow = {
  id: string;
  user_id: string;
  event_type: ContactActivityType;
  event_time: string;
  ref_id: null;
  payload: Record<string, unknown>;
  created_at: string;
};
type DerivedActivityEventRow = ContactEventRow & { campaign_name?: string; campaign_id?: string };
type ActivityMemberOption = {
  user_id: string;
  display_name: string;
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

async function fetchAppointmentAddressStatusRows(
  admin: ReturnType<typeof createAdminClient>,
  start: string,
  end: string,
  limit: number
): Promise<{
  rows: Array<Record<string, unknown>>;
  addressIdColumn: AddressStatusForeignKeyColumn;
}> {
  const addressIdColumns: AddressStatusForeignKeyColumn[] = ['campaign_address_id', 'address_id'];

  for (const addressIdColumn of addressIdColumns) {
    const result = await admin
      .from('address_statuses')
      .select(`${addressIdColumn}, status, created_at, updated_at`)
      .eq('status', 'appointment')
      .gte('updated_at', start)
      .lte('updated_at', end)
      .limit(limit);

    if (!result.error) {
      return {
        rows: (result.data ?? []) as Array<Record<string, unknown>>,
        addressIdColumn,
      };
    }

    if (isMissingRelation(result.error, 'address_statuses')) {
      return { rows: [], addressIdColumn };
    }

    if (isMissingColumn(result.error, 'address_statuses', addressIdColumn)) {
      continue;
    }

    throw new Error(result.error.message);
  }

  throw new Error('address_statuses is missing a supported address foreign key column');
}

const SESSION_EVENTS_FETCH_LIMIT = 500;
const SESSION_EVENTS_FETCH_LIMIT_CAMPAIGN_SCOPED = 1500;
const SESSIONS_FETCH_LIMIT = 500;
const CONTACT_ROWS_FETCH_LIMIT = 1000;

/** Fetch rows from sessions table and return as synthetic session_completed events (same source as iOS). */
async function fetchSyntheticSessionEventsFromSessions(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  scopedUserIds: string[],
  start: string,
  end: string
): Promise<SessionEventRow[]> {
  let includeLeadsCreated = true;
  let data: Array<Record<string, unknown>> | null = null;
  const allowedUserIds = new Set(scopedUserIds);

  while (true) {
    const selectColumns = [
      'id',
      'user_id',
      'campaign_id',
      'start_time',
      'end_time',
      'active_seconds',
      'distance_meters',
      'doors_hit',
      'conversations',
      'flyers_delivered',
      'created_at',
    ];

    if (includeLeadsCreated) {
      selectColumns.push('leads_created');
    }

    let query = admin
      .from('sessions')
      .select(selectColumns.join(', '))
      .eq('workspace_id', workspaceId)
      .gte('start_time', start)
      .lte('start_time', end)
      .order('start_time', { ascending: false })
      .limit(SESSIONS_FETCH_LIMIT);

    if (scopedUserIds.length === 1) {
      query = query.eq('user_id', scopedUserIds[0]);
    } else if (scopedUserIds.length > 1) {
      query = query.in('user_id', scopedUserIds);
    }

    const result = await query;
    if (!result.error) {
      data = (result.data ?? []) as Array<Record<string, unknown>>;
      break;
    }

    if (isMissingRelation(result.error, 'sessions')) return [];
    if (isMissingColumn(result.error, 'sessions', 'workspace_id')) return [];
    if (includeLeadsCreated && isMissingColumn(result.error, 'sessions', 'leads_created')) {
      includeLeadsCreated = false;
      continue;
    }
    throw new Error(result.error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => allowedUserIds.has(String(row.user_id)))
    .map((row) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      event_type: 'session_completed',
      session_id: String(row.id),
      campaign_id: firstNonEmptyString(row.campaign_id),
      event_time: firstNonEmptyString(row.end_time, row.start_time) ?? new Date().toISOString(),
      created_at: firstNonEmptyString(row.created_at, row.end_time, row.start_time) ?? new Date().toISOString(),
      payload: {
        campaign_id: firstNonEmptyString(row.campaign_id),
        doors_hit: Number(row.doors_hit ?? 0) || 0,
        conversations: Number(row.conversations ?? 0) || 0,
        leads_created: Number(row.leads_created ?? 0) || 0,
        flyers_delivered: Number(row.flyers_delivered ?? 0) || 0,
        active_seconds: Number(row.active_seconds ?? 0) || 0,
        distance_meters: Number(row.distance_meters ?? 0) || 0,
      },
    })) as SessionEventRow[];
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

function getFollowUpDateIso(row: Record<string, unknown>): string | null {
  return toIsoOrNull(row.follow_up_at) ?? toIsoOrNull(row.reminder_date);
}

function getAppointmentDateIso(row: Record<string, unknown>): string | null {
  return toIsoOrNull(row.appointment_at);
}

function hasAppointment(status: string, appointmentDateIso: string | null): boolean {
  return Boolean(appointmentDateIso) || isAppointmentStatus(status);
}

function needsFollowUp(status: string, followUpDateIso: string | null): boolean {
  if (followUpDateIso) return true;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === 'follow_up' ||
    normalized === 'follow-up' ||
    normalized === 'not_home' ||
    normalized === 'no_answer' ||
    normalized === 'warm'
  );
}

function isLegacyAppointmentStatus(rawStatus: string): boolean {
  return rawStatus.trim().toLowerCase() === 'appointment';
}

function buildContactRowSignature(row: Record<string, unknown>): string {
  const userId = firstNonEmptyString(row.user_id) ?? '';
  const contactName = firstNonEmptyString(row.full_name, row.name)?.toLowerCase() ?? '';
  const phone = firstNonEmptyString(row.phone) ?? '';
  const email = firstNonEmptyString(row.email)?.toLowerCase() ?? '';
  const address = firstNonEmptyString(row.address)?.toLowerCase() ?? '';
  const campaignId = firstNonEmptyString(row.campaign_id) ?? '';
  const status = firstNonEmptyString(row.status)?.toLowerCase() ?? '';
  const followUpDateIso = getFollowUpDateIso(row) ?? '';
  const appointmentDateIso = getAppointmentDateIso(row) ?? '';
  const updatedAtIso = toIsoOrNull(row.updated_at) ?? '';
  const createdAtIso = toIsoOrNull(row.created_at) ?? '';

  return [
    userId,
    contactName,
    phone,
    email,
    address,
    campaignId,
    status,
    followUpDateIso,
    appointmentDateIso,
    updatedAtIso || createdAtIso,
  ].join('|');
}

function mergeContactRows(
  ...groups: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const row of group) {
      const signature = buildContactRowSignature(row);
      if (seen.has(signature)) continue;
      seen.add(signature);
      merged.push(row);
    }
  }

  return merged;
}

function normalizeLegacyAppointmentEvents(
  rawRows: Array<Record<string, unknown>>,
  start: string,
  end: string
): DerivedActivityEventRow[] {
  const events: DerivedActivityEventRow[] = [];

  for (const row of rawRows) {
    const id = firstNonEmptyString(row.id);
    const userId = firstNonEmptyString(row.user_id);
    const status = firstNonEmptyString(row.status) ?? '';
    if (!id || !userId || !isLegacyAppointmentStatus(status)) continue;

    const eventTime = toIsoOrNull(row.updated_at) ?? toIsoOrNull(row.created_at) ?? new Date().toISOString();
    if (!isWithinRange(eventTime, start, end)) continue;

    const contactName = firstNonEmptyString(row.full_name, row.name);
    const address = firstNonEmptyString(row.address) ?? '';
    const campaignName = firstNonEmptyString(row.campaign_name, row.campaign_title);
    const summary = contactName
      ? address
        ? `${contactName} • ${address}`
        : contactName
      : address || 'Appointment';

    const rowCampaignId = firstNonEmptyString(row.campaign_id) ?? undefined;
    events.push({
      id: `legacy-appointment-${id}`,
      user_id: userId,
      event_type: 'appointment',
      event_time: eventTime,
      ref_id: null,
      created_at: toIsoOrNull(row.created_at) ?? eventTime,
      payload: {
        summary,
        contact_name: contactName,
        address,
        status: status.trim().toLowerCase(),
        source: 'field_leads',
        ...(rowCampaignId ? { campaign_id: rowCampaignId } : {}),
      },
      campaign_name: campaignName ?? undefined,
      campaign_id: rowCampaignId,
    });
  }

  events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
  return events;
}

async function fetchContactRows(
  admin: ReturnType<typeof createAdminClient>,
  table: 'contacts' | 'field_leads',
  workspaceId: string,
  scopedUserIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const runQuery = async (withWorkspaceFilter: boolean) => {
    let query = admin
      .from(table)
      .select('*')
      .limit(CONTACT_ROWS_FETCH_LIMIT);

    if (withWorkspaceFilter) {
      query = query.eq('workspace_id', workspaceId);
    }

    if (scopedUserIds.length === 1) {
      query = query.eq('user_id', scopedUserIds[0]);
    } else if (scopedUserIds.length > 1) {
      query = query.in('user_id', scopedUserIds);
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

async function fetchAddressStatusAppointmentEvents(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  scopedUserIds: string[],
  fallbackUserId: string,
  start: string,
  end: string
): Promise<DerivedActivityEventRow[]> {
  const { rows, addressIdColumn } = await fetchAppointmentAddressStatusRows(
    admin,
    start,
    end,
    CONTACT_ROWS_FETCH_LIMIT
  );
  const addressIds = Array.from(
    new Set(rows.map((row) => firstNonEmptyString(row[addressIdColumn])).filter((value): value is string => !!value))
  );
  if (addressIds.length === 0) return [];

  const { data: addressRows, error: addressError } = await admin
    .from('campaign_addresses')
    .select('id, campaign_id, formatted, house_number, street_name')
    .in('id', addressIds);

  if (addressError) {
    if (isMissingRelation(addressError, 'campaign_addresses')) return [];
    throw new Error(addressError.message);
  }

  const addressMap = new Map(
    ((addressRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const id = firstNonEmptyString(row.id);
        return id ? [id, row] : null;
      })
      .filter((entry): entry is [string, Record<string, unknown>] => !!entry)
  );

  const campaignIds = Array.from(
    new Set(
      Array.from(addressMap.values())
        .map((row) => firstNonEmptyString(row.campaign_id))
        .filter((value): value is string => !!value)
    )
  );
  if (campaignIds.length === 0) return [];

  const { data: campaignRows, error: campaignError } = await admin
    .from('campaigns')
    .select('*')
    .in('id', campaignIds);

  if (campaignError) {
    if (isMissingRelation(campaignError, 'campaigns')) return [];
    throw new Error(campaignError.message);
  }

  const campaignMap = new Map(
    ((campaignRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const id = firstNonEmptyString(row.id);
        return id ? [id, row] : null;
      })
      .filter((entry): entry is [string, Record<string, unknown>] => !!entry)
  );

  const allowedUsers = new Set(scopedUserIds);
  const events: DerivedActivityEventRow[] = [];

  for (const row of rows) {
    const addressId = firstNonEmptyString(row[addressIdColumn]);
    if (!addressId) continue;

    const address = addressMap.get(addressId);
    const campaignId = address ? firstNonEmptyString(address.campaign_id) : null;
    const campaign = campaignId ? campaignMap.get(campaignId) : null;
    if (!address || !campaign) continue;

    const campaignWorkspaceId = firstNonEmptyString(campaign.workspace_id);
    const actorUserId = firstNonEmptyString(campaign.owner_id, campaign.user_id) ?? fallbackUserId;
    const workspaceMatch = campaignWorkspaceId
      ? campaignWorkspaceId === workspaceId
      : allowedUsers.has(actorUserId);

    if (!workspaceMatch) continue;
    if (!allowedUsers.has(actorUserId)) continue;

    const eventTime = toIsoOrNull(row.updated_at) ?? toIsoOrNull(row.created_at) ?? new Date().toISOString();
    const createdAt = toIsoOrNull(row.created_at) ?? eventTime;
    const formattedAddress =
      firstNonEmptyString(address.formatted) ??
      [firstNonEmptyString(address.house_number), firstNonEmptyString(address.street_name)]
        .filter((part): part is string => !!part)
        .join(' ')
        .trim();
    const campaignName = firstNonEmptyString(campaign.name, campaign.title);
    const addressCampaignId = campaignId ?? undefined;

    events.push({
      id: `address-status-appointment-${addressId}`,
      user_id: actorUserId,
      event_type: 'appointment',
      event_time: eventTime,
      ref_id: null,
      created_at: createdAt,
      payload: {
        summary: formattedAddress || 'Appointment',
        address: formattedAddress || '',
        status: 'appointment',
        campaign_address_id: addressId,
        source: 'address_statuses',
        ...(addressCampaignId ? { campaign_id: addressCampaignId } : {}),
      },
      campaign_name: campaignName ?? undefined,
      campaign_id: addressCampaignId,
    });
  }

  events.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
  return events;
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
    const followUpDateIso = getFollowUpDateIso(row);
    const appointmentDateIso = getAppointmentDateIso(row);
    const updatedAtIso = toIsoOrNull(row.updated_at);
    const createdAtIso = toIsoOrNull(row.created_at) ?? updatedAtIso ?? new Date().toISOString();

    if (!id || !userId) continue;

    if (type === 'appointment' && !hasAppointment(status, appointmentDateIso)) continue;
    if (type === 'followup' && !needsFollowUp(status, followUpDateIso)) continue;

    const eventTime = type === 'followup'
      ? followUpDateIso ?? updatedAtIso ?? createdAtIso
      : appointmentDateIso ?? updatedAtIso ?? createdAtIso;

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
        follow_up_at: followUpDateIso,
        appointment_at: appointmentDateIso,
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

async function loadWorkspaceMemberOptions(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<ActivityMemberOption[]> {
  const { data: memberships, error } = await admin
    .from('workspace_members')
    .select('user_id, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingRelation(error, 'workspace_members')) return [];
    throw new Error(error.message);
  }

  const userIds = ((memberships ?? []) as Array<{ user_id: string }>)
    .map((row) => row.user_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const profileMap = await loadProfileMap(admin, userIds);

  return userIds
    .map((userId) => ({
      user_id: userId,
      display_name: profileMap.get(userId) ?? 'Member',
    }))
    .sort((left, right) => left.display_name.localeCompare(right.display_name));
}

async function loadSessionCampaignMap(
  admin: ReturnType<typeof createAdminClient>,
  sessionIds: string[]
): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map<string, string>();

  const { data, error } = await admin
    .from('sessions')
    .select('id, campaign_id')
    .in('id', sessionIds);

  if (error) {
    if (isMissingRelation(error, 'sessions') || isMissingColumn(error, 'sessions', 'campaign_id')) {
      return new Map<string, string>();
    }
    throw new Error(error.message);
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; campaign_id: string | null }>)
      .filter((row) => typeof row.id === 'string' && typeof row.campaign_id === 'string' && row.campaign_id.length > 0)
      .map((row) => [row.id, row.campaign_id as string])
  );
}

async function loadCampaignMap(
  admin: ReturnType<typeof createAdminClient>,
  campaignIds: string[]
): Promise<Map<string, string>> {
  if (campaignIds.length === 0) return new Map<string, string>();

  const { data, error } = await admin
    .from('campaigns')
    .select('id, title, name')
    .in('id', campaignIds);

  if (error) {
    if (isMissingRelation(error, 'campaigns')) {
      return new Map<string, string>();
    }
    throw new Error(error.message);
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; title: string | null; name: string | null }>)
      .filter((campaign) => typeof campaign.id === 'string')
      .map((campaign) => [
        campaign.id,
        firstNonEmptyString(campaign.title, campaign.name) ?? 'Unnamed Campaign',
      ])
  );
}

function extractCampaignId(
  event: Pick<SessionEventRow, 'campaign_id' | 'payload'>
): string | null {
  const payload = event.payload ?? {};
  return firstNonEmptyString(
    event.campaign_id,
    payload.campaign_id,
    payload.campaignId
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
    const requestedMemberId = firstNonEmptyString(searchParams.get('memberId'));
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

    const rawCampaignId = (searchParams.get('campaignId') || '').trim();
    let scopedCampaignId: string | null = null;
    if (rawCampaignId) {
      const { data: campaignGate, error: campaignGateError } = await admin
        .from('campaigns')
        .select('id, workspace_id')
        .eq('id', rawCampaignId)
        .maybeSingle();
      if (campaignGateError || !campaignGate || campaignGate.workspace_id !== access.workspaceId) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }
      scopedCampaignId = rawCampaignId;
    }

    const canIncludeMembers = access.role === 'owner' || access.role === 'admin';
    const { data: workspaceMembers } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', access.workspaceId);

    const workspaceUserIds = new Set<string>((workspaceMembers ?? []).map((m: { user_id: string }) => m.user_id));
    if (requestedMemberId) {
      if (!canIncludeMembers) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (!workspaceUserIds.has(requestedMemberId)) {
        return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
      }
    }

    const scopedUserIds = canIncludeMembers
      ? requestedMemberId
        ? [requestedMemberId]
        : includeMembersRequested
          ? Array.from(workspaceUserIds)
          : [user.id]
      : [user.id];
    const scopedUserIdSet = new Set(scopedUserIds);
    const includeMembers = canIncludeMembers && (includeMembersRequested || Boolean(requestedMemberId));
    const memberOptions = canIncludeMembers
      ? await loadWorkspaceMemberOptions(admin, access.workspaceId)
      : [];

    if (scopedUserIds.length === 0) {
      return NextResponse.json({
        events: [],
        total: 0,
        nextOffset: null,
        canIncludeMembers,
        includeMembers,
        members: memberOptions,
        selectedMemberId: requestedMemberId,
        workspaceId: access.workspaceId,
      });
    }

    if (typeFilter === 'appointment' || typeFilter === 'followup') {
      let events: DerivedActivityEventRow[] = [];

      try {
        if (typeFilter === 'appointment') {
          const [addressStatusEvents, legacyAppointmentRows] = await Promise.all([
            fetchAddressStatusAppointmentEvents(
              admin,
              access.workspaceId,
              scopedUserIds,
              requestedMemberId ?? user.id,
              start,
              end
            ),
            fetchContactRows(admin, 'field_leads', access.workspaceId, scopedUserIds),
          ]);

          const filteredLegacyRows = legacyAppointmentRows.filter((row) => {
            const rowUserId = firstNonEmptyString(row.user_id);
            return !!rowUserId && scopedUserIdSet.has(rowUserId);
          });

          events = [
            ...addressStatusEvents,
            ...normalizeLegacyAppointmentEvents(filteredLegacyRows, start, end),
          ].sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
          if (scopedCampaignId) {
            events = events.filter((e) => firstNonEmptyString(e.campaign_id) === scopedCampaignId);
          }
        } else {
          const [contactRows, legacyRows] = await Promise.all([
            fetchContactRows(admin, 'contacts', access.workspaceId, scopedUserIds),
            fetchContactRows(admin, 'field_leads', access.workspaceId, scopedUserIds),
          ]);
          const rows = mergeContactRows(contactRows, legacyRows);
          let filteredRows = rows.filter((row) => {
            const rowUserId = firstNonEmptyString(row.user_id);
            if (!rowUserId) return false;
            return scopedUserIdSet.has(rowUserId);
          });
          if (scopedCampaignId) {
            filteredRows = filteredRows.filter((row) => firstNonEmptyString(row.campaign_id) === scopedCampaignId);
          }
          events = normalizeContactEvents(filteredRows, 'followup', start, end);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load contact-derived events';
        console.error('[activity] Failed to load contact-derived events:', message);
        return NextResponse.json({ error: message }, { status: 500 });
      }

      const total = events.length;
      const pagedEvents = events.slice(offset, offset + limit);

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
        members: memberOptions,
        selectedMemberId: requestedMemberId,
        workspaceId: access.workspaceId,
      });
    }

    const runEventsQuery = async (
      withWorkspaceFilter: boolean,
      timestampColumn: TimestampColumn,
      includePayload: boolean,
      includeRefId: boolean,
      includeSessionId: boolean,
      includeCampaignId: boolean,
      useRange: boolean
    ) => {
      const baseColumns = ['id', 'user_id', 'event_type'];
      if (includeRefId) {
        baseColumns.push('ref_id');
      }
      if (includeSessionId) {
        baseColumns.push('session_id');
      }
      if (includeCampaignId) {
        baseColumns.push('campaign_id');
      }
      if (timestampColumn === 'event_time') {
        baseColumns.push('event_time');
      }
      if (includePayload) {
        baseColumns.push('payload');
      }
      baseColumns.push('created_at');

      const sessionEventsLimit = useRange
        ? limit
        : scopedCampaignId
          ? SESSION_EVENTS_FETCH_LIMIT_CAMPAIGN_SCOPED
          : SESSION_EVENTS_FETCH_LIMIT;

      let query = admin
        .from('session_events')
        .select(baseColumns.join(', '), { count: useRange ? 'exact' : undefined })
        .gte(timestampColumn, start)
        .lte(timestampColumn, end)
        .order(timestampColumn, { ascending: false })
        .limit(sessionEventsLimit);

      if (useRange) {
        query = query.range(offset, offset + limit - 1);
      }

      if (withWorkspaceFilter) {
        query = query.eq('workspace_id', access.workspaceId);
      }

      if (scopedUserIds.length === 1) {
        query = query.eq('user_id', scopedUserIds[0]);
      } else if (scopedUserIds.length > 1) {
        query = query.in('user_id', scopedUserIds);
      }

      if (typeFilter) {
        query = query.eq('event_type', typeFilter);
      }

      if (scopedCampaignId && includeCampaignId) {
        query = query.eq('campaign_id', scopedCampaignId);
      }

      return query;
    };

    const runEventsQueryWithFallbacks = async (withWorkspaceFilter: boolean, useRange: boolean) => {
      let timestampColumn: TimestampColumn = 'event_time';
      let includePayload = true;
      let includeRefId = true;
      let includeSessionId = true;
      let includeCampaignId = true;

      while (true) {
        const result = await runEventsQuery(
          withWorkspaceFilter,
          timestampColumn,
          includePayload,
          includeRefId,
          includeSessionId,
          includeCampaignId,
          useRange
        );
        if (!result.error) {
          return result;
        }
        if (timestampColumn === 'event_time' && isMissingSessionEventsColumn(result.error, 'event_time')) {
          timestampColumn = 'created_at';
          continue;
        }
        if (includePayload && isMissingSessionEventsColumn(result.error, 'payload')) {
          includePayload = false;
          continue;
        }
        if (includeRefId && isMissingSessionEventsColumn(result.error, 'ref_id')) {
          includeRefId = false;
          continue;
        }
        if (includeSessionId && isMissingSessionEventsColumn(result.error, 'session_id')) {
          includeSessionId = false;
          continue;
        }
        if (includeCampaignId && isMissingSessionEventsColumn(result.error, 'campaign_id')) {
          includeCampaignId = false;
          continue;
        }
        return result;
      }
    };

    const includeSessionsTable =
      (!typeFilter || typeFilter === 'session_completed') && access.workspaceId;

    let rows: SessionEventRow[] = [];
    let count: number | null = null;

    if (includeSessionsTable) {
      const fullResult = await runEventsQueryWithFallbacks(true, false);
      if (fullResult.error) {
        const fallbackResult = await runEventsQueryWithFallbacks(false, false);
        rows = ((fallbackResult.data ?? []) as SessionEventRow[]).filter((row) =>
          scopedUserIdSet.has(row.user_id)
        );
      } else {
        rows = ((fullResult.data ?? []) as SessionEventRow[]).filter((row) =>
          scopedUserIdSet.has(row.user_id)
        );
      }

      let synthetic: SessionEventRow[] = [];
      try {
        synthetic = await fetchSyntheticSessionEventsFromSessions(
          admin,
          access.workspaceId,
          scopedUserIds,
          start,
          end
        );
      } catch (e) {
        console.warn('[activity] Failed to fetch sessions fallback:', e);
      }

      const bySessionKey = new Map<string, SessionEventRow>();
      for (const row of rows) {
        const key =
          row.event_type === 'session_completed'
            ? `session_completed:${firstNonEmptyString(row.session_id, row.ref_id, row.id)}`
            : `${row.event_type}:${row.id}`;
        if (!bySessionKey.has(key)) bySessionKey.set(key, row);
      }
      for (const row of synthetic) {
        const key = `session_completed:${firstNonEmptyString(row.session_id, row.id)}`;
        if (!bySessionKey.has(key)) bySessionKey.set(key, row);
      }
      rows = Array.from(bySessionKey.values());
      rows.sort((a, b) => {
        const tA = new Date(a.event_time ?? a.created_at ?? 0).getTime();
        const tB = new Date(b.event_time ?? b.created_at ?? 0).getTime();
        return tB - tA;
      });

      if (scopedCampaignId) {
        const sessionIdsForFilter = Array.from(
          new Set(
            rows
              .map((row) => firstNonEmptyString(row.session_id))
              .filter((value): value is string => Boolean(value))
          )
        );
        const sessionCampaignMapFull = await loadSessionCampaignMap(admin, sessionIdsForFilter);
        rows = rows.filter((row) => {
          const sid = firstNonEmptyString(row.session_id) ?? '';
          const resolved =
            extractCampaignId(row) ?? (sid ? sessionCampaignMapFull.get(sid) ?? null : null);
          return resolved === scopedCampaignId;
        });
      }

      count = rows.length;
      rows = rows.slice(offset, offset + limit);
    } else {
      let result = await runEventsQueryWithFallbacks(true, true);
      if (result.error) {
        const fallbackResult = await runEventsQueryWithFallbacks(false, true);
        result = fallbackResult;
      }
      if (result.error) {
        console.error('[activity] Failed to load events:', result.error);
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
      rows = ((result.data ?? []) as SessionEventRow[]).filter((row) => workspaceUserIds.has(row.user_id));
      rows = rows.filter((row) => scopedUserIdSet.has(row.user_id));
      if (scopedCampaignId) {
        const sessionIdsKnock = Array.from(
          new Set(
            rows
              .map((row) => firstNonEmptyString(row.session_id))
              .filter((value): value is string => Boolean(value))
          )
        );
        const sessionCampaignMapKnock = await loadSessionCampaignMap(admin, sessionIdsKnock);
        rows = rows.filter((row) => {
          const sid = firstNonEmptyString(row.session_id) ?? '';
          const resolved =
            extractCampaignId(row) ?? (sid ? sessionCampaignMapKnock.get(sid) ?? null : null);
          return resolved === scopedCampaignId;
        });
      }
      count = result.count ?? rows.length;
    }

    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    const profileMap = await loadProfileMap(admin, userIds);
    const sessionIds = Array.from(
      new Set(rows.map((row) => firstNonEmptyString(row.session_id)).filter((value): value is string => Boolean(value)))
    );
    const sessionCampaignMap = await loadSessionCampaignMap(admin, sessionIds);
    const campaignIds = Array.from(
      new Set(
        rows
          .map((row) => extractCampaignId(row) ?? sessionCampaignMap.get(firstNonEmptyString(row.session_id) ?? '') ?? null)
          .filter((value): value is string => Boolean(value))
      )
    );
    const campaignMap = await loadCampaignMap(admin, campaignIds);

    const normalizedEvents = rows.map((event) => ({
      ...event,
      event_time: event.event_time ?? event.created_at ?? new Date().toISOString(),
      display_name: profileMap.get(event.user_id) ?? 'Member',
      campaign_id: extractCampaignId(event) ?? sessionCampaignMap.get(firstNonEmptyString(event.session_id) ?? '') ?? null,
      campaign_name: null as string | null,
      payload: event.payload ?? {},
    })).map((event) => ({
      ...event,
      campaign_name: event.campaign_id ? campaignMap.get(event.campaign_id) ?? null : null,
      payload: {
        ...event.payload,
        ...(event.campaign_id ? { campaign_id: event.campaign_id } : {}),
      },
    }));

    const total = count ?? normalizedEvents.length;

    return NextResponse.json({
      events: normalizedEvents,
      total,
      nextOffset: offset + normalizedEvents.length < total ? offset + normalizedEvents.length : null,
      canIncludeMembers,
      includeMembers,
      members: memberOptions,
      selectedMemberId: requestedMemberId,
      workspaceId: access.workspaceId,
    });
  } catch (error) {
    console.error('[activity] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
