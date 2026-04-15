import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { TileLambdaService } from '@/lib/services/TileLambdaService';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FARM_ADDRESS_LIMIT = 5000;
const INSERT_BATCH_SIZE = 500;

type GenerateFarmAddressListRequest = {
  farm_id: string;
  polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};

function normalizePolygon(candidate: unknown): GeoJSON.Polygon | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const polygon = candidate as { type?: unknown; coordinates?: unknown };
  if (polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) return null;
  const ring = polygon.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return polygon as GeoJSON.Polygon;
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as GenerateFarmAddressListRequest;
    const farmId = body.farm_id?.trim();
    if (!farmId) {
      return NextResponse.json({ error: 'farm_id is required' }, { status: 400 });
    }

    const { data: farm, error: farmError } = await authClient
      .from('farms')
      .select('id, owner_id, polygon, home_limit')
      .eq('id', farmId)
      .maybeSingle();

    if (farmError) {
      return NextResponse.json({ error: farmError.message }, { status: 500 });
    }

    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const polygon =
      normalizePolygon(body.polygon) ??
      (() => {
        if (typeof farm.polygon !== 'string' || !farm.polygon.trim()) return null;
        try {
          return normalizePolygon(JSON.parse(farm.polygon));
        } catch {
          return null;
        }
      })();

    if (!polygon) {
      return NextResponse.json({ error: 'Farm polygon is required to generate homes' }, { status: 400 });
    }

    const resolvedRegion = await resolveCampaignRegion({
      polygon,
    });

    const snapshot = await TileLambdaService.generateSnapshots(
      polygon,
      resolvedRegion.regionCode,
      farmId,
      {
        includeRoads: false,
        limitAddresses: FARM_ADDRESS_LIMIT,
        limitBuildings: FARM_ADDRESS_LIMIT,
      }
    );

    const geojson = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
    const homeLimit = Math.min(FARM_ADDRESS_LIMIT, Number(farm.home_limit ?? FARM_ADDRESS_LIMIT) || FARM_ADDRESS_LIMIT);
    const selected = geojson.features.slice(0, homeLimit);

    const rows = selected.map((feature) => ({
      farm_id: farmId,
      campaign_address_id: null,
      gers_id: feature.properties.gers_id || null,
      formatted: feature.properties.formatted || feature.properties.label,
      house_number: feature.properties.house_number || null,
      street_name: feature.properties.street_name || null,
      locality: feature.properties.city || null,
      region: feature.properties.state || resolvedRegion.regionCode,
      postal_code: feature.properties.postal_code || null,
      source: 'map',
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
      geom: feature.geometry,
      visited_count: 0,
    }));

    const admin = createAdminClient();
    const { error: deleteError } = await admin.from('farm_addresses').delete().eq('farm_id', farmId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      if (batch.length === 0) continue;
      const { error } = await admin.from('farm_addresses').insert(batch);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await admin
      .from('farms')
      .update({
        address_count: rows.length,
        home_limit: homeLimit,
        last_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', farmId);

    return NextResponse.json({
      inserted_count: rows.length,
      warning:
        geojson.features.length > homeLimit
          ? `This farm was capped at ${homeLimit} homes. Draw a smaller area if you need fewer homes in one farm.`
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate farm homes';
    console.error('[farm generate-address-list]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
