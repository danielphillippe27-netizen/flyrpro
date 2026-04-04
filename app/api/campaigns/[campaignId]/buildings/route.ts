import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getCampaignBuildingStatus } from '@/lib/campaignStats';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

function hasPolygonFeatures(featureCollection: unknown): boolean {
  if (!featureCollection || typeof featureCollection !== 'object') return false;
  const features = (featureCollection as { features?: unknown }).features;
  if (!Array.isArray(features)) return false;

  return features.some((feature) => {
    if (!feature || typeof feature !== 'object') return false;
    const geometry = (feature as { geometry?: { type?: unknown } }).geometry;
    const type = geometry?.type;
    return type === 'Polygon' || type === 'MultiPolygon';
  });
}

interface CampaignAccessRow {
  owner_id: string;
  workspace_id: string | null;
  territory_boundary: GeoJSON.Polygon | null;
}

interface GoldBuildingRow {
  id: string;
  area_sqm?: number | null;
  building_type?: string | null;
  geom_geojson?: string | null;
  geom?: unknown;
}

interface CampaignAddressRow {
  id: string;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  building_id: string | null;
  address_status?: string | null;
  visited: boolean | null;
  scans: number | null;
}

function parseGoldBuildingRows(raw: unknown): GoldBuildingRow[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw as GoldBuildingRow[];
  }

  if (typeof raw === 'string') {
    try {
      return parseGoldBuildingRows(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('get_gold_buildings_in_polygon_geojson' in obj) {
      return parseGoldBuildingRows(obj.get_gold_buildings_in_polygon_geojson);
    }
  }

  return [];
}

function toGoldBuildingGeometry(building: GoldBuildingRow): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (typeof building.geom_geojson === 'string' && building.geom_geojson.trim()) {
    try {
      return JSON.parse(building.geom_geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } catch {
      return null;
    }
  }

  if (typeof building.geom === 'string' && building.geom.trim()) {
    try {
      return JSON.parse(building.geom) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } catch {
      return null;
    }
  }

  if (building.geom && typeof building.geom === 'object') {
    const candidate = building.geom as { type?: unknown; coordinates?: unknown };
    if (
      (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
      Array.isArray(candidate.coordinates)
    ) {
      return candidate as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }
  }

  return null;
}

function buildGoldFallbackFeatureCollection(
  goldBuildings: GoldBuildingRow[],
  campaignAddresses: CampaignAddressRow[]
) {
  const addressGroups = new Map<string, CampaignAddressRow[]>();

  for (const address of campaignAddresses) {
    if (address.building_id) {
      const group = addressGroups.get(address.building_id) ?? [];
      group.push(address);
      addressGroups.set(address.building_id, group);
    }
  }

  const features = goldBuildings.flatMap((building) => {
    const geometry = toGoldBuildingGeometry(building);
    if (!geometry) return [];

    const linkedAddresses = addressGroups.get(building.id) ?? [];
    const firstAddress = linkedAddresses[0] ?? null;
    const scansTotal = linkedAddresses.reduce((sum, address) => sum + (address.scans ?? 0), 0);
    const isMatched = linkedAddresses.length > 0;
    const statusRank = { not_visited: 0, visited: 1, hot: 2 } as const;
    const buildingStatus = linkedAddresses.reduce<'not_visited' | 'visited' | 'hot'>(
      (current, address) => {
        const next = getCampaignBuildingStatus(address);
        return statusRank[next] > statusRank[current] ? next : current;
      },
      'not_visited'
    );

    return [{
      type: 'Feature',
      id: building.id,
      geometry,
      properties: {
        id: building.id,
        building_id: building.id,
        gers_id: building.id,
        source: 'gold',
        address_count: linkedAddresses.length,
        address_id: linkedAddresses.length === 1 ? firstAddress?.id ?? null : null,
        address_text: linkedAddresses.length === 1 ? firstAddress?.formatted ?? null : null,
        house_number: linkedAddresses.length === 1 ? firstAddress?.house_number ?? null : null,
        street_name: linkedAddresses.length === 1 ? firstAddress?.street_name ?? null : null,
        address_status: linkedAddresses.length === 1 ? firstAddress?.address_status ?? null : null,
        height: 10,
        height_m: 10,
        min_height: 0,
        area_sqm: building.area_sqm ?? null,
        building_type: building.building_type ?? null,
        feature_type: isMatched ? 'matched_house' : 'orphan',
        feature_status: isMatched ? 'matched' : 'orphan_building',
        status: buildingStatus,
        scans_today: 0,
        scans_total: scansTotal,
      },
    }];
  });

  return {
    type: 'FeatureCollection',
    features,
  } as const;
}

async function fetchGoldFallbackFeatures(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  territoryBoundary: GeoJSON.Polygon | null
) {
  if (!territoryBoundary) {
    console.warn('[API] Gold fallback skipped: campaign has no territory_boundary');
    return null;
  }

  const { data: campaignAddresses, error: addressesError } = await supabase
    .from('campaign_addresses')
    .select('id, formatted, house_number, street_name, building_id, visited, scans, address_statuses(status)')
    .eq('campaign_id', campaignId);

  if (addressesError) {
    console.warn('[API] Gold fallback address query failed:', addressesError.message);
    return null;
  }

  if (!Array.isArray(campaignAddresses)) {
    console.warn('[API] Gold fallback skipped: campaign addresses payload was not an array');
    return null;
  }

  const normalizedAddresses = (campaignAddresses as Array<CampaignAddressRow & {
    address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
  }>).map((address) => ({
    ...address,
    address_status: Array.isArray(address.address_statuses)
      ? address.address_statuses[0]?.status ?? null
      : address.address_statuses?.status ?? null,
  }));

  const linkedBuildingIds = Array.from(
    new Set(
      normalizedAddresses
        .map((address) => address.building_id)
        .filter((buildingId): buildingId is string => typeof buildingId === 'string' && buildingId.length > 0)
    )
  );
  console.log(`[API] Gold fallback found ${linkedBuildingIds.length} linked building ids on campaign addresses`);

  if (linkedBuildingIds.length > 0) {
    const { data: linkedBuildings, error: linkedBuildingsError } = await supabase
      .from('ref_buildings_gold')
      .select('id, area_sqm, building_type, geom')
      .in('id', linkedBuildingIds);

    if (linkedBuildingsError) {
      console.warn('[API] Gold fallback direct linked-building query failed:', linkedBuildingsError.message);
    } else if (Array.isArray(linkedBuildings) && linkedBuildings.length > 0) {
      console.log(`[API] Gold fallback loaded ${linkedBuildings.length} buildings directly by linked ids`);
      const fallback = buildGoldFallbackFeatureCollection(
        linkedBuildings as GoldBuildingRow[],
        normalizedAddresses
      );
      if (fallback.features.length > 0) {
        return fallback;
      }
      console.warn('[API] Gold fallback direct linked-building query returned rows but no renderable geometries');
    }
  }

  const { data: polygonBuildings, error: polygonBuildingsError } = await supabase.rpc(
    'get_gold_buildings_in_polygon_geojson',
    { p_polygon_geojson: JSON.stringify(territoryBoundary) }
  );

  if (polygonBuildingsError) {
    console.warn('[API] Gold fallback polygon building query failed:', polygonBuildingsError.message);
    return null;
  }

  let goldBuildings = parseGoldBuildingRows(polygonBuildings);
  const polygonBuildingCount = goldBuildings.length;
  if (linkedBuildingIds.length > 0) {
    const linkedBuildingSet = new Set(linkedBuildingIds);
    const matchedBuildings = goldBuildings.filter((building) => linkedBuildingSet.has(building.id));
    console.log(
      `[API] Gold fallback matched ${matchedBuildings.length} linked buildings from polygon query (polygon returned ${polygonBuildingCount})`
    );
    goldBuildings = matchedBuildings.length > 0 ? matchedBuildings : goldBuildings;
    if (matchedBuildings.length === 0 && polygonBuildingCount > 0) {
      console.warn('[API] Gold fallback could not reconcile linked building ids with polygon rows; returning polygon buildings for visibility');
    }
  } else {
    console.log(`[API] Gold fallback loaded ${goldBuildings.length} polygon buildings`);
  }

  if (goldBuildings.length === 0) {
    console.warn('[API] Gold fallback found no linked polygon buildings');
    return null;
  }

  const fallback = buildGoldFallbackFeatureCollection(
    goldBuildings,
    normalizedAddresses
  );

  if (fallback.features.length === 0) {
    return null;
  }

  return fallback;
}

/**
 * GET /api/campaigns/[campaignId]/buildings
 * 
 * Returns building GeoJSON for a campaign.
 * - Gold: Direct spatial query of ref_buildings_gold (no linking required)
 * - Silver: Fetch from S3 snapshot
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();

    const { data: campaignAccess, error: campaignAccessError } = await supabase
      .from('campaigns')
      .select('owner_id, workspace_id, territory_boundary')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignAccessError || !campaignAccess) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let allowed = campaignAccess.owner_id === requestUser.id;
    if (!allowed && campaignAccess.workspace_id) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', campaignAccess.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();
      allowed = !!member?.user_id;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    
    // UNIFIED PATH: Use consolidated RPC that handles both Gold and Silver buildings
    // Gold: campaign_addresses.building_id → ref_buildings_gold (polygon features)
    // Silver: building_address_links → buildings table (polygon features)
    // Fallback: address points (when no building polygons are linked)
    console.log('[API] Fetching campaign features via rpc_get_campaign_full_features');
    
    const { data: campaignFeatures, error: featuresError } = await supabase.rpc(
      'rpc_get_campaign_full_features',
      { p_campaign_id: campaignId }
    );
    let fallbackFeatures = campaignFeatures ?? null;

    if (!featuresError && campaignFeatures && campaignFeatures.features?.length > 0) {
      if (hasPolygonFeatures(campaignFeatures)) {
        console.log(
          `[API] Returning ${campaignFeatures.features.length} polygon features ` +
            `(source: ${campaignFeatures.features[0]?.properties?.source || 'unknown'})`
        );
        return NextResponse.json(campaignFeatures);
      }

      console.log('[API] RPC returned point-only features; attempting link repair before fallback');
    } else if (featuresError) {
      console.error('[API] Feature RPC error:', featuresError.message);
    } else {
      console.log('[API] No linked features from RPC');
    }

    // Self-heal: relink on demand for campaigns that have addresses but no polygon links yet.
    // This handles mixed DB states where the provision step may have skipped linker RPCs.
    let repairAttempted = false;
    const campaignRow = campaignAccess as CampaignAccessRow;

    if (campaignRow?.territory_boundary) {
      const { error: goldRepairError } = await supabase.rpc('link_campaign_addresses_gold', {
        p_campaign_id: campaignId,
        p_polygon_geojson: campaignRow.territory_boundary,
      });

      if (goldRepairError) {
        console.warn('[API] Gold link repair failed (continuing):', goldRepairError.message);
      } else {
        repairAttempted = true;
      }
    }

    const { data: allRepairData, error: allRepairError } = await supabase.rpc(
      'link_campaign_addresses_all',
      { p_campaign_id: campaignId }
    );

    if (allRepairError) {
      console.warn('[API] Consolidated link repair failed (continuing):', allRepairError.message);
    } else {
      repairAttempted = true;
      const row = Array.isArray(allRepairData) ? allRepairData[0] : allRepairData;
      console.log('[API] Consolidated link repair result:', row ?? 'ok');
    }

    if (repairAttempted) {
      const { data: repairedFeatures, error: repairedError } = await supabase.rpc(
        'rpc_get_campaign_full_features',
        { p_campaign_id: campaignId }
      );

      if (!repairedError && repairedFeatures && repairedFeatures.features?.length > 0) {
        fallbackFeatures = repairedFeatures;
        if (hasPolygonFeatures(repairedFeatures)) {
          console.log(`[API] Returning ${repairedFeatures.features.length} polygon features after repair`);
          return NextResponse.json(repairedFeatures);
        }
      } else if (repairedError) {
        console.warn('[API] Feature RPC after repair failed:', repairedError.message);
      }
    }

    const goldFallback = await fetchGoldFallbackFeatures(
      supabase,
      campaignId,
      campaignRow?.territory_boundary ?? null
    );

    if (goldFallback) {
      console.log(`[API] Returning ${goldFallback.features.length} Gold polygon features via direct fallback`);
      return NextResponse.json({
        type: 'FeatureCollection',
        features: goldFallback.features,
      });
    }
    
    // SNAPSHOT PATH: Fetch from S3 snapshot when RPC is point-only or empty
    console.log('[API] Trying buildings from S3 snapshot');
    
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, buildings_count')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    
    if (snapshotError || !snapshot?.buildings_key) {
      if (fallbackFeatures?.features?.length > 0) {
        console.log(`[API] No snapshot found, returning ${fallbackFeatures.features.length} point features`);
        return NextResponse.json(fallbackFeatures);
      }

      console.log('[API] No snapshot found, returning empty');
      return NextResponse.json({ type: 'FeatureCollection', features: [] });
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
    
    console.log(`[API] Returning ${geojson.features?.length || 0} Silver buildings from S3`);
    
    return NextResponse.json(geojson);
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
