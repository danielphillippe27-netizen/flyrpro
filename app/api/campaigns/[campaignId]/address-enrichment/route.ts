import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ campaignId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { campaignId } = await params;
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  if (!await ensureCampaignAccess(admin, campaignId, user.id)) return NextResponse.json({ error: 'Access denied' }, { status: 404 });
  try {
    const rows = await fetchAllInPages<{ address_resolution_status: string }>(async (from, to) => await admin
      .from('campaign_addresses').select('address_resolution_status').eq('campaign_id', campaignId)
      .not('geometry_target_kind', 'is', null).range(from, to));
    const counts = { pending: 0, confirmed: 0, unresolved: 0 };
    for (const row of rows) {
      if (row.address_resolution_status in counts) counts[row.address_resolution_status as keyof typeof counts] += 1;
    }
    return NextResponse.json(counts, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to read address progress' }, { status: 500 });
  }
}

/** Retry labels only: no campaign recreation, geometry reload, or visit reset. */
export async function POST(request: NextRequest, { params }: Context) {
  const { campaignId } = await params;
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const { data: campaign } = await admin.from('campaigns').select('owner_id,workspace_id').eq('id', campaignId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  let allowed = campaign.owner_id === user.id;
  if (!allowed && campaign.workspace_id) {
    const { data: member } = await admin.from('workspace_members').select('role')
      .eq('workspace_id', campaign.workspace_id).eq('user_id', user.id).maybeSingle();
    allowed = member?.role === 'owner' || member?.role === 'admin';
  }
  if (!allowed) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { error } = await admin.from('campaign_addresses').update({
    address_resolution_status: 'pending', address_resolution_attempts: 0,
    address_resolution_next_at: new Date().toISOString(), address_resolution_lease: null,
    address_resolution_error: null, address_resolution_bundle_pending: true,
  }).eq('campaign_id', campaignId).eq('address_resolution_permanent_allowed', true).eq('address_resolution_status', 'unresolved').eq('formatted', 'Address pending');
  if (error) return NextResponse.json({ error: 'Unable to retry address enrichment' }, { status: 500 });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
