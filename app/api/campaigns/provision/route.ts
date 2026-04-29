import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService, type LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import { RoutingService } from '@/lib/services/RoutingService';
import { buildRoute } from '@/lib/services/BlockRoutingService';
import { StableLinkerService } from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';
import { GoldAddressService } from '@/lib/services/GoldAddressService';
import { BuildingAdapter } from '@/lib/services/BuildingAdapter';
import { AddressAdapter, type StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { ParcelEnrichmentService } from '@/lib/services/ParcelEnrichmentService';
import { CampaignLinkQualityService } from '@/lib/services/CampaignLinkQualityService';
import { CampaignMapModeService } from '@/lib/services/CampaignMapModeService';
import { isParcelRegionSupported } from '@/lib/geo/parcelRegions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProvisionRequest {
  campaign_id: string;
}

type ProvisionSource = 'gold' | 'silver' | 'lambda';
type ProvisionPhase =
  | 'created'
  | 'source_probed'
  | 'addresses_loading'
  | 'addresses_ready'
  | 'map_ready'
  | 'optimizing'
  | 'optimized'
  | 'failed';

type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

type ExistingSnapshotRow = {
  bucket: string | null;
  prefix: string | null;
  buildings_key: string | null;
  addresses_key: string | null;
  metadata_key: string | null;
  buildings_url: string | null;
  addresses_url: string | null;
  metadata_url: string | null;
  buildings_count: number | null;
  addresses_count: number | null;
  overture_release: string | null;
  tile_metrics: SnapshotTileMetrics | null;
  expires_at: string | null;
};

type ExistingCampaignAddressSignatureRow = {
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  locality: string | null;
  postal_code: string | null;
};

const GOLD_PROBE_LIMIT = 50;
const GOLD_SUCCESS_THRESHOLD = 10;
const DEFAULT_GOLD_ADDRESS_LIMIT = 5000;
const FALLBACK_INSERT_BATCH_SIZE = 500;
const GOLD_HYDRATOR_RPC = 'hydrate_campaign_gold_addresses';
const BULK_ADDRESS_RPC = 'add_campaign_addresses';

class ProvisionError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
    this.name = 'ProvisionError';
  }
}

function isConnectionError(error: Error): boolean {
  return (
    error.message.includes('closed') ||
    error.message.includes('Connection Error') ||
    error.message.includes('established') ||
    error.message.includes('timeout')
  );
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 200
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isConnectionError(lastError) || attempt === maxAttempts) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`[Provision] Retry attempt ${attempt}/${maxAttempts} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('Retry failed');
}

function normalizeRegionCode(regionCode: string | null | undefined): string | null {
  if (typeof regionCode !== 'string') return null;
  const normalized = regionCode.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function deduplicateAddresses(addresses: StandardCampaignAddress[]): StandardCampaignAddress[] {
  return Array.from(
    new Map(
      addresses.map((address) => {
        const houseNumber = String(address.house_number ?? '').toLowerCase().trim();
        const streetName = String(address.street_name ?? '').toLowerCase().trim();
        const locality = String(address.locality ?? '').toLowerCase().trim();
        return [`${houseNumber}|${streetName}|${locality}`, address] as const;
      })
    ).values()
  );
}

function normalizeAddressFragment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildAddressSignature(address: {
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
}): string {
  const houseNumber = normalizeAddressFragment(address.house_number);
  const streetName = normalizeAddressFragment(address.street_name);
  const locality = normalizeAddressFragment(address.locality);
  const postalCode = normalizeAddressFragment(address.postal_code);

  if (houseNumber || streetName || locality) {
    return `${houseNumber}|${streetName}|${locality}`;
  }

  const formatted = normalizeAddressFragment(address.formatted);
  return `${formatted}|${postalCode}`;
}

async function fetchCampaignAddressSignatures(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('campaign_addresses')
    .select('formatted, house_number, street_name, locality, postal_code')
    .eq('campaign_id', campaignId);

  if (error) {
    throw new Error(`Failed to fetch campaign address signatures: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as ExistingCampaignAddressSignatureRow[]).map((row) => buildAddressSignature(row))
  );
}

function filterAddressesAgainstExisting(
  addresses: StandardCampaignAddress[],
  existingSignatures: Set<string>
): StandardCampaignAddress[] {
  const accepted: StandardCampaignAddress[] = [];
  const seenThisBatch = new Set<string>();

  for (const address of addresses) {
    const signature = buildAddressSignature(address);
    if (existingSignatures.has(signature) || seenThisBatch.has(signature)) {
      continue;
    }
    seenThisBatch.add(signature);
    accepted.push(address);
  }

  return accepted;
}

