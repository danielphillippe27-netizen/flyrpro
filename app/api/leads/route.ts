import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LeadRow = {
  id: string;
  campaign_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  status?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  address?: string | null;
  building_id?: string | null;
  campaign_address_id?: string | null;
  session_id?: string | null;
};

function isMissingRelation(error: { message?: string; details?: string | null }, relation: string) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes(relation.toLowerCase()) && (text.includes('does not exist') || text.includes('not find'));
}

function isMissingColumn(error: { message?: string; details?: string | null }) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes('column') && (text.includes('does not exist') || text.includes('could not find'));
}

function mapLead(row: LeadRow, fallbackCampaignId: string) {
  return {
    id: row.id,
    campaignId: row.campaign_id ?? fallbackCampaignId,
    fullName: row.full_name || row.name || 'Lead',
    outcome: row.status || 'new',
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    address: row.address ?? null,
    buildingId: row.building_id ?? null,
    campaignAddressId: row.campaign_address_id ?? null,
    sessionId: row.session_id ?? null,
  };
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const campaignId = request.nextUrl.searchParams.get('campaignId')?.trim() ?? '';
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const admin = createAdminClient();
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );

  const baseSelect = 'id, campaign_id, full_name, name, status, created_at';
  const enrichedSelect = `${baseSelect}, email, phone, notes, address, building_id, campaign_address_id, session_id`;

  const buildQuery = (selectColumns: string) => {
    let query = admin
    .from('contacts')
    .select(selectColumns)
    .order('created_at', { ascending: false })
    .limit(200);
    if (campaignId) query = query.eq('campaign_id', campaignId);
    if (workspace.workspaceId) query = query.eq('workspace_id', workspace.workspaceId);
    else query = query.eq('user_id', requestUser.id);
    return query;
  };

  let { data, error } = await buildQuery(enrichedSelect);
  if (error && isMissingColumn(error)) {
    const fallback = await buildQuery(baseSelect);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    if (isMissingRelation(error, 'contacts')) return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(((data ?? []) as unknown as LeadRow[]).map((row) => mapLead(row, campaignId)));
}
