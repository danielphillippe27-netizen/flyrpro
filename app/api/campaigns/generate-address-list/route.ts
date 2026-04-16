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
const DEFAULT_CAMPAIGN_POLYGON_ADDRESS_LIMIT = 5000;
const MAX_POLYGON_ADDRESS_LIMIT = 5000;
const LEGACY_GOLD_RPC_CAP = 2500;

interface GenerateAddressListRequest {
  campaign_id: string;
  address_limit?: number;
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

function goldAddressToFeature(address: {
  id: string;
  street_number?: string | null;
  street_name?: string | null;
  city?: string | null;
  zip?: string | null;
  province?: string | null;
  lat: number;
  lon: number;
}): AddressFeature {
  const houseNumber = address.street_number?.trim() ?? '';
  const streetName = address.street_name?.trim() ?? '';
  const city = address.city?.trim() ?? '';
  const postalCode = address.zip?.trim() ?? '';
  const formatted = [houseNumber, streetName].filter(Boolean).join(' ').trim();
  const locality = city || undefined;
  const label = [formatted, city].filter(Boolean).join(', ');

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [address.lon, address.lat],
    },
    properties: {
      layer: 'addresses',
      id: `gold_${address.id}`,
      gers_id: `gold_${address.id}`,
      label,
      formatted: label || formatted,
      house_number: houseNumber || undefined,
      street_name: streetName || undefined,
      city: locality,
      postal_code: postalCode || undefined,
      state: address.province?.trim() || undefined,
    },
  };
}

function getAddressFeatureKey(feature: AddressFeature): string {
  const { house_number, street_name, city, postal_code } = feature.properties;
  const normalizedAddressKey = [house_number, street_name, city, postal_code]
    .map((value) => value?.trim().toLowerCase() ?? '')
    .join('|');

  if (normalizedAddressKey !== '|||') {
    return normalizedAddressKey;
  }

  return [
    feature.properties.gers_id?.trim().toLowerCase() ?? '',
    feature.geometry.coordinates[0].toFixed(6),
    feature.geometry.coordinates[1].toFixed(6),
  ].join('|');
}

function mergeAddressFeatures(
  preferredFeatures: AddressFeature[],
  supplementalFeatures: AddressFeature[],
  limit: number
): AddressFeature[] {
  const merged = new Map<string, AddressFeature>();

  for (const feature of preferredFeatures) {
    merged.set(getAddressFeatureKey(feature), feature);
  }

  for (const feature of supplementalFeatures) {
    const key = getAddressFeatureKey(feature);
    if (!merged.has(key)) {
      merged.set(key, feature);
    }
    if (merged.size >= limit) break;
  }

  return Array.from(merged.values()).slice(0, limit);
}

async function storeCampaignSnapshot(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  snapshot: Awaited<ReturnType<typeof TileLambdaService.generateSnapshots>>
): Promise<void> {
  await supabaseAdmin.from('campaign_snapshots').upsert({
    campaign_id: campaignId,
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
    const { campaign_id, address_limit, starting_address, count = 50, coordinates: providedCoordinates, polygon } = body;
    const polygonAddressLimit = Math.min(
      MAX_POLYGON_ADDRESS_LIMIT,
      Math.max(1, Number(address_limit ?? DEFAULT_CAMPAIGN_POLYGON_ADDRESS_LIMIT) || DEFAULT_CAMPAIGN_POLYGON_ADDRESS_LIMIT)
    );

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
          regionCode,
          polygonAddressLimit
        );
        
        if (goldAddresses && goldAddresses.length > 0) {
          const goldFeatures = goldAddresses.map((addr: any) => goldAddressToFeature(addr));
          const shouldTopUpFromLambda =
            polygonAddressLimit > LEGACY_GOLD_RPC_CAP && goldAddresses.length >= LEGACY_GOLD_RPC_CAP;

          console.log(
            `[generate-address-list] Found ${goldAddresses.length} Gold addresses.${
              shouldTopUpFromLambda ? ' Legacy Gold RPC cap detected; topping up with Lambda.' : ' Skipping Lambda.'
            }`
          );
          source = 'gold';

          addressFeatures = goldFeatures;

          if (shouldTopUpFromLambda) {
            try {
              const snapshot = await TileLambdaService.generateSnapshots(
                polygon as GeoJSON.Polygon,
                regionCode,
                campaign_id,
                { limitAddresses: polygonAddressLimit, limitBuildings: 0, includeRoads: false }
              );
              const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
              await storeCampaignSnapshot(supabaseAdmin, campaign_id, snapshot);
              addressFeatures = mergeAddressFeatures(
                goldFeatures,
                addressData.features || [],
                polygonAddressLimit
              );
              console.log(
                `[generate-address-list] Topped up Gold addresses to ${addressFeatures.length} total features`
              );
            } catch (lambdaTopUpError: any) {
              console.warn(
                '[generate-address-list] Lambda top-up failed, continuing with Gold-only results:',
                lambdaTopUpError?.message || lambdaTopUpError
              );
            }
          }
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
            { limitAddresses: polygonAddressLimit, limitBuildings: 0, includeRoads: false }
          );
          const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
          addressFeatures = addressData.features || [];
          console.log(`[generate-address-list] Found ${addressFeatures.length} addresses from Lambda`);
          await storeCampaignSnapshot(supabaseAdmin, campaign_id, snapshot);
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
        await storeCampaignSnapshot(supabaseAdmin, campaign_id, snapshot);
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
      const canonicalAddresses: CanonicalCampaignAddress[] = addresses.map((address, index) => {
        const canonical = mapOvertureToCanonical(address as any, campaign_id, index);
        return {
          ...canonical,
          region: canonical.region || regionCode,
        };
      });

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
      const coverageLimitWarning =
        polygon && insertedCount >= polygonAddressLimit
          ? `You hit the maximum of ${polygonAddressLimit} homes. Some homes may be missing, and we recommend redoing the campaign creation.`
          : null;
      console.log(`[generate-address-list] Saved ${insertedCount} addresses (source: ${source})`);

      return NextResponse.json({
        inserted_count: insertedCount,
        preview: inserted ?? [],
        source,
        warning: coverageLimitWarning,
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
