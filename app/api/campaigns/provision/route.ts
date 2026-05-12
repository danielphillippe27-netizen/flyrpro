import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService, type LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import { RoutingService } from '@/lib/services/RoutingService';
import { buildRoute } from '@/lib/services/BlockRoutingService';
import {
  StableLinkerService,
  type BuildingFeature as StableBuildingFeature,
} from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService, type BuildingFeature as TownhouseBuildingFeature } from '@/lib/services/TownhouseSplitterService';
import { GoldAddressService } from '@/lib/services/GoldAddressService';
import { BuildingAdapter } from '@/lib/services/BuildingAdapter';
import { AddressAdapter, type StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import {
  ParcelEnrichmentService,
} from '@/lib/services/ParcelEnrichmentService';
import { CampaignLinkQualityService } from '@/lib/services/CampaignLinkQualityService';
import {
  CampaignMapModeService,
} from '@/lib/services/CampaignMapModeService';
import { isParcelRegionSupported } from '@/lib/geo/parcelRegions';
import { triggerDiamondBuild } from '@/lib/diamond/buildTrigger';
import { triggerWhiteGoldBuild } from '@/lib/white-gold/buildTrigger';

// Maps province/state codes to bedrock provision source values.
// The old 'lambda' source is now 'diamond' (CloudFront/S3 tile pipeline).
// The old 'gold'/'silver' sources are now regional bedrock values.
// See MIGRATIONS.md and Daniel's schema update for full context.
const CANADA_REGION_CODES = new Set([
  'BC','AB','SK','MB','ON','QC','NB','NS','PE','NL','YT','NT','NU'
]);

function regionCodeToProvisionSource(
  regionCode: string
): 'bedrock_ca' | 'bedrock_us' | 'bedrock_au' | 'bedrock_nz' {
  if (CANADA_REGION_CODES.has(regionCode.toUpperCase())) return 'bedrock_ca';
  // Default to bedrock_us for US states and unknown regions.
  // bedrock_au and bedrock_nz are not yet used in the provision flow.
  return 'bedrock_us';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProvisionRequest {
  campaign_id: string;
  allow_gold?: boolean;
  geometry_tier?: 'diamond' | 'white_gold' | 'standard';
}

type ProvisionSource = 'diamond' | 'bedrock_ca' | 'bedrock_us' | 'bedrock_au' | 'bedrock_nz';
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
  source: string | null;
  source_id: string | null;
  gers_id: string | null;
};

const GOLD_SUCCESS_THRESHOLD = 10;
const DEFAULT_GOLD_ADDRESS_LIMIT = 5000;
const FALLBACK_INSERT_BATCH_SIZE = 500;
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

function normalizeSource(value: string | null | undefined): string {
  const normalized = normalizeAddressFragment(value);
  return normalized || 'unknown';
}

function normalizeExternalAddressId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function externalAddressId(address: { gers_id?: string | null; source_id?: string | null }): string {
  return normalizeExternalAddressId(address.gers_id ?? address.source_id);
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

function buildAddressIdentity(address: {
  campaign_id: string;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  source?: string | null;
  source_id?: string | null;
  gers_id?: string | null;
}): string {
  const source = normalizeSource(address.source);
  const externalId = externalAddressId(address);
  if (externalId) {
    return `${address.campaign_id}|${source}|external|${externalId}`;
  }

  return `${address.campaign_id}|${source}|address|${buildAddressSignature(address)}`;
}

function deduplicateAddressesByProvisionKey(
  addresses: StandardCampaignAddress[]
): StandardCampaignAddress[] {
  const deduped = new Map<string, StandardCampaignAddress>();

  for (const address of addresses) {
    const externalId = externalAddressId(address);
    deduped.set(buildAddressIdentity(address), {
      ...address,
      gers_id: externalId || null,
    });
  }

  return [...deduped.values()];
}

async function fetchCampaignAddressSignatures(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('campaign_addresses')
    .select('formatted, house_number, street_name, locality, postal_code, source, source_id, gers_id')
    .eq('campaign_id', campaignId);

  if (error) {
    throw new Error(`Failed to fetch campaign address signatures: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as ExistingCampaignAddressSignatureRow[]).map((row) =>
      buildAddressIdentity({
        campaign_id: campaignId,
        formatted: row.formatted,
        house_number: row.house_number,
        street_name: row.street_name,
        locality: row.locality,
        postal_code: row.postal_code,
        source: row.source,
        source_id: row.source_id,
        gers_id: row.gers_id,
      })
    )
  );
}

function filterAddressesAgainstExisting(
  addresses: StandardCampaignAddress[],
  existingSignatures: Set<string>
): StandardCampaignAddress[] {
  const accepted: StandardCampaignAddress[] = [];
  const seenThisBatch = new Set<string>();

  for (const address of addresses) {
    const signature = buildAddressIdentity(address);
    if (existingSignatures.has(signature) || seenThisBatch.has(signature)) {
      continue;
    }
    seenThisBatch.add(signature);
    accepted.push(address);
  }

  return accepted;
}

function isUniqueConstraintError(error: { message?: string; code?: string; details?: string } | null): boolean {
  if (!error) {
    return false;
  }

  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return error.code === '23505' || text.includes('unique') || text.includes('constraint') || text.includes('conflict');
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
  const uniqueAddresses = deduplicateAddressesByProvisionKey(addresses).filter((address) => {
    const hasPoint =
      Number.isFinite(Number(address.lat)) &&
      Number.isFinite(Number(address.lon));
    if (!hasPoint) {
      console.warn('[Provision] Skipping address without usable coordinates:', {
        formatted: address.formatted,
        gers_id: address.gers_id,
      });
    }
    return hasPoint;
  });

  if (uniqueAddresses.length === 0) {
    return countCampaignAddresses(supabase, campaignId);
  }

  const existingSignatures = await fetchCampaignAddressSignatures(supabase, campaignId);
  const addressesToWrite = filterAddressesAgainstExisting(uniqueAddresses, existingSignatures);

  if (addressesToWrite.length === 0) {
    return countCampaignAddresses(supabase, campaignId);
  }

  const countBeforeRpc = await countCampaignAddresses(supabase, campaignId);
  const { error: rpcError } = await supabase.rpc(BULK_ADDRESS_RPC, {
    p_campaign_id: campaignId,
    p_addresses: addressesToWrite,
  });

  if (!rpcError) {
    const countAfterRpc = await countCampaignAddresses(supabase, campaignId);
    if (countAfterRpc > countBeforeRpc) {
      return countAfterRpc;
    }

    console.warn(
      '[Provision] add_campaign_addresses RPC completed without inserting rows; falling back to batched upserts'
    );
  } else {
    console.warn('[Provision] add_campaign_addresses RPC failed, falling back to batched inserts:', rpcError.message);
  }

  for (let from = 0; from < addressesToWrite.length; from += FALLBACK_INSERT_BATCH_SIZE) {
    const batch = addressesToWrite.slice(from, from + FALLBACK_INSERT_BATCH_SIZE).map((address) => ({
      campaign_id: address.campaign_id,
      address: address.formatted,
      formatted: address.formatted,
      house_number: address.house_number ?? null,
      street_name: address.street_name ?? null,
      locality: address.locality ?? null,
      region: address.region ?? null,
      postal_code: address.postal_code ?? null,
      source: address.source,
      gers_id: address.gers_id ?? null,
      source_id: address.gers_id ?? null,
      coordinate: address.coordinate ?? { lat: address.lat, lon: address.lon },
      geom: address.geom,
      visited: false,
    }));
    const { error: insertError } = await upsertCampaignAddressBatch(supabase, batch);

    if (insertError) {
      throw new Error(`Fallback address insert failed: ${insertError.message}`);
    }
  }

  return countCampaignAddresses(supabase, campaignId);
}

async function upsertCampaignAddressBatch(
  supabase: ReturnType<typeof createAdminClient>,
  batch: Array<Record<string, unknown>>
) {
  const gersResult = await supabase
    .from('campaign_addresses')
    .upsert(batch, {
      onConflict: 'campaign_id,gers_id',
      ignoreDuplicates: false,
    });

  if (!isUniqueConstraintError(gersResult.error)) {
    return gersResult;
  }

  console.warn(
    '[Provision] campaign/gers upsert hit a unique constraint; retrying campaign/source_id:',
    gersResult.error?.message ?? 'unknown unique constraint'
  );

  const sourceIdResult = await supabase
    .from('campaign_addresses')
    .upsert(batch, {
      onConflict: 'campaign_id,source_id',
      ignoreDuplicates: false,
    });

  if (!isUniqueConstraintError(sourceIdResult.error)) {
    return sourceIdResult;
  }

  console.warn(
    '[Provision] campaign/source_id upsert still hit a unique constraint; falling back to duplicate-tolerant row inserts:',
    sourceIdResult.error?.message ?? 'unknown unique constraint'
  );

  for (const address of batch) {
    const { error } = await supabase
      .from('campaign_addresses')
      .insert(address);

    if (!error || isUniqueConstraintError(error)) {
      continue;
    }

    return { error };
  }

  return { error: null };
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
  deferBedrockDiamondTopUp?: boolean;
}) {
  const { campaignId, polygon, regionCode, source, snapshot, insertedCount, deferBedrockDiamondTopUp = false } = params;
  const supabase = createAdminClient();

  await updateCampaignProvision(supabase, campaignId, {
    provision_phase: 'optimizing',
  });

  try {
    let effectiveSnapshot = snapshot;
    let effectiveInsertedCount = insertedCount;

    if (deferBedrockDiamondTopUp && !effectiveSnapshot) {
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
      source !== 'diamond'
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
        }>(async (from, to) =>
          await supabase
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
      normalizedBuildingsGeoJSON as unknown as { features: StableBuildingFeature[] },
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
        persistenceMode: source !== 'diamond' && !deferBedrockDiamondTopUp ? 'gold' : 'silver',
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
        normalizedBuildingsGeoJSON as unknown as { features: TownhouseBuildingFeature[] },
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
    const allowGoldProvision = body.allow_gold === true;

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
      let addressSource: ProvisionSource = 'diamond';
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

      if (existingSnapshot && isSnapshotReusable(existingSnapshot)) {
        addressSource = 'diamond';
        snapshot = snapshotRowToLambdaSnapshot(campaignId!, existingSnapshot);
        console.log('[Provision] Reusing snapshot from campaign_snapshots (skip Lambda generation)');
      } else {
        if (allowGoldProvision) {
          const goldRows = await GoldAddressService.fetchAddressesInPolygon(
            polygon as GeoJSON.Polygon,
            regionCode,
            DEFAULT_GOLD_ADDRESS_LIMIT
          );

          console.log(`[Provision] Gold query returned ${goldRows.length} address rows`);

          if (goldRows.length >= GOLD_SUCCESS_THRESHOLD) {
            addressSource = regionCodeToProvisionSource(regionCode);
            addressesToInsert = AddressAdapter.normalizeArray(
              goldRows,
              campaignId!,
              regionCode
            );
          } else if (goldRows.length > 0) {
            addressSource = regionCodeToProvisionSource(regionCode);
            deferSilverLambdaTopUp = true;
            addressesToInsert = AddressAdapter.normalizeArray(
              goldRows,
              campaignId!,
              regionCode
            );
          }
        }

        if (addressSource === 'diamond') {
          addressSource = 'diamond';
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
            addressesToInsert = AddressAdapter.normalizeArray(
              lambdaAddresses,
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
        if (addressSource !== 'diamond' || deferSilverLambdaTopUp) {
          if (addressesToInsert.length === 0) {
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
          }
          addressesToInsert = deduplicateAddresses(addressesToInsert);
          finalAddressCount = await bulkInsertAddresses(supabase, campaignId!, addressesToInsert);
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

      const linkedAddressCount = 0;
      const buildingLinkConfidence = 0;
      const mapMode = 'standard_pins';
      const linkedBuildingCount = 0;
      const effectiveBuildingCount = snapshot?.counts.buildings ?? 0;
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
        building_link_confidence: buildingLinkConfidence,
        map_mode: mapMode,
        parcel_enrichment_status: parcelEnrichmentStatus,
      });

      after(async () => {
        const [whiteGoldBuild, diamondBuild] = await Promise.all([
          triggerWhiteGoldBuild({
            campaignId: campaignId!,
            reason: 'provision_map_ready',
            source: addressSource,
            addressCount: finalAddressCount,
            buildingCount: effectiveBuildingCount,
            mapMode,
          }),
          triggerDiamondBuild({
            campaignId: campaignId!,
            reason: 'provision_map_ready',
            source: addressSource,
            addressCount: finalAddressCount,
            buildingCount: effectiveBuildingCount,
            mapMode,
          }),
        ]);

        console.log('[Provision] White Gold build trigger:', {
          campaignId,
          status: whiteGoldBuild.status,
          ...(whiteGoldBuild.status === 'queued' ? { statusCode: whiteGoldBuild.statusCode } : {}),
          ...(whiteGoldBuild.status === 'skipped' ? { reason: whiteGoldBuild.reason } : {}),
          ...(whiteGoldBuild.status === 'failed'
            ? { statusCode: whiteGoldBuild.statusCode, error: whiteGoldBuild.error }
            : {}),
        });

        console.log('[Provision] Diamond build trigger:', {
          campaignId,
          status: diamondBuild.status,
          ...(diamondBuild.status === 'queued' ? { statusCode: diamondBuild.statusCode } : {}),
          ...(diamondBuild.status === 'skipped' ? { reason: diamondBuild.reason } : {}),
          ...(diamondBuild.status === 'failed'
            ? { statusCode: diamondBuild.statusCode, error: diamondBuild.error }
            : {}),
        });

        await runCampaignPostProcessing({
          campaignId: campaignId!,
          polygon: polygon as GeoJSON.Polygon,
          regionCode,
          source: addressSource,
          snapshot,
          insertedCount: finalAddressCount,
          deferBedrockDiamondTopUp: deferSilverLambdaTopUp,
        });
      });

      return {
        success: true,
        campaign_id: campaignId,
        addresses_saved: finalAddressCount,
        buildings_saved: effectiveBuildingCount,
        source: addressSource,
        links_created: linkedBuildingCount,
        units_created: 0,
        has_parcels: false,
        building_link_confidence: buildingLinkConfidence,
        map_mode: mapMode,
        linked_address_count: linkedAddressCount,
        total_campaign_addresses: finalAddressCount,
        provision_status: 'ready',
        provision_phase: 'map_ready',
        provision_source: addressSource,
        map_ready: true,
        optimized: false,
        postprocess_deferred: true,
        white_gold_build: { status: 'deferred' },
        diamond_build: { status: 'deferred' },
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
          `${allowGoldProvision
            ? addressSource !== 'diamond' && !deferSilverLambdaTopUp
              ? 'Gold'
              : addressSource !== 'diamond' && deferSilverLambdaTopUp
                ? 'Gold-seeded Silver'
                : 'Diamond-seeded Lambda'
            : 'Diamond/White Gold'} campaign is map-ready: ` +
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
