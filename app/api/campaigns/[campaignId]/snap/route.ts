import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { snapPolygonToRoads } from '@/lib/services/snapping';

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

  try {
    const supabaseSession = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabaseSession.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, territory_boundary, campaign_polygon_raw, is_snapped')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found or access denied' },
        { status: 404 }
      );
    }

    if (campaign.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Campaign not found or access denied' },
        { status: 404 }
      );
    }

    // Extract geometry: re-snap from raw when already snapped; otherwise use current boundary
    let inputPolygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    if (campaign.is_snapped && campaign.campaign_polygon_raw) {
      inputPolygon = toGeoJSONPolygon(campaign.campaign_polygon_raw);
    }
    if (!inputPolygon && campaign.territory_boundary) {
      inputPolygon = toGeoJSONPolygon(campaign.territory_boundary);
    }

    if (!inputPolygon) {
      return NextResponse.json(
        { error: 'No territory boundary to snap. Draw a polygon first.' },
        { status: 400 }
      );
    }

    const { polygon, wasSnapped } = await snapPolygonToRoads(inputPolygon, supabase);

    const rawToSave =
      campaign.is_snapped && campaign.campaign_polygon_raw
        ? campaign.campaign_polygon_raw
        : inputPolygon;

    const { data: updateResult, error: updateError } = await supabase.rpc(
      'update_campaign_boundary',
      {
        p_campaign_id: campaignId,
        p_boundary_geojson: polygon,
        p_raw_geojson: rawToSave,
        p_is_snapped: wasSnapped,
      }
    );

    if (updateError) {
      console.error('[snap] update_campaign_boundary error:', updateError);
      return NextResponse.json(
        { error: 'Failed to save boundary' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      polygon,
      wasSnapped,
    });
  } catch (err) {
    console.error('[snap] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Snap failed' },
      { status: 500 }
    );
  }
}