function mergeGoldProbeWithLambdaAddresses(
  goldProbeRows: any[],
  lambdaAddresses: Array<Record<string, unknown>>,
  campaignId: string,
  regionCode: string
): Array<Record<string, unknown>> {
  if (goldProbeRows.length === 0) {
    return lambdaAddresses;
  }

  const normalizedRegion = normalizeRegionCode(regionCode);
  const goldAsCampaign = goldProbeRows.map((address: any) => ({
    campaign_id: campaignId,
    formatted: `${address.street_number} ${address.street_name}${address.unit ? ` ${address.unit}` : ''}, ${address.city}`,
    house_number: address.street_number,
    street_name: address.street_name,
    locality: address.city,
    region: normalizeRegionCode(address.province) ?? normalizedRegion,
    postal_code: address.zip,
    coordinate: { lat: address.lat, lon: address.lon },
    geom: address.geom_geojson,
    source: 'gold' as const,
    gers_id: null,
  }));

  const merged = new Map<string, Record<string, unknown>>();

  for (const address of lambdaAddresses) {
    const key = `${String(address.house_number ?? '').toLowerCase()}|${String(address.street_name ?? '').toLowerCase()}`;
    merged.set(key, address);
  }

  for (const address of goldAsCampaign) {
    const key = `${String(address.house_number ?? '').toLowerCase()}|${String(address.street_name ?? '').toLowerCase()}`;
    merged.set(key, address);
  }

  return Array.from(merged.values()).slice(0, DEFAULT_GOLD_ADDRESS_LIMIT);
}

function isSnapshotReusable(snapshot: ExistingSnapshotRow | null | undefined): snapshot is ExistingSnapshotRow {
  if (!snapshot?.buildings_url || !snapshot.addresses_url || !snapshot.expires_at) {
    return false;
  }

  return new Date(snapshot.expires_at) > new Date();
}

function snapshotRowToLambdaSnapshot(
  campaignId: string,
  snapshot: ExistingSnapshotRow
): LambdaSnapshotResponse {
  return {
    campaign_id: campaignId,
    bucket: snapshot.bucket ?? '',
    prefix: snapshot.prefix ?? '',
    counts: {
      buildings: snapshot.buildings_count ?? 0,
      addresses: snapshot.addresses_count ?? 0,
      roads: 0,
    },
    s3_keys: {
      buildings: snapshot.buildings_key ?? '',
      addresses: snapshot.addresses_key ?? '',
      metadata: snapshot.metadata_key ?? '',
    },
    urls: {
      buildings: snapshot.buildings_url ?? '',
      addresses: snapshot.addresses_url ?? '',
      metadata: snapshot.metadata_url ?? '',
    },
    metadata: {
      elapsed_ms: 0,
      snapshot_size_bytes: 0,
      overture_release: snapshot.overture_release ?? undefined,
      tile_metrics: snapshot.tile_metrics ?? undefined,
    },
  };
}

async function countCampaignAddresses(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('campaign_addresses')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);

  if (error) {
    throw new Error(`Failed to count campaign addresses: ${error.message}`);
  }

  return count ?? 0;
}

async function bulkInsertAddresses(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  addresses: StandardCampaignAddress[]
): Promise<number> {
  if (addresses.length === 0) {
    return countCampaignAddresses(supabase, campaignId);
  }

  const { error: rpcError } = await supabase.rpc(BULK_ADDRESS_RPC, {
    p_campaign_id: campaignId,
    p_addresses: addresses,
  });

  if (!rpcError) {
    return countCampaignAddresses(supabase, campaignId);
  }

  console.warn('[Provision] add_campaign_addresses RPC failed, falling back to batched inserts:', rpcError.message);

  for (let from = 0; from < addresses.length; from += FALLBACK_INSERT_BATCH_SIZE) {
    const batch = addresses.slice(from, from + FALLBACK_INSERT_BATCH_SIZE);
    const { error: insertError } = await supabase
      .from('campaign_addresses')
      .insert(batch);

    if (insertError) {
      throw new Error(`Fallback address insert failed: ${insertError.message}`);
    }
  }

  return countCampaignAddresses(supabase, campaignId);
}

