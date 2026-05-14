import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  buildCampaignMapGeometry,
  type CampaignMapSnapshotRow,
} from '@/lib/map/campaignMapGeometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withNoStore(init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return { ...init, headers };
}

function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, withNoStore(init));
}

function apiBaseUrl(request: NextRequest) {
  const configured = request.nextUrl.origin.replace(/\/+$/, '');
  return configured === 'https://flyrpro.app'
    ? 'https://www.flyrpro.app'
    : configured;
}

async function latestCursor(supabase: ReturnType<typeof createAdminClient>, campaignId: string) {
  let cursor: string | null = null;

  const { data: addressRows } = await supabase
    .from('campaign_addresses')
    .select('updated_at')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1);

  const addressCursor = Array.isArray(addressRows)
    ? (addressRows[0] as { updated_at?: string } | undefined)?.updated_at ?? null
    : null;
  if (addressCursor) cursor = addressCursor;

  const { data: statusRows } = await supabase
    .from('address_statuses')
    .select('updated_at')
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1);

  const statusCursor = Array.isArray(statusRows)
    ? (statusRows[0] as { updated_at?: string } | undefined)?.updated_at ?? null
    : null;
  if (statusCursor && (!cursor || Date.parse(statusCursor) > Date.parse(cursor))) {
    cursor = statusCursor;
  }

  return cursor ?? new Date().toISOString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, bbox, region, provision_status')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return json({ error: 'Campaign not found' }, { status: 404 });
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, addresses_key, buildings_url, addresses_url, metadata_key, buildings_count, created_at, tile_metrics')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (snapshotError) {
    return json(
      { error: 'Failed to load campaign geometry snapshot', details: snapshotError.message },
      { status: 500 }
    );
  }

  const stateCursor = await latestCursor(supabase, campaignId);
  const geometry = await buildCampaignMapGeometry({
    campaignId,
    snapshot: snapshot as CampaignMapSnapshotRow | null,
    campaign: campaign as { bbox?: unknown; region?: string | null; provision_status?: string | null },
    baseUrl: apiBaseUrl(request),
    stateCursor,
  });

  return json(geometry);
}
