import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { TileLambdaService, type AddressFeature } from '@/lib/services/TileLambdaService';
import { MapService } from '@/lib/services/MapService';
import { mapOvertureToCanonical } from '@/lib/geo/overtureToCanonical';
import type { CanonicalCampaignAddress } from '@/lib/geo/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GenerateAddressListRequest {
  campaign_id: string;
  starting_address?: string;
  count?: number;
  coordinates?: {
    lat: number;
    lng: number;
  };
  polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

/** Address shape compatible with mapOvertureToCanonical */
interface LambdaAddressShape {
  gers_id: string;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  house_number?: string;
  street?: string;
  locality?: string;
  postcode?: string;
  region?: string;
  formatted?: string;
}

/** Convert Lambda AddressFeature to shape expected by mapOvertureToCanonical */
function lambdaFeatureToAddressShape(f: AddressFeature): LambdaAddressShape {
  return {
    gers_id: f.properties.gers_id,
    geometry: f.geometry,
    house_number: f.properties.house_number,
    street: f.properties.street_name,
    locality: f.properties.city,
    postcode: f.properties.postal_code,
    region: f.properties.state,
    formatted: f.properties.formatted || f.properties.label,
  };
}

/** Build a ~2km bbox polygon around a point (for closest-home mode). */
function bboxPolygonAroundPoint(lat: number, lon: number, radiusKm: number = 2): GeoJSON.Polygon {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - lngDelta, lat - latDelta],
      [lon + lngDelta, lat - latDelta],
      [lon + lngDelta, lat + latDelta],
      [lon - lngDelta, lat + latDelta],
      [lon - lngDelta, lat - latDelta],
    ]],
  };
}

