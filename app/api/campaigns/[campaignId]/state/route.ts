import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AddressStatusStateRow = {
  campaign_address_id?: string | null;
  address_id?: string | null;
  campaign_id: string;
  status: string | null;
  assigned_user_id?: string | null;
  updated_at: string | null;
  visit_count?: number | null;
  notes?: string | null;
  last_visited_at?: string | null;
};

type AddressStatusUpdatePayload = {
  campaignId?: string;
  campaign_id?: string;
  farmId?: string | null;
  farm_id?: string | null;
  addressIds?: string[];
  address_ids?: string[];
  buildingId?: string | null;
  building_id?: string | null;
  status?: string;
  notes?: string | null;
  sessionId?: string | null;
  session_id?: string | null;
  sessionTargetId?: string | null;
  session_target_id?: string | null;
  sessionEventType?: string | null;
  session_event_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt?: string;
  occurred_at?: string;
};

function parseSince(rawSince: string | null) {
  if (!rawSince) return { since: null, cursorWasInvalid: false };
  const timestamp = Date.parse(rawSince);
  if (Number.isNaN(timestamp)) return { since: null, cursorWasInvalid: true };
  return { since: new Date(timestamp).toISOString(), cursorWasInvalid: false };
}

function normalizedAddressIds(body: AddressStatusUpdatePayload) {
  const rawIds = body.addressIds ?? body.address_ids ?? [];
  return Array.from(
    new Set(
      rawIds
        .map((id) => String(id ?? '').trim())
        .filter(Boolean)
    )
  );
}

function persistedStatus(rawStatus: string | undefined) {
  const status = String(rawStatus ?? '').trim();
  if (!status) return null;
  return status === 'untouched' ? 'none' : status;
}

function isVisitedStatus(status: string) {
  return [
    'delivered',
    'talked',
    'lead',
    'interested',
    'appointment',
    'follow_up',
    'appointment_set',
    'callback_requested',
    'do_not_knock',
    'future_seller',
    'hot_lead',
  ].includes(status);
}

function nullableString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function latestCursor(rows: AddressStatusStateRow[]) {
  const latest = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return latest ?? new Date().toISOString();
}

