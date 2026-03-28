import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  mapTiledecodeFeatureToUpsertPayload,
  buildUpsertMetadataFromPayloads,
  type TiledecodeRoadsResponse,
} from '@/lib/geo/roads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/[campaignId]/roads/prepare
 *
 * 1. Auth + campaign access (owner or workspace member)
 * 2. Set roads_status = 'fetching'
 * 3. Call tiledecode_roads edge function with campaign bbox + polygon
 * 4. Map features to p_roads and call rpc_upsert_campaign_roads
 * 5. On error: set roads_status = 'failed' with message
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;

  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, workspace_id, territory_boundary, bbox')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let allowed = campaign.owner_id === requestUser.id;
    if (!allowed && campaign.workspace_id) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', campaign.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();
      allowed = !!member?.user_id;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const polygon = campaign.territory_boundary as GeoJSON.Polygon | null | undefined;
    const bbox = campaign.bbox as number[] | null | undefined;
    if (!polygon?.coordinates?.length || !bbox || bbox.length < 4) {
      return NextResponse.json(
        { error: 'Campaign has no territory boundary or bbox. Draw a polygon on the map first.' },
        { status: 400 }
      );
    }

    const [minLon, minLat, maxLon, maxLat] = bbox;
    const polygonRing = polygon.coordinates[0];
    if (!polygonRing || polygonRing.length < 3) {
      return NextResponse.json(
        { error: 'Invalid campaign polygon' },
        { status: 400 }
      );
    }

    // Set status to fetching
    const { error: statusError } = await supabase.rpc('rpc_update_road_preparation_status', {
      p_campaign_id: campaignId,
      p_status: 'fetching',
      p_error_message: null,
    });
    if (statusError) {
      console.warn('[roads/prepare] rpc_update_road_preparation_status fetching:', statusError.message);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      await supabase.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: 'Supabase not configured',
      });
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const body = {
      minLat: Number(minLat),
      minLon: Number(minLon),
      maxLat: Number(maxLat),
      maxLon: Number(maxLon),
      zoom: 14,
      polygon: polygonRing,
    };

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/tiledecode_roads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const message = fetchErr instanceof Error ? fetchErr.message : 'Edge function request failed';
      await supabase.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: message,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }

    if (!response.ok) {
      const text = await response.text();
      let errMessage = `tiledecode_roads returned ${response.status}`;
      try {
        const json = JSON.parse(text);
        if (json?.message) errMessage = json.message;
        else if (json?.error) errMessage = json.error;
      } catch {
        if (text) errMessage = text.slice(0, 200);
      }
      await supabase.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: errMessage,
      });
      return NextResponse.json({ error: errMessage }, { status: 502 });
    }

    let data: TiledecodeRoadsResponse;
    try {
      data = await response.json();
    } catch {
      await supabase.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: 'Invalid JSON from tiledecode_roads',
      });
      return NextResponse.json(
        { error: 'Invalid response from road tile service' },
        { status: 502 }
      );
    }

    const features = data?.features ?? [];
    const p_roads = features.map((f) => mapTiledecodeFeatureToUpsertPayload(f));
    const p_metadata = buildUpsertMetadataFromPayloads(p_roads);

    const { data: upsertResult, error: upsertError } = await supabase.rpc('rpc_upsert_campaign_roads', {
      p_campaign_id: campaignId,
      p_roads,
      p_metadata,
    });

    if (upsertError) {
      await supabase.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: upsertError.message,
      });
      return NextResponse.json(
        { error: upsertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      road_count: (upsertResult as { road_count?: number })?.road_count ?? p_roads.length,
      cache_version: (upsertResult as { cache_version?: number })?.cache_version ?? 0,
    });
  } catch (err) {
    console.error('[roads/prepare] Error:', err);
    try {
      const failClient = createAdminClient();
      await failClient.rpc('rpc_update_road_preparation_status', {
        p_campaign_id: campaignId,
        p_status: 'failed',
        p_error_message: String(err),
      });
    } catch {
      // ignore — best effort
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preparation failed' },
      { status: 500 }
    );
  }
}