async function hydrateGoldAddressesViaRpc(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  polygon: GeoJSON.Polygon,
  regionCode: string
): Promise<number> {
  const { error } = await supabase.rpc(GOLD_HYDRATOR_RPC, {
    p_campaign_id: campaignId,
    p_polygon_geojson: JSON.stringify(polygon),
    p_province: normalizeRegionCode(regionCode),
    p_limit: DEFAULT_GOLD_ADDRESS_LIMIT,
  });

  if (error) {
    throw new Error(error.message);
  }

  return countCampaignAddresses(supabase, campaignId);
}

async function updateCampaignProvision(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .update(patch)
    .eq('id', campaignId);

  if (error) {
    throw new Error(`Failed to update campaign provisioning state: ${error.message}`);
  }
}

async function upsertSnapshotMetadata(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  snapshot: LambdaSnapshotResponse | null
): Promise<void> {
  if (!snapshot || !snapshot.bucket) {
    return;
  }

  const { error } = await supabase
    .from('campaign_snapshots')
    .upsert(
      {
        campaign_id: campaignId,
        bucket: snapshot.bucket,
        prefix: snapshot.prefix,
        buildings_key: snapshot.s3_keys.buildings,
        addresses_key: snapshot.s3_keys.addresses,
        metadata_key: snapshot.s3_keys.metadata,
        buildings_url: snapshot.urls.buildings,
        addresses_url: snapshot.urls.addresses,
        metadata_url: snapshot.urls.metadata,
        buildings_count: snapshot.counts.buildings,
        addresses_count: snapshot.counts.addresses,
        overture_release: snapshot.metadata?.overture_release,
        tile_metrics: snapshot.metadata?.tile_metrics ?? null,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        onConflict: 'campaign_id',
      }
    );

  if (error) {
    throw new Error(`Failed to store snapshot metadata: ${error.message}`);
  }
}

