import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { createClient, type User } from '@supabase/supabase-js';
import { TileLambdaService, type AddressFeature } from '@/lib/services/TileLambdaService';
import { GoldAddressService } from '@/lib/services/GoldAddressService';
import { MapService } from '@/lib/services/MapService';
import { mapOvertureToCanonical } from '@/lib/geo/overtureToCanonical';
import type { CanonicalCampaignAddress } from '@/lib/geo/types';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

async function getRequestUser(request: NextRequest): Promise<User | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ') && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const token = authHeader.slice(7);
    const bearerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error,
    } = await bearerClient.auth.getUser();
    if (!error && user) return user;
    console.warn('[generate-address-list] Bearer auth failed, trying cookie session:', error?.message);
  }

  const supabaseSession = await getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabaseSession.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateAddressListRequest = await request.json();
    const { campaign_id, starting_address, count = 50, coordinates: providedCoordinates, polygon } = body;

    if (!campaign_id) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
    if (!starting_address && !polygon) {
      return NextResponse.json({ error: 'Either starting_address or polygon is required' }, { status: 400 });
    }

    // 1. Require authenticated user (Bearer token for iOS or cookie session for web)
    const user = await getRequestUser(request);
    if (!user) {
      console.error('[generate-address-list] Unauthorized: no valid bearer token or session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Campaign lookup with admin client
    let supabaseAdmin;
    try {
      supabaseAdmin = createAdminClient();
    } catch (err: any) {
      console.error('[generate-address-list] Admin client failed:', err?.message);
      return NextResponse.json(
        { error: 'Server configuration error.' },
        { status: 503 }
      );
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('owner_id, region, territory_boundary, bbox')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      console.error('[generate-address-list] Campaign lookup failed:', campaignError);
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

    const regionResolution = await resolveCampaignRegion({
      currentRegion: campaign.region,
      polygon: polygon ?? campaign.territory_boundary,
      bbox: campaign.bbox,
    });
    const regionCode = regionResolution.regionCode;

    if (regionResolution.shouldPersist) {
      const { error: regionUpdateError } = await supabaseAdmin
        .from('campaigns')
        .update({ region: regionCode })
        .eq('id', campaign_id);

      if (regionUpdateError) {
        console.warn('[generate-address-list] Failed to persist inferred campaign region:', regionUpdateError.message);
      } else {
        console.log('[generate-address-list] Updated campaign region:', {
          region: regionCode,
          source: regionResolution.source,
          reason: regionResolution.reason,
        });
      }
    }

    let addressFeatures: AddressFeature[] = [];
    let source = 'lambda';

    // =============================================================================
    // STEP 1: CHECK GOLD STANDARD FIRST (Polygon Mode)
    // =============================================================================
    if (polygon) {
      console.log('[generate-address-list] Polygon mode: Checking Gold Standard first...');
      
      try {
        const goldAddresses = await GoldAddressService.fetchAddressesInPolygon(
          polygon as GeoJSON.Polygon,
          regionCode
        );
        
        if (goldAddresses && goldAddresses.length > 0) {
          console.log(`[generate-address-list] Found ${goldAddresses.length} Gold addresses. Skipping Lambda.`);
          source = 'gold';
          
          // Convert Gold addresses to AddressFeature format
          addressFeatures = goldAddresses.map((addr: any) => ({
            type: 'Feature' as const,
            geometry: JSON.parse(addr.geom_geojson),
            properties: {
              gers_id: `gold_${addr.id}`, // Generate pseudo-GERS ID
              house_number: addr.street_number,
              street_name: addr.street_name,
              city: addr.city,
              postal_code: addr.zip,
              state: addr.province,
              formatted: `${addr.street_number} ${addr.street_name}, ${addr.city}`,
              source: 'gold'
            }
          }));
        } else {
          console.log('[generate-address-list] No Gold addresses found, falling back to Lambda...');
        }
      } catch (err: any) {
        console.warn('[generate-address-list] Gold query failed:', err.message);
      }
      
      // Fallback to Lambda if Gold is empty
      if (addressFeatures.length === 0) {
        if (!process.env.SLICE_LAMBDA_URL || !process.env.SLICE_SHARED_SECRET) {
          return NextResponse.json(
            { error: 'Lambda not configured.' },
            { status: 500 }
          );
        }
        
        try {
          const snapshot = await TileLambdaService.generateSnapshots(
            polygon as GeoJSON.Polygon,
            regionCode,
            campaign_id,
            { limitAddresses: 5000, limitBuildings: 0, includeRoads: false }
          );
          const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
          addressFeatures = addressData.features || [];
          console.log(`[generate-address-list] Found ${addressFeatures.length} addresses from Lambda`);
          // Store snapshot so provision can reuse (avoid duplicate Lambda call)
          await supabaseAdmin.from('campaign_snapshots').upsert({
            campaign_id,
            bucket: snapshot.bucket,
            prefix: snapshot.prefix,
            buildings_key: snapshot.s3_keys.buildings,
            addresses_key: snapshot.s3_keys.addresses,
            roads_key: snapshot.s3_keys.roads ?? null,
            metadata_key: snapshot.s3_keys.metadata,
            buildings_url: snapshot.urls.buildings,
            addresses_url: snapshot.urls.addresses,
            roads_url: snapshot.urls.roads ?? null,
            metadata_url: snapshot.urls.metadata,
            buildings_count: snapshot.counts.buildings,
            addresses_count: snapshot.counts.addresses,
            roads_count: snapshot.counts.roads ?? 0,
            overture_release: snapshot.metadata?.overture_release ?? null,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }, { onConflict: 'campaign_id' });
        } catch (err: any) {
          console.error('[generate-address-list] Lambda polygon error:', err);
          const msg = err.message || String(err);
          const is502 = msg.includes('502');
          const userMessage = is502
            ? 'Address service temporarily failed (502). If this persists, the Lambda may be timing out or the Silver address file may be missing—check CloudWatch Logs for flyr-slice-lambda.'
            : `Address data error: ${msg}`;
          return NextResponse.json(
            { error: userMessage },
            { status: 500 }
          );
        }
      }
    } else if (starting_address) {
      // Closest-home mode - always use Lambda (Gold doesn't have search by address)
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
        // Store snapshot so provision can reuse (avoid duplicate Lambda call)
        await supabaseAdmin.from('campaign_snapshots').upsert({
          campaign_id,
          bucket: snapshot.bucket,
          prefix: snapshot.prefix,
          buildings_key: snapshot.s3_keys.buildings,
          addresses_key: snapshot.s3_keys.addresses,
          roads_key: snapshot.s3_keys.roads ?? null,
          metadata_key: snapshot.s3_keys.metadata,
          buildings_url: snapshot.urls.buildings,
          addresses_url: snapshot.urls.addresses,
          roads_url: snapshot.urls.roads ?? null,
          metadata_url: snapshot.urls.metadata,
          buildings_count: snapshot.counts.buildings,
          addresses_count: snapshot.counts.addresses,
          roads_count: snapshot.counts.roads ?? 0,
          overture_release: snapshot.metadata?.overture_release ?? null,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'campaign_id' });
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

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('campaign_addresses')
        .insert(rawInsertData)
        .select('id, formatted, house_number, street_name, locality, postal_code');

      if (insertError) {
        console.error('[generate-address-list] Insert error:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      const insertedCount = inserted?.length ?? 0;
      console.log(`[generate-address-list] Saved ${insertedCount} addresses (source: ${source})`);

      return NextResponse.json({
        inserted_count: insertedCount,
        preview: inserted ?? [],
        source,
        message: `${insertedCount} addresses generated successfully (${source === 'gold' ? 'Gold Standard' : 'Lambda'})`,
      });
    } catch (err: any) {
      console.error('[generate-address-list] Processing error:', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  } catch (err: any) {
    console.error('[generate-address-list] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
