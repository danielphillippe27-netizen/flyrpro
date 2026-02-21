import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { gunzipSync } from 'zlib';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Build GeoJSON polygon from campaign column (object, or GeoJSON string from PostGIS). */
function toGeoJSONPolygon(
  value: unknown
): { type: 'Polygon'; coordinates: number[][][] } | null {
  if (value == null) return null;
  let o: Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      o = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof value === 'object') {
    o = value as Record<string, unknown>;
  } else {
    return null;
  }
  if (o.type === 'Polygon' && Array.isArray(o.coordinates)) return o as { type: 'Polygon'; coordinates: number[][][] };
  return null;
}

/**
 * Fetch Gold buildings in the campaign polygon (no linking required).
 * Used so we always return building polygons when possible even if linker didn't run.
 */
async function getUnlinkedGoldBuildings(
  supabase: SupabaseClient,
  campaignId: string
): Promise<GeoJSON.FeatureCollection> {
  const { data: campaign, error: campError } = await supabase
    .from('campaigns')
    .select('territory_boundary, campaign_polygon_snapped, campaign_polygon_raw')
    .eq('id', campaignId)
    .maybeSingle();

  if (campError || !campaign) return { type: 'FeatureCollection', features: [] };

  const polygon =
    toGeoJSONPolygon(campaign.territory_boundary) ??
    toGeoJSONPolygon(campaign.campaign_polygon_snapped) ??
    toGeoJSONPolygon(campaign.campaign_polygon_raw);
  if (!polygon) {
    console.log('[API] getUnlinkedGoldBuildings: no campaign polygon (territory_boundary/snapped/raw)');
    return { type: 'FeatureCollection', features: [] };
  }

  const polygonStr = JSON.stringify(polygon);
  const { data: rows, error } = await supabase.rpc('get_gold_buildings_in_polygon_geojson', {
    p_polygon_geojson: polygonStr,
  });

  if (error) {
    console.warn('[API] get_gold_buildings_in_polygon_geojson error:', error.message);
    return { type: 'FeatureCollection', features: [] };
  }
  if (!rows?.length) {
    console.log('[API] getUnlinkedGoldBuildings: RPC returned 0 buildings in polygon');
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature[] = rows.map((row: {
    id: string;
    source_id: string | null;
    external_id: string | null;
    area_sqm: number | null;
    geom_geojson: string;
    centroid_geojson: string | null;
    building_type: string | null;
  }) => {
    let geometry: GeoJSON.Geometry;
    try {
      geometry = JSON.parse(row.geom_geojson || '{}') as GeoJSON.Geometry;
    } catch {
      geometry = { type: 'Polygon', coordinates: [] };
    }
    return {
      type: 'Feature',
      id: row.id,
      geometry,
      properties: {
        id: row.id,
        feature_id: row.id,
        gers_id: row.id,
        source_id: row.source_id,
        external_id: row.external_id,
        area_sqm: row.area_sqm,
        building_type: row.building_type,
        source: 'gold',
        height: 14,
        height_m: 14,
        min_height: 0,
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * GET /api/campaigns/[campaignId]/buildings
 *
 * Returns building GeoJSON for a campaign. Always returns building polygons when
 * possible, even if address-to-building linking didn't run or failed.
 * - Linked: rpc_get_campaign_full_features (Gold: campaign_addresses.building_id; Silver: building_address_links)
 * - Unlinked Gold: get_gold_buildings_in_polygon_geojson using campaign polygon (no link required)
 * - Silver: S3 snapshot
 * - Fallback: address points or empty
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  
  try {
    const supabase = createAdminClient();
    let fallbackAddressPoints: unknown = null;
    
    // UNIFIED PATH: Use consolidated RPC that handles both Gold and Silver buildings
    // Gold: campaign_addresses.building_id → ref_buildings_gold (polygon features)
    // Silver: building_address_links → buildings table (polygon features)
    // Fallback: address points (when no building polygons are linked)
    console.log('[API] Fetching campaign features via rpc_get_campaign_full_features');
    
    const { data: campaignFeatures, error: featuresError } = await supabase.rpc(
      'rpc_get_campaign_full_features',
      { p_campaign_id: campaignId }
    );
    
    if (!featuresError && campaignFeatures && campaignFeatures.features?.length > 0) {
      const source = campaignFeatures.features[0]?.properties?.source || 'unknown';
      if (source !== 'address_point') {
        console.log(`[API] Returning ${campaignFeatures.features.length} building features (source: ${source})`);
        return NextResponse.json(campaignFeatures);
      }
      console.log('[API] RPC returned address_point fallback, trying S3 polygons first');
      fallbackAddressPoints = campaignFeatures;
    }
    
    if (featuresError) {
      console.error('[API] Feature RPC error:', featuresError.message);
    } else {
      console.log('[API] No linked buildings found via RPC');
    }

    // Always post buildings when possible: if no links or RPC failed, return unlinked Gold buildings in campaign polygon
    const unlinkedGoldFirst = await getUnlinkedGoldBuildings(supabase, campaignId);
    if (unlinkedGoldFirst.features.length > 0) {
      console.log(`[API] Returning ${unlinkedGoldFirst.features.length} unlinked Gold buildings (no link required)`);
      return NextResponse.json(unlinkedGoldFirst);
    }
    if (featuresError) {
      console.log('[API] Unlinked Gold buildings: 0 (campaign polygon may be missing or no Gold data in area)');
    }

    // SILVER PATH: Fetch from S3 snapshot
    console.log('[API] Trying Silver buildings (S3 snapshot)');
    
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, buildings_count')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    
    if (snapshotError || !snapshot?.buildings_key) {
      if (fallbackAddressPoints) {
        console.log('[API] No snapshot, returning address_point fallback');
        return NextResponse.json(fallbackAddressPoints);
      }
      console.log('[API] No snapshot found, returning empty');
      return NextResponse.json({
        type: 'FeatureCollection',
        features: []
      });
    }
    
    console.log(`[API] Fetching from S3: ${snapshot.bucket}/${snapshot.buildings_key}`);
    
    // Fetch fresh from S3
    const command = new GetObjectCommand({
      Bucket: snapshot.bucket,
      Key: snapshot.buildings_key,
    });
    
    const response = await s3Client.send(command);
    const bodyBuffer = await response.Body?.transformToByteArray();
    
    if (!bodyBuffer) {
      throw new Error('Empty response from S3');
    }
    
    // Decompress gzip content
    const decompressed = gunzipSync(Buffer.from(bodyBuffer));
    const geojson = JSON.parse(decompressed.toString('utf-8'));
    
    const s3Count = geojson.features?.length || 0;
    if (s3Count > 0) {
      console.log(`[API] Returning ${s3Count} Silver buildings from S3`);
      return NextResponse.json(geojson);
    }

    if (fallbackAddressPoints) {
      console.log('[API] S3 buildings empty, returning address_point fallback');
      return NextResponse.json(fallbackAddressPoints);
    }

    return NextResponse.json({ type: 'FeatureCollection', features: [] });
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