/** Sort addresses by distance to (lat, lon) and return the first `limit`. */
function sortByDistanceAndTake(
  features: AddressFeature[],
  lat: number,
  lon: number,
  limit: number
): AddressFeature[] {
  const withDistance = features.map((f) => {
    const [lng, featLat] = f.geometry.coordinates;
    const distance = Math.sqrt(
      Math.pow((featLat - lat) * 111, 2) +
        Math.pow((lng - lon) * 111 * Math.cos((lat * Math.PI) / 180), 2)
    );
    return { f, distance };
  });
  withDistance.sort((a, b) => a.distance - b.distance);
  return withDistance.slice(0, limit).map((x) => x.f);
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.SLICE_LAMBDA_URL || !process.env.SLICE_SHARED_SECRET) {
      return NextResponse.json(
        { error: 'Lambda not configured. Set SLICE_LAMBDA_URL and SLICE_SHARED_SECRET.' },
        { status: 500 }
      );
    }

    const body: GenerateAddressListRequest = await request.json();
    const { campaign_id, starting_address, count = 50, coordinates: providedCoordinates, polygon } = body;

    if (!campaign_id) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
    if (!starting_address && !polygon) {
      return NextResponse.json({ error: 'Either starting_address or polygon is required' }, { status: 400 });
    }

    // 1. Require authenticated user (session) – identifies who is making the request
    const supabaseSession = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await supabaseSession.auth.getUser();
    if (authError || !user) {
      console.error('[generate-address-list] No session:', authError?.message);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Campaign lookup with admin client (sees all rows; same DB as create) then enforce ownership
    let supabaseAdmin;
    try {
      supabaseAdmin = createAdminClient();
    } catch (err: any) {
      console.error('[generate-address-list] Admin client failed:', err?.message);
      return NextResponse.json(
        {
          error: 'Server configuration error. Set SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase Dashboard → Project Settings → API → service_role).',
        },
        { status: 503 }
      );
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('owner_id, region')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      console.error('[generate-address-list] Campaign lookup failed:', {
        campaign_id,
        user_id: user.id,
        code: campaignError?.code,
        message: campaignError?.message,
      });
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

    console.log('[generate-address-list] Campaign found:', campaign_id);

    const regionCode = (campaign.region || 'ON').toUpperCase();

    let addressFeatures: AddressFeature[] = [];

    if (polygon) {
      console.log('[generate-address-list] Polygon mode: fetching addresses via Lambda...');
      try {
        const snapshot = await TileLambdaService.generateSnapshots(
          polygon as GeoJSON.Polygon,
          regionCode,
          campaign_id,
          { limitAddresses: 5000, limitBuildings: 0, includeRoads: false }
        );
        const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
        addressFeatures = addressData.features || [];
        console.log(`[generate-address-list] Found ${addressFeatures.length} addresses from polygon`);
      } catch (err: any) {
        console.error('[generate-address-list] Lambda polygon error:', err);
        return NextResponse.json(
          { error: `Address data error: ${err.message}` },
          { status: 500 }
        );
      }
    } else if (starting_address) {
      let coordinates: { lat: number; lon: number };

      if (providedCoordinates) {
        coordinates = { lat: providedCoordinates.lat, lon: providedCoordinates.lng };
      } else {
        try {
          const geocoded = await MapService.geocodeAddress(starting_address);
          if (!geocoded) throw new Error(`Geocoding returned null for: ${starting_address}`);
          coordinates = geocoded;
        } catch (err: any) {
          console.error('Geocoding failed:', err);
          return NextResponse.json({ error: `Geocoding failed: ${err.message}` }, { status: 400 });
        }
      }

      console.log(`[generate-address-list] Closest-home mode: querying Lambda for ${count} addresses near point...`);
      try {
        const bboxPolygon = bboxPolygonAroundPoint(coordinates.lat, coordinates.lon, 2);
        const snapshot = await TileLambdaService.generateSnapshots(
          bboxPolygon,
          regionCode,
          campaign_id,
          {
            limitAddresses: Math.max(count * 2, 500),
            limitBuildings: 0,
            includeRoads: false,
          }
        );
        const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
        const allFeatures = addressData.features || [];
        addressFeatures = sortByDistanceAndTake(allFeatures, coordinates.lat, coordinates.lon, count);
        console.log(`[generate-address-list] Found ${addressFeatures.length} nearest addresses`);
      } catch (err: any) {
        console.error('[generate-address-list] Lambda closest-home error:', err);
        return NextResponse.json(
          { error: `Address data error: ${err.message}` },
          { status: 500 }
        );
      }
    }

    if (!addressFeatures.length) {
      return NextResponse.json({
        inserted_count: 0,
        preview: [],
        message: polygon ? 'No addresses found in polygon' : 'No addresses found near location',
      });
    }

    const addresses: LambdaAddressShape[] = addressFeatures.map(lambdaFeatureToAddressShape);

    try {
      const canonicalAddresses: CanonicalCampaignAddress[] = addresses.map((address, index) =>
        // Cast to any because mapOvertureToCanonical expects OvertureAddress but our LambdaAddressShape is compatible
        mapOvertureToCanonical(address as any, campaign_id, index)
      );

      const rawInsertData = canonicalAddresses.map((addr) => ({
        campaign_id: addr.campaign_id,
        formatted: addr.formatted,
        postal_code: addr.postal_code,
        source: addr.source,
        visited: addr.visited || false,
        geom: addr.geom,
        gers_id: addr.gers_id,
        house_number: addr.house_number || null,
        street_name: addr.street_name || null,
        locality: addr.locality || null,
        region: addr.region || null,
        building_gers_id: addr.building_gers_id || null,
      }));

      const itemsWithGersId = rawInsertData.filter((item) => item.gers_id != null && item.gers_id !== '');

      if (itemsWithGersId.length === 0) {
        throw new Error('No addresses with gers_id found. All addresses must have a gers_id from Overture.');
      }

      const uniqueInsertData = Array.from(
        new Map(itemsWithGersId.map((item) => [`${item.campaign_id}-${item.gers_id}`, item])).values()
      );

      const { data: insertedData, error: insertError } = await supabaseAdmin
        .from('campaign_addresses')
        .upsert(uniqueInsertData, { onConflict: 'campaign_id,gers_id' })
        .select();

      if (insertError) {
        console.error('[generate-address-list] Upsert failed:', insertError);
        throw new Error(`Supabase Upsert Error: ${insertError.message}`);
      }

      const insertedCount = insertedData?.length || 0;

      const { count: totalCount } = await supabaseAdmin
        .from('campaign_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id);

      if (totalCount !== null) {
        await supabaseAdmin.from('campaigns').update({ total_flyers: totalCount }).eq('id', campaign_id);
      }

      try {
        await supabaseAdmin.rpc('update_campaign_bbox', { p_campaign_id: campaign_id });
      } catch {
        // Non-critical
      }

      const preview = (insertedData || []).slice(0, 10).map((addr) => ({
        id: addr.id,
        formatted: addr.formatted,
        postal_code: addr.postal_code,
        source: addr.source,
        gers_id: addr.gers_id,
      }));

      return NextResponse.json({ inserted_count: insertedCount, preview });
    } catch (err: any) {
      console.error('Database Step Error:', err);
      return NextResponse.json({ error: `Database Error: ${err.message}` }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Unhandled API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}
