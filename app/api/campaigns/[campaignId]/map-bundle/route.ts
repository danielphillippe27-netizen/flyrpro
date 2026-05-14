import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';

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

  const { data, error } = await supabase.rpc('rpc_get_campaign_map_bundle', {
    p_campaign_id: campaignId,
  });

  if (error) {
    return json(
      {
        error: 'Failed to load campaign map bundle',
        details: error.message,
      },
      { status: 500 }
    );
  }

  return json(data ?? {
    campaign_id: campaignId,
    status: 'pending',
    phase: 'pending',
    map_ready: false,
    addresses: { type: 'FeatureCollection', features: [] },
    buildings: { type: 'FeatureCollection', features: [] },
    parcels: { type: 'FeatureCollection', features: [] },
    roads: { type: 'FeatureCollection', features: [] },
    counts: { addresses: 0, buildings: 0, parcels: 0, roads: 0 },
  });
}