async function runCampaignPostProcessing(params: {
  campaignId: string;
  polygon: GeoJSON.Polygon;
  regionCode: string;
  source: ProvisionSource;
  snapshot: LambdaSnapshotResponse | null;
  insertedCount: number;
}) {
  const { campaignId, polygon, regionCode, source, snapshot, insertedCount } = params;
  const supabase = createAdminClient();

  await updateCampaignProvision(supabase, campaignId, {
    provision_phase: 'optimizing',
  });

  try {
    let effectiveSnapshot = snapshot;
    let effectiveInsertedCount = insertedCount;

    if (source === 'silver' && !effectiveSnapshot) {
      console.log('[Provision] Silver seeded from Gold; generating Lambda snapshot + address top-up in background...');

      effectiveSnapshot = await TileLambdaService.generateSnapshots(
        polygon,
        regionCode,
        campaignId,
        {
          limitBuildings: 10000,
          limitAddresses: 10000,
          includeRoads: false,
        }
      );

      await upsertSnapshotMetadata(supabase, campaignId, effectiveSnapshot);

      const addressData = await TileLambdaService.downloadAddresses(effectiveSnapshot.urls.addresses);
      const lambdaAddresses = TileLambdaService.convertToCampaignAddresses(
        addressData.features,
        campaignId,
        regionCode
      );
      const normalizedLambdaAddresses = AddressAdapter.normalizeArray(
        lambdaAddresses,
        campaignId,
        regionCode
      );
      const dedupedLambdaAddresses = deduplicateAddresses(normalizedLambdaAddresses);
      const existingSignatures = await fetchCampaignAddressSignatures(supabase, campaignId);
      const lambdaTopUpAddresses = filterAddressesAgainstExisting(
        dedupedLambdaAddresses,
        existingSignatures
      );

      if (lambdaTopUpAddresses.length > 0) {
        console.log(
          `[Provision] Silver background top-up inserting ${lambdaTopUpAddresses.length} Lambda addresses after Gold seed`
        );
        effectiveInsertedCount = await bulkInsertAddresses(
          supabase,
          campaignId,
          lambdaTopUpAddresses
        );
        await updateCampaignProvision(supabase, campaignId, {
          addresses_ready_at: new Date().toISOString(),
        });
      } else {
        effectiveInsertedCount = await countCampaignAddresses(supabase, campaignId);
      }
    }

    const goldBuildings =
      source === 'gold'
        ? (await GoldAddressService.getBuildingsForPolygon(polygon)).buildings
        : null;

    const { buildings: normalizedBuildingsGeoJSON, overtureRelease } =
      await BuildingAdapter.fetchAndNormalize(goldBuildings ?? null, effectiveSnapshot, undefined);

    let optimizedPathGeometry: GeoJSON.LineString | null = null;
    let optimizedPathInfo: {
      totalDistanceKm: number;
      totalTimeMinutes: number;
      waypointCount: number;
    } | null = null;

    if (effectiveInsertedCount >= 2) {
      console.log('[Provision] Stage 1: Building route for ALL addresses (Street-Block-Sweep-Snake)...');
      try {
        const addressesForRoute = await fetchAllInPages<{
          id: string;
          geom: { coordinates: [number, number] };
          house_number: string | null;
          street_name: string | null;
          formatted: string | null;
        }>((from, to) =>
          supabase
            .from('campaign_addresses')
            .select('id, geom, house_number, street_name, formatted')
            .eq('campaign_id', campaignId)
            .order('id', { ascending: true })
            .range(from, to)
        );

        if (addressesForRoute.length >= 2) {
          const buildRouteAddresses = addressesForRoute.map((address) => ({
            id: address.id,
            lat: address.geom.coordinates[1],
            lon: address.geom.coordinates[0],
            house_number: address.house_number ?? undefined,
            street_name: address.street_name ?? undefined,
            formatted: address.formatted ?? undefined,
          }));

          const sumLat = buildRouteAddresses.reduce((sum, address) => sum + address.lat, 0);
          const sumLon = buildRouteAddresses.reduce((sum, address) => sum + address.lon, 0);
          const depot = {
            lat: sumLat / buildRouteAddresses.length,
            lon: sumLon / buildRouteAddresses.length,
          };

          const routeResult = await buildRoute(buildRouteAddresses, depot, {
            include_geometry: !!process.env.STADIA_API_KEY,
            threshold_meters: 50,
            sweep_nn_threshold_m: 500,
          });

          optimizedPathInfo = {
            totalDistanceKm: 0,
            totalTimeMinutes: 0,
            waypointCount: routeResult.stops.length,
          };

          if (routeResult.geometry) {
            optimizedPathGeometry = RoutingService.toGeoJSONLineString(routeResult.geometry.polyline);
            optimizedPathInfo.totalDistanceKm = routeResult.geometry.distance_m / 1000;
            optimizedPathInfo.totalTimeMinutes = Math.round(routeResult.geometry.time_sec / 60);
          }

          const { error: pathError } = await supabase
            .from('campaign_snapshots')
            .update({
              optimized_path_geometry: optimizedPathGeometry,
              optimized_path_distance_km: optimizedPathInfo.totalDistanceKm,
              optimized_path_time_minutes: optimizedPathInfo.totalTimeMinutes,
            })
            .eq('campaign_id', campaignId);

          if (pathError) {
            console.warn('[Provision] Error storing optimized path:', pathError.message);
          }

          await Promise.all(
            routeResult.stops.map((stop, index) =>
              supabase
                .from('campaign_addresses')
                .update({
                  cluster_id: 1,
                  sequence: index,
                  seq: index,
                })
                .eq('id', stop.id)
            )
          );
        }
      } catch (routingError) {
        console.warn('[Provision] Routing calculation failed:', routingError);
      }
    }

    let parcelPreparation:
      | Awaited<ReturnType<ParcelEnrichmentService['prepareParcelsForProvision']>>
      | null = null;
    const parcelEnrichment = isParcelRegionSupported(regionCode)
      ? new ParcelEnrichmentService(supabase)
      : null;

    if (parcelEnrichment) {
      try {
        parcelPreparation = await parcelEnrichment.prepareParcelsForProvision(campaignId);
      } catch (parcelError) {
        console.warn('[Provision] Parcel preparation failed before linking:', parcelError);
      }
    }

    console.log('[Provision] Spatial linker: Running canonical TypeScript spatial join...');
    let spatialJoinSummary = {
      matched: 0,
      orphans: 0,
      suspect: 0,
      avgConfidence: 0,
      coveragePercent: 0,
      matchBreakdown: {
        containmentVerified: 0,
        containmentSuspect: 0,
        pointOnSurface: 0,
        parcelVerified: 0,
        proximityVerified: 0,
        proximityFallback: 0,
      },
    };

    const linkerService = new StableLinkerService(supabase);
    spatialJoinSummary = await linkerService.runSpatialJoin(
      campaignId,
      normalizedBuildingsGeoJSON as any,
      overtureRelease,
      {
        parcels:
          parcelPreparation?.status === 'ready' && parcelPreparation.parcelCount > 0
            ? parcelPreparation.parcels.map((parcel) => ({
                externalId: parcel.externalId,
                geometry: parcel.geometry,
              }))
            : undefined,
        resetExisting: true,
        persistenceMode: source === 'gold' ? 'gold' : 'silver',
      }
    );

    console.log('[Provision] Gold Standard Townhouse Splitter: Processing multi-unit buildings...');
    let townhouseSummary = {
      total_buildings: 0,
      townhouses_detected: 0,
      apartments_skipped: 0,
      units_created: 0,
      errors_logged: 0,
      avg_units_per_townhouse: 0,
    };

    try {
      const splitterService = new TownhouseSplitterService(supabase);
      townhouseSummary = await splitterService.processCampaignTownhouses(
        campaignId,
        normalizedBuildingsGeoJSON as any,
        overtureRelease
      );
    } catch (splitterError) {
      console.warn('[Provision] Townhouse splitting failed:', splitterError);
    }

    const linkQualityService = new CampaignLinkQualityService(supabase);
    const linkQuality = await linkQualityService.assessPersistedLinks(campaignId);
    await linkQualityService.persist(campaignId, linkQuality);

    const mapModeService = new CampaignMapModeService(supabase);
    const mapModeAssessment = await mapModeService.computeAndPersist(campaignId, {
      totalAddresses: effectiveInsertedCount,
      hasParcels: (parcelPreparation?.parcelCount ?? 0) > 0,
      parcelCount: parcelPreparation?.parcelCount ?? 0,
    });

    if (
      linkQuality.repairRecommended &&
      parcelEnrichment &&
      parcelPreparation &&
      parcelPreparation.status !== 'ready'
    ) {
      await linkQualityService.updateStatus(
        campaignId,
        'repairing',
        linkQuality.reason ? `Repair queued: ${linkQuality.reason}` : 'Repair queued after degraded first-pass linking.'
      );
      await parcelEnrichment.runForCampaign(campaignId);
      await mapModeService.computeAndPersist(campaignId, {
        totalAddresses: effectiveInsertedCount,
      });
    }

    await updateCampaignProvision(supabase, campaignId, {
      provision_phase: 'optimized',
      optimized_at: new Date().toISOString(),
      has_parcels: mapModeAssessment.hasParcels,
      building_link_confidence: mapModeAssessment.buildingLinkConfidence,
      map_mode: mapModeAssessment.mapMode,
    });

    console.log('[Provision] Background post-processing complete:', {
      campaignId,
      matched: spatialJoinSummary.matched,
      unitsCreated: townhouseSummary.units_created,
      mapMode: mapModeAssessment.mapMode,
      addresses: effectiveInsertedCount,
    });
  } catch (error) {
    console.error('[Provision] Deferred post-processing failed:', error);
    await updateCampaignProvision(supabase, campaignId, {
      provision_phase: 'failed',
    }).catch((updateError) => {
      console.error('[Provision] Failed to persist deferred failure state:', updateError);
    });
  }
}

