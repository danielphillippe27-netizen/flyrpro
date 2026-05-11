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

function parseSince(rawSince: string | null) {
  if (!rawSince) return { since: null, cursorWasInvalid: false };
  const timestamp = Date.parse(rawSince);
  if (Number.isNaN(timestamp)) return { since: null, cursorWasInvalid: true };
  return { since: new Date(timestamp).toISOString(), cursorWasInvalid: false };
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
  const { data, error } = await supabase
    .from('campaign_addresses')
    .select('id, assigned_user_id')
    .eq('campaign_id', campaignId)
    .eq('assigned_user_id', userId);

  if (error) {
    return { addressIds: null, fallbackReason: error.message };
  }

  const addressIds = new Set(
    (data ?? [])
      .map((row) => (row as { id?: string }).id)
      .filter((id): id is string => Boolean(id))
  );

  return { addressIds, fallbackReason: null };
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
  let scopeApplied = 'all';
  let scopeFallbackReason: string | null = null;

  if (scope === 'assigned_to_me') {
    const scoped = await assignedAddressIds(supabase, campaignId, requestUser.id);
    scopedAddressIds = scoped.addressIds;
    scopeApplied = scoped.addressIds ? 'assigned_to_me' : 'all';
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
        assigned_user_id: row.assigned_user_id ?? null,
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