async function assignedAddressIds(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  userId: string
) {
  const { data: assignments, error: assignmentError } = await supabase
    .from('campaign_assignments')
    .select('id, mode, assigned_to_user_id')
    .eq('campaign_id', campaignId)
    .eq('assigned_to_user_id', userId)
    .in('status', ['accepted', 'in_progress']);

  if (assignmentError) {
    return {
      addressIds: null,
      assignedUserByAddressId: new Map<string, string>(),
      fallbackReason: assignmentError.message,
    };
  }

  const activeAssignments = (assignments ?? []) as Array<{
    id: string;
    mode: 'zone_split' | 'whole_team';
    assigned_to_user_id: string;
  }>;

  if (activeAssignments.some((assignment) => assignment.mode === 'whole_team')) {
    return {
      addressIds: null,
      assignedUserByAddressId: new Map<string, string>(),
      fallbackReason: null,
    };
  }

  if (activeAssignments.length === 0) {
    return {
      addressIds: new Set<string>(),
      assignedUserByAddressId: new Map<string, string>(),
      fallbackReason: null,
    };
  }

  const { data: homes, error: homesError } = await supabase
    .from('campaign_assignment_homes')
    .select('campaign_address_id, assignment_id')
    .in('assignment_id', activeAssignments.map((assignment) => assignment.id));

  if (homesError) {
    return {
      addressIds: null,
      assignedUserByAddressId: new Map<string, string>(),
      fallbackReason: homesError.message,
    };
  }

  const assignedUserByAddressId = new Map<string, string>();
  const assignmentUserById = new Map(
    activeAssignments.map((assignment) => [assignment.id, assignment.assigned_to_user_id])
  );
  const addressIds = new Set<string>();

  for (const home of (homes ?? []) as Array<{ campaign_address_id?: string | null; assignment_id?: string | null }>) {
    if (!home.campaign_address_id || !home.assignment_id) continue;
    addressIds.add(home.campaign_address_id);
    const assignedUserId = assignmentUserById.get(home.assignment_id);
    if (assignedUserId) assignedUserByAddressId.set(home.campaign_address_id, assignedUserId);
  }

  return { addressIds, assignedUserByAddressId, fallbackReason: null };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const scope = searchParams.get('scope') ?? 'all';
  const { since, cursorWasInvalid } = parseSince(searchParams.get('since'));

  let scopedAddressIds: Set<string> | null = null;
  let assignedUserByAddressId = new Map<string, string>();
  let scopeApplied = 'all';
  let scopeFallbackReason: string | null = null;

  if (scope === 'assigned_to_me') {
    const scoped = await assignedAddressIds(supabase, campaignId, requestUser.id);
    scopedAddressIds = scoped.addressIds;
    assignedUserByAddressId = scoped.assignedUserByAddressId;
    scopeApplied = scoped.fallbackReason ? 'all' : 'assigned_to_me';
    scopeFallbackReason = scoped.fallbackReason;
  }

  let query = supabase
    .from('address_statuses')
    .select('campaign_address_id, campaign_id, status, updated_at, visit_count, notes, last_visited_at')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: true });

  if (since) {
    query = query.gt('updated_at', since);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: 'Failed to load campaign state', details: error.message },
      { status: 500 }
    );
  }

  let rows = ((data ?? []) as AddressStatusStateRow[]).map((row) => ({
    ...row,
    assigned_user_id: null,
  }));

  if (scopedAddressIds) {
    rows = rows.filter((row) => {
      const addressId = row.campaign_address_id ?? row.address_id ?? null;
      return Boolean(addressId && scopedAddressIds.has(addressId));
    });
  }

  return NextResponse.json({
    campaign_id: campaignId,
    server_cursor: latestCursor(rows),
    scope,
    scope_applied: scopeApplied,
    scope_fallback_reason: scopeFallbackReason,
    full_refresh: !since,
    cursor_was_invalid: cursorWasInvalid,
    changed: rows
      .map((row): {
        address_id: string | null;
        status: string;
        assigned_user_id: string | null;
        updated_at: string | null;
        version: number | null;
        notes: string | null;
        last_touch_at: string | null;
      } => ({
        address_id: row.campaign_address_id ?? row.address_id ?? null,
        status: row.status ?? 'none',
        assigned_user_id:
          row.campaign_address_id && assignedUserByAddressId.has(row.campaign_address_id)
            ? assignedUserByAddressId.get(row.campaign_address_id) ?? null
            : row.assigned_user_id ?? null,
        updated_at: row.updated_at,
        version: row.visit_count ?? null,
        notes: row.notes ?? null,
        last_touch_at: row.last_visited_at ?? null,
      }))
      .filter((row): row is {
        address_id: string;
        status: string;
        assigned_user_id: string | null;
        updated_at: string | null;
        version: number | null;
        notes: string | null;
        last_touch_at: string | null;
      } => Boolean(row.address_id)),
    deleted: [],
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  let body: AddressStatusUpdatePayload;
  try {
    body = (await request.json()) as AddressStatusUpdatePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const addressIds = normalizedAddressIds(body);
  const status = persistedStatus(body.status);
  if (addressIds.length === 0 || !status) {
    return NextResponse.json({ error: 'addressIds and status are required' }, { status: 400 });
  }

  const occurredAtRaw = body.occurredAt ?? body.occurred_at;
  const occurredAt = occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw))
    ? new Date(occurredAtRaw).toISOString()
    : new Date().toISOString();
  const notes = body.notes ?? '';
  const sessionId = nullableString(body.sessionId ?? body.session_id);
  const sessionTargetId = nullableString(body.sessionTargetId ?? body.session_target_id ?? body.buildingId ?? body.building_id);
  const sessionEventType = nullableString(body.sessionEventType ?? body.session_event_type);
  const farmId = nullableString(body.farmId ?? body.farm_id);

  const changed: Array<{
    address_id: string;
    status: string;
    updated_at: string;
    notes: string | null;
    last_touch_at: string;
  }> = [];

  for (const addressId of addressIds) {
    const rpcParams: Record<string, unknown> = {
      p_campaign_id: campaignId,
      p_campaign_address_id: addressId,
      p_address_id: addressId,
      p_status: status,
      p_notes: notes,
      p_occurred_at: occurredAt,
    };
    if (sessionId) rpcParams.p_session_id = sessionId;
    if (sessionTargetId) rpcParams.p_session_target_id = sessionTargetId;
    if (sessionEventType) rpcParams.p_session_event_type = sessionEventType;
    if (typeof body.latitude === 'number') rpcParams.p_lat = body.latitude;
    if (typeof body.longitude === 'number') rpcParams.p_lon = body.longitude;

    const outcomeResult = await supabase.rpc('record_campaign_address_outcome', rpcParams);
    if (outcomeResult.error) {
      const fallbackResult = await supabase.rpc('upsert_address_status', {
        p_address_id: addressId,
        p_campaign_id: campaignId,
        p_status: status,
        p_notes: notes,
        p_last_visited_at: occurredAt,
      });
      if (fallbackResult.error) {
        return NextResponse.json(
          { error: 'Failed to update address status', details: fallbackResult.error.message },
          { status: 500 }
        );
      }
    }

    changed.push({
      address_id: addressId,
      status,
      updated_at: occurredAt,
      notes: notes || null,
      last_touch_at: occurredAt,
    });
  }

  if (farmId) {
    const { data: farmRows, error: farmRowsError } = await supabase
      .from('farm_addresses')
      .select('id, campaign_address_id, visited_count')
      .eq('farm_id', farmId)
      .in('campaign_address_id', addressIds);

    if (!farmRowsError) {
      for (const row of (farmRows ?? []) as Array<{ id: string; visited_count?: number | null }>) {
        const updates: Record<string, unknown> = {
          last_outcome_status: status,
        };
        if (isVisitedStatus(status)) {
          updates.last_visited_at = occurredAt;
          updates.visited_count = Math.max(0, Number(row.visited_count ?? 0) || 0) + 1;
        }
        const { error: farmUpdateError } = await supabase
          .from('farm_addresses')
          .update(updates)
          .eq('id', row.id)
          .eq('farm_id', farmId);
        if (farmUpdateError) {
          console.warn('[api/campaigns/state] farm address outcome update failed', farmUpdateError);
        }
      }
    } else {
      console.warn('[api/campaigns/state] farm address lookup failed', farmRowsError);
    }
  }

  return NextResponse.json({
    campaign_id: campaignId,
    changed,
    deleted: [],
    server_cursor: new Date().toISOString(),
  });
}