export async function POST(request: NextRequest) {
  console.log('[Provision] Starting staged map-ready provisioning...');
  console.log('[Provision] Lambda URL exists?', !!process.env.SLICE_LAMBDA_URL);
  console.log('[Provision] Secret exists?', !!process.env.SLICE_SHARED_SECRET);

  let campaignId: string | null = null;

  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ProvisionRequest = await request.json();
    campaignId = body.campaign_id;

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    if (!process.env.SLICE_LAMBDA_URL || !process.env.SLICE_SHARED_SECRET) {
      throw new ProvisionError(
        'Lambda not configured. Set SLICE_LAMBDA_URL and SLICE_SHARED_SECRET.',
        500
      );
    }

    const supabase = createAdminClient();

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, workspace_id, territory_boundary, region, bbox')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const isOwner = campaign.owner_id === requestUser.id;
    let canProvision = isOwner;
    if (!canProvision && campaign.workspace_id) {
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', campaign.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();
      const role = membership?.role ?? null;
      canProvision = role === 'owner' || role === 'admin';
    }

    if (!canProvision) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const polygon = campaign.territory_boundary;
    if (!polygon) {
      throw new ProvisionError(
        'No territory boundary defined. Please draw a polygon on the map when creating the campaign.',
        400
      );
    }

    const regionResolution = await resolveCampaignRegion({
      currentRegion: campaign.region,
      polygon,
      bbox: campaign.bbox,
    });
    const regionCode = regionResolution.regionCode;

    if (regionResolution.shouldPersist) {
      const { error: regionUpdateError } = await supabase
        .from('campaigns')
        .update({ region: regionCode })
        .eq('id', campaignId);
      if (regionUpdateError) {
        console.warn('[Provision] Failed to persist inferred region:', regionUpdateError.message);
      }
    }

    const readyAt = new Date().toISOString();
    await updateCampaignProvision(supabase, campaignId, {
      provision_status: 'pending',
      provision_phase: 'created',
      provision_source: null,
      provisioned_at: null,
      addresses_ready_at: null,
      map_ready_at: null,
      optimized_at: null,
      has_parcels: false,
      building_link_confidence: 0,
      map_mode: 'standard_pins',
      parcel_enrichment_status: 'not_started',
      link_quality_status: 'unknown',
      link_quality_score: 0,
      link_quality_reason: null,
      link_quality_checked_at: null,
      link_quality_metrics: {},
    });

    const result = await retryWithBackoff(async () => {
      let addressSource: ProvisionSource = 'lambda';
      let snapshot: LambdaSnapshotResponse | null = null;
      let addressesToInsert: StandardCampaignAddress[] = [];
      let deferSilverLambdaTopUp = false;

      const existingAddressCount = await countCampaignAddresses(supabase, campaignId!);

      const { data: existingSnapshotRow } = await supabase
        .from('campaign_snapshots')
        .select(
          'bucket, prefix, buildings_key, addresses_key, metadata_key, buildings_url, addresses_url, metadata_url, buildings_count, addresses_count, overture_release, tile_metrics, expires_at'
        )
        .eq('campaign_id', campaignId!)
        .maybeSingle();

      const existingSnapshot = (existingSnapshotRow ?? null) as ExistingSnapshotRow | null;

      if (isSnapshotReusable(existingSnapshot ?? null)) {
        addressSource = 'lambda';
        snapshot = snapshotRowToLambdaSnapshot(campaignId!, existingSnapshot);
        console.log('[Provision] Reusing snapshot from campaign_snapshots (skip Lambda generation)');
      } else {
        const goldProbeRows = await GoldAddressService.fetchAddressesInPolygon(
          polygon as GeoJSON.Polygon,
          regionCode,
          GOLD_PROBE_LIMIT
        );

        console.log(`[Provision] Gold probe returned ${goldProbeRows.length} address rows`);

        if (goldProbeRows.length >= GOLD_SUCCESS_THRESHOLD) {
          addressSource = 'gold';
        } else if (goldProbeRows.length > 0) {
          addressSource = 'silver';
          deferSilverLambdaTopUp = true;
        } else {
          addressSource = 'lambda';
          snapshot = await TileLambdaService.generateSnapshots(
            polygon as GeoJSON.Polygon,
            regionCode,
            campaignId!,
            {
              limitBuildings: 10000,
              limitAddresses: 10000,
              includeRoads: false,
            }
          );

          if (existingAddressCount === 0) {
            const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
            const lambdaAddresses = TileLambdaService.convertToCampaignAddresses(
              addressData.features,
              campaignId!,
              regionCode
            ) as Array<Record<string, unknown>>;
            const mergedAddresses = mergeGoldProbeWithLambdaAddresses(
              goldProbeRows,
              lambdaAddresses,
              campaignId!,
              regionCode
            );
            addressesToInsert = AddressAdapter.normalizeArray(
              mergedAddresses,
              campaignId!,
              regionCode
            );
          }
        }
      }

      await updateCampaignProvision(supabase, campaignId!, {
        provision_source: addressSource,
        provision_phase: 'source_probed',
      });

      let finalAddressCount = existingAddressCount;
      await updateCampaignProvision(supabase, campaignId!, {
        provision_phase: 'addresses_loading',
      });

      if (finalAddressCount === 0) {
        if (addressSource === 'gold' || deferSilverLambdaTopUp) {
          try {
            finalAddressCount = await hydrateGoldAddressesViaRpc(
              supabase,
              campaignId!,
              polygon as GeoJSON.Polygon,
              regionCode
            );
          } catch (hydratorError) {
            console.warn('[Provision] Gold hydrator RPC failed, falling back to backend bulk ingest:', hydratorError);
            const fullGoldAddresses = await GoldAddressService.fetchAddressesInPolygon(
              polygon as GeoJSON.Polygon,
              regionCode,
              DEFAULT_GOLD_ADDRESS_LIMIT
            );
            addressesToInsert = AddressAdapter.normalizeArray(
              fullGoldAddresses,
              campaignId!,
              regionCode
            );
            addressesToInsert = deduplicateAddresses(addressesToInsert);
            finalAddressCount = await bulkInsertAddresses(supabase, campaignId!, addressesToInsert);
          }
        } else {
          addressesToInsert = deduplicateAddresses(addressesToInsert);
          finalAddressCount = await bulkInsertAddresses(supabase, campaignId!, addressesToInsert);
        }
      }

      if (finalAddressCount <= 0) {
        throw new ProvisionError(
          'Provisioning did not find any addresses in this territory. Try a larger polygon or a nearby area.',
          422
        );
      }

      await updateCampaignProvision(supabase, campaignId!, {
        provision_phase: 'addresses_ready',
        addresses_ready_at: readyAt,
      });

      await upsertSnapshotMetadata(supabase, campaignId!, snapshot);

      const parcelEnrichmentStatus = isParcelRegionSupported(regionCode) ? 'queued' : 'skipped';
      if (parcelEnrichmentStatus === 'queued') {
        await new ParcelEnrichmentService(supabase).markQueued(campaignId!);
      }

      await updateCampaignProvision(supabase, campaignId!, {
        provision_status: 'ready',
        provision_phase: 'map_ready',
        provision_source: addressSource,
        provisioned_at: readyAt,
        map_ready_at: readyAt,
        has_parcels: false,
        building_link_confidence: 0,
        map_mode: 'standard_pins',
        parcel_enrichment_status: parcelEnrichmentStatus,
      });

      after(async () => {
        await runCampaignPostProcessing({
          campaignId: campaignId!,
          polygon: polygon as GeoJSON.Polygon,
          regionCode,
          source: addressSource,
          snapshot,
          insertedCount: finalAddressCount,
        });
      });

      return {
        success: true,
        campaign_id: campaignId,
        addresses_saved: finalAddressCount,
        buildings_saved: snapshot?.counts.buildings ?? 0,
        source: addressSource,
        links_created: 0,
        units_created: 0,
        has_parcels: false,
        building_link_confidence: 0,
        map_mode: 'standard_pins',
        linked_address_count: 0,
        total_campaign_addresses: finalAddressCount,
        provision_status: 'ready',
        provision_phase: 'map_ready',
        provision_source: addressSource,
        map_ready: true,
        optimized: false,
        postprocess_deferred: true,
        parcel_enrichment_status: parcelEnrichmentStatus,
        map_layers: snapshot
          ? {
              buildings: snapshot.urls.buildings,
            }
          : {
              buildings: null,
            },
        snapshot_metadata: snapshot
          ? {
              bucket: snapshot.bucket,
              prefix: snapshot.prefix,
              overture_release: snapshot.metadata?.overture_release,
              tile_metrics: snapshot.metadata?.tile_metrics,
            }
          : {
              bucket: null,
              prefix: null,
              source: deferSilverLambdaTopUp ? 'gold_seeded_lambda_deferred' : 'gold_standard',
            },
        warning: snapshot?.warning ?? null,
        message:
          `${addressSource === 'gold' ? 'Gold' : addressSource === 'silver' ? 'Gold-seeded Silver' : 'Lambda'} campaign is map-ready: ` +
          `${finalAddressCount} leads loaded. ` +
          `${deferSilverLambdaTopUp ? 'Lambda top-up, ' : ''}` +
          `route optimization, building linking, townhouse splitting, and parcel enrichment will continue in the background.`,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Provision] Error:', error);

    if (campaignId) {
      try {
        const supabase = createAdminClient();
        await supabase
          .from('campaigns')
          .update({
            provision_status: 'failed',
            provision_phase: 'failed',
          })
          .eq('id', campaignId);
      } catch (updateError) {
        console.error('[Provision] Failed to update provision_status:', updateError);
      }
    }

    const status = error instanceof ProvisionError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Provisioning failed';
    return NextResponse.json(
      {
        error: message,
        provision_status: 'failed',
        provision_phase: 'failed',
      },
      { status }
    );
  }
}
