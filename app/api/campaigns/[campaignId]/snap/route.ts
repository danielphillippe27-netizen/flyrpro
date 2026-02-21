import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { snapPolygonToRoads } from '@/lib/services/snapping';
import { regionFromPolygon } from '@/lib/geo/regionFromPolygon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toGeoJSONPolygon(
  value: unknown
): { type: 'Polygon'; coordinates: number[][][] } | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.type !== 'Polygon' || !Array.isArray(o.coordinates)) return null;
  const coords = o.coordinates as number[][][];
  if (coords.length === 0 || !Array.isArray(coords[0]) || coords[0].length < 3) return null;
  return { type: 'Polygon', coordinates: coords };
}

/**
 * POST /api/campaigns/[campaignId]/snap
 *
 * 1. Authorize: session + campaign ownership
 * 2. Extract geometry: territory_boundary or campaign_polygon_raw (when re-snapping)
 * 3. Process: SnappingService.snap()
 * 4. Save: update_campaign_boundary RPC
 * 5. Return: { ok, polygon, wasSnapped }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await context.params;
  console.log('[snap] Starting snap request for campaign:', campaignId);

  try {
    const supabaseSession = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabaseSession.auth.getUser();

    if (authError || !user) {
      console.error('[snap] Auth error:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[snap] User authenticated:', user.id);

    const supabase = createAdminClient();
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, territory_boundary, campaign_polygon_raw, is_snapped')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      console.error('[snap] Campaign fetch error:', campaignError);
      return NextResponse.json(
        { error: 'Campaign not found or access denied' },
        { status: 404 }
      );
    }

    if (campaign.owner_id !== user.id) {
      console.error('[snap] Ownership mismatch:', campaign.owner_id, '!=', user.id);
      return NextResponse.json(
        { error: 'Campaign not found or access denied' },
        { status: 404 }
      );
    }

    // Extract geometry: re-snap from raw when already snapped; otherwise use current boundary
    let inputPolygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    if (campaign.is_snapped && campaign.campaign_polygon_raw) {
      console.log('[snap] Using raw polygon (re-snap mode)');
      inputPolygon = toGeoJSONPolygon(campaign.campaign_polygon_raw);
    }
    if (!inputPolygon && campaign.territory_boundary) {
      console.log('[snap] Using territory_boundary polygon');
      inputPolygon = toGeoJSONPolygon(campaign.territory_boundary);
    }

    if (!inputPolygon) {
      console.error('[snap] No valid polygon found');
      return NextResponse.json(
        { error: 'No territory boundary to snap. Draw a polygon first.' },
        { status: 400 }
      );
    }

    console.log('[snap] Input polygon vertices:', inputPolygon.coordinates[0]?.length);

    let snapResult;
    try {
      snapResult = await snapPolygonToRoads(inputPolygon, supabase);
    } catch (snapError) {
      console.error('[snap] snapPolygonToRoads threw error:', snapError);
      return NextResponse.json(
        { error: snapError instanceof Error ? snapError.message : 'Snapping service failed' },
        { status: 500 }
      );
    }

    console.log('[snap] Snap result:', { wasSnapped: snapResult.wasSnapped, vertices: snapResult.polygon.coordinates[0]?.length });

    const rawToSave =
      campaign.is_snapped && campaign.campaign_polygon_raw
        ? campaign.campaign_polygon_raw
        : inputPolygon;

    console.log('[snap] Calling update_campaign_boundary RPC');
    
    const { data: updateResult, error: updateError } = await supabase.rpc(
      'update_campaign_boundary',
      {
        p_campaign_id: campaignId,
        p_boundary_geojson: snapResult.polygon,
        p_raw_geojson: rawToSave,
        p_is_snapped: snapResult.wasSnapped,
      }
    );

    if (updateError) {
      console.error('[snap] update_campaign_boundary error:', updateError);
      return NextResponse.json(
        { error: `Failed to save boundary: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Update campaign.region from polygon so Lambda/Gold use correct tiles (e.g. Vancouver → BC)
    const derivedRegion = regionFromPolygon(snapResult.polygon);
    if (derivedRegion) {
      await supabase
        .from('campaigns')
        .update({ region: derivedRegion })
        .eq('id', campaignId);
      console.log('[snap] Set campaign region:', derivedRegion);
    }

    console.log('[snap] Successfully updated campaign boundary:', updateResult);

    return NextResponse.json({
      ok: true,
      polygon: snapResult.polygon,
      wasSnapped: snapResult.wasSnapped,
    });
  } catch (err) {
    console.error('[snap] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Snap failed' },
      { status: 500 }
    );
  }
}
