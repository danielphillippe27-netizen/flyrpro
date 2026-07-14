import { after, NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { createAdminClient } from '@/lib/supabase/server';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import { RoutingService } from '@/lib/services/RoutingService';
import { buildRoute } from '@/lib/services/BlockRoutingService';
import {
  StableLinkerService,
  type BuildingFeature as StableBuildingFeature,
} from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService, type BuildingFeature as TownhouseBuildingFeature } from '@/lib/services/TownhouseSplitterService';
import { BuildingAdapter } from '@/lib/services/BuildingAdapter';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { BedrockNzService, type BedrockNzLinkGeometry } from '@/lib/services/BedrockNzService';
import { BedrockAustraliaService } from '@/lib/services/BedrockAustraliaService';
import { BedrockCanadaService } from '@/lib/services/BedrockCanadaService';
import { BedrockSouthAfricaService } from '@/lib/services/BedrockSouthAfricaService';
import { BedrockUkService } from '@/lib/services/BedrockUkService';
import { BedrockUsService } from '@/lib/services/BedrockUsService';
import { DiamondMunicipalService } from '@/lib/services/DiamondMunicipalService';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { fetchScopedPmtilesBuildingFeatures } from '@/app/api/campaigns/_utils/scoped-pmtiles-buildings';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';
import {
  ParcelEnrichmentService,
} from '@/lib/services/ParcelEnrichmentService';
import { CampaignLinkQualityService } from '@/lib/services/CampaignLinkQualityService';
import {
  CampaignMapModeService,
} from '@/lib/services/CampaignMapModeService';
import {
  prebuildCampaignMapBundle,
  resolveScopedCampaignMapGeometry,
  type PrehydratedScopedMapGeometry,
} from '@/lib/services/CampaignMapBundlePrebuilder';
import { isParcelRegionSupported } from '@/lib/geo/parcelRegions';
import {
  parcelTilesFromSnapshot,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';
import {
  bboxFromPolygon,
  buildAddressIdentity,
  deduplicateAddressesByProvisionKey,
  filterAddressesAgainstExisting,
  isConnectionError,
  isUniqueConstraintError,
  provisionFailureReason,
  shouldFailZeroAddressProvision,
  snapshotHasStaticPmtilesGeometry,
} from '@/lib/services/provisionHelpers';
import {
  APP_LIMIT_SCAN_COUNT,
  CampaignHomeLimitError,
  MAX_CAMPAIGN_HOMES,
  campaignHomeLimitErrorPayload,
} from '@/lib/services/campaignHomeLimits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ProvisionRequest {
  campaign_id: string;
  wait_for_linker?: boolean;
  wait_for_postprocess?: boolean;
  require_linked_homes?: boolean;
}

type ProvisionSource = 'diamond' | 'bedrock_nz' | 'bedrock_au' | 'bedrock_ca' | 'bedrock_us' | 'bedrock_za' | 'bedrock_uk';

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

const DEFAULT_STATIC_GEOMETRY_ADDRESS_HYDRATION_LIMIT = 2000;
const FALLBACK_INSERT_BATCH_SIZE = 500;
const BULK_ADDRESS_RPC = 'add_campaign_addresses';
const DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS = 240_000;

class ProvisionError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
    this.name = 'ProvisionError';
  }
}

function dbProvisionSource(source: ProvisionSource): ProvisionSource {
  return source;
}

function isProvisionSourceConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string; details?: string };
  const text = `${maybeError.message ?? ''} ${maybeError.details ?? ''}`;
  return maybeError.code === '23514' && text.includes('campaigns_provision_source_check');
}

function sourceResolutionTimeoutMs() {
  const raw = process.env.PROVISION_SOURCE_RESOLUTION_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_SOURCE_RESOLUTION_TIMEOUT_MS;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function staticGeometryAddressHydrationLimit() {
  const raw =
    process.env.STATIC_GEOMETRY_ADDRESS_HYDRATION_LIMIT ??
    process.env.BEDROCK_ADDRESS_HYDRATION_LIMIT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_STATIC_GEOMETRY_ADDRESS_HYDRATION_LIMIT;
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
        const source = String(address.source ?? 'unknown').toLowerCase().trim() || 'unknown';
        const externalId = String(address.gers_id ?? '').trim();
        if (externalId) {
          return [`${address.campaign_id}|${source}|external|${externalId}`, address] as const;
        }
        const formatted = String(address.formatted ?? '').toLowerCase().trim();
        const postalCode = String(address.postal_code ?? '').toLowerCase().trim();
        const houseNumber = String(address.house_number ?? '').toLowerCase().trim();
        const streetName = String(address.street_name ?? '').toLowerCase().trim();
        const locality = String(address.locality ?? '').toLowerCase().trim();
        return [
          `${address.campaign_id}|${source}|address|${formatted}|${postalCode}|${houseNumber}|${streetName}|${locality}`,
          address,
        ] as const;
      })
    ).values()
  );
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

function lambdaSnapshotToCampaignSnapshotRow(snapshot: LambdaSnapshotResponse): CampaignSnapshotRow {
  return {
    bucket: snapshot.bucket,
    prefix: snapshot.prefix,
    buildings_key: snapshot.s3_keys.buildings,
    addresses_key: snapshot.s3_keys.addresses,
    buildings_url: snapshot.urls.buildings,
    metadata_key: snapshot.s3_keys.metadata,
    buildings_count: snapshot.counts.buildings,
    created_at: null,
    tile_metrics: (snapshot.metadata?.tile_metrics ?? null) as Record<string, unknown> | null,
  };
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function staticParcelCountFromSnapshot(snapshot: LambdaSnapshotResponse | null | undefined): number {
  const row = snapshot ? lambdaSnapshotToCampaignSnapshotRow(snapshot) : null;
  if (!row || !parcelTilesFromSnapshot(row)) return 0;
  const metrics = snapshot?.metadata?.tile_metrics as Record<string, unknown> | null | undefined;
  const scanMetrics = metrics?.scan_metrics;
  const parcelScan =
    scanMetrics && typeof scanMetrics === 'object' && !Array.isArray(scanMetrics)
      ? (scanMetrics as Record<string, unknown>).parcels
      : null;
  const parcelScanHits =
    parcelScan && typeof parcelScan === 'object' && !Array.isArray(parcelScan)
      ? numberMetric(parcelScan as Record<string, unknown>, 'hits')
      : null;
  return parcelScanHits ?? numberMetric(metrics, 'campaign_parcels_count') ?? 1;
}

function snapshotWithScopedBuildingCount(
  snapshot: LambdaSnapshotResponse,
  scopedBuildingCount: number | null
): LambdaSnapshotResponse {
  if (scopedBuildingCount == null) return snapshot;

  const tileMetrics = snapshot.metadata?.tile_metrics &&
    typeof snapshot.metadata.tile_metrics === 'object'
      ? snapshot.metadata.tile_metrics as Record<string, unknown>
      : {};

  return {
    ...snapshot,
    counts: {
      ...snapshot.counts,
      buildings: scopedBuildingCount,
    },
    metadata: {
      elapsed_ms: snapshot.metadata?.elapsed_ms ?? 0,
      snapshot_size_bytes: snapshot.metadata?.snapshot_size_bytes ?? 0,
      overture_release: snapshot.metadata?.overture_release,
      tile_metrics: {
        ...tileMetrics,
        artifact_buildings_count: snapshot.counts.buildings,
        campaign_buildings_count: scopedBuildingCount,
        campaign_geometry_scope: 'territory_boundary',
      } as unknown as NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics'],
    } as LambdaSnapshotResponse['metadata'],
  };
}

function apiBaseUrl(request: NextRequest) {
  const configured = request.nextUrl.origin.replace(/\/+$/, '');
  return configured === 'https://wolfgrid.app'
    ? 'https://wolfgrid.app'
    : configured;
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

async function countCampaignBuildingLinks(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<{ links: number; linkedAddresses: number }> {
  const rows = await fetchAllInPages<{ address_id: string | null }>(async (from, to) =>
    await supabase
      .from('building_address_links')
      .select('address_id')
      .eq('campaign_id', campaignId)
      .range(from, to)
  );

  const directRows = await fetchAllInPages<{
    id: string;
    building_id: string | null;
    building_gers_id: string | null;
  }>(async (from, to) =>
    await supabase
      .from('campaign_addresses')
      .select('id, building_id, building_gers_id')
      .eq('campaign_id', campaignId)
      .range(from, to)
  );

  const linkedAddressIds = new Set(rows.map((row) => row.address_id).filter(Boolean) as string[]);
  let directOnlyLinks = 0;
  for (const row of directRows) {
    if (!row.building_id && !row.building_gers_id) continue;
    if (!linkedAddressIds.has(row.id)) {
      directOnlyLinks += 1;
    }
    linkedAddressIds.add(row.id);
  }

  return {
    links: rows.length + directOnlyLinks,
    linkedAddresses: linkedAddressIds.size,
  };
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
    if (patch.provision_source && isProvisionSourceConstraintError(error)) {
      const { provision_source: rejectedProvisionSource, ...retryPatch } = patch;

      console.warn(
        '[Provision] Database rejected provision_source; retrying provisioning state update without it. Apply the latest campaigns_provision_source_check migration.',
        {
          campaignId,
          provision_source: rejectedProvisionSource,
          error: error.message,
        }
      );

      if (Object.keys(retryPatch).length === 0) {
        return;
      }

      const { error: retryError } = await supabase
        .from('campaigns')
        .update(retryPatch)
        .eq('id', campaignId);

      if (!retryError) {
        return;
      }

      throw new Error(`Failed to update campaign provisioning state: ${retryError.message}`);
    }

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

function addressesForInitialHydration(
  addresses: StandardCampaignAddress[]
): StandardCampaignAddress[] {
  if (addresses.length === 0) {
    return [];
  }

  const cappedAddresses = addresses.slice(0, MAX_CAMPAIGN_HOMES);
  return cappedAddresses.length <= staticGeometryAddressHydrationLimit() ? cappedAddresses : [];
}

function stringFeatureValue(properties: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function featureCenter(feature: GeoJSON.Feature): [number, number] | null {
  try {
    const center = turf.centerOfMass(feature as GeoJSON.Feature<GeoJSON.Geometry>);
    const coordinates = center.geometry.coordinates;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat];
    }
  } catch {
    // Fall through to bbox center for malformed clipped building fragments.
  }

  try {
    const bbox = turf.bbox(feature) as [number, number, number, number];
    const lon = (bbox[0] + bbox[2]) / 2;
    const lat = (bbox[1] + bbox[3]) / 2;
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  } catch {
    return null;
  }
}

function buildProxyAddressesFromBuildings(options: {
  campaignId: string;
  buildings: GeoJSON.FeatureCollection | null | undefined;
  source: ProvisionSource;
  regionCode: string;
}): StandardCampaignAddress[] {
  const features = Array.isArray(options.buildings?.features) ? options.buildings.features : [];
  return features.flatMap((feature, index): StandardCampaignAddress[] => {
    const center = featureCenter(feature);
    if (!center) return [];

    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const buildingId =
      stringFeatureValue(properties, 'building_id', 'gers_id', 'id') ??
      (typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) : null) ??
      `building-${index + 1}`;
    const formatted =
      stringFeatureValue(properties, 'address_text', 'formatted', 'full_address', 'label', 'name') ??
      `Door target ${index + 1}`;
    const [lon, lat] = center;

    return [{
      campaign_id: options.campaignId,
      formatted,
      house_number: stringFeatureValue(properties, 'house_number', 'number', 'street_number') ?? undefined,
      street_name: stringFeatureValue(properties, 'street_name', 'street', 'road_name') ?? undefined,
      locality: stringFeatureValue(properties, 'locality', 'city', 'municipality') ?? undefined,
      region: options.regionCode.toUpperCase(),
      postal_code: stringFeatureValue(properties, 'postal_code', 'postcode') ?? undefined,
      coordinate: { lat, lon },
      lat,
      lon,
      geom: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }),
      source: options.source,
      gers_id: `${options.source}:building-proxy:${buildingId}`,
    }];
  });
}

function snapshotWithProxyAddressCount(
  snapshot: LambdaSnapshotResponse,
  addressCount: number
): LambdaSnapshotResponse {
  const tileMetrics = snapshot.metadata?.tile_metrics &&
    typeof snapshot.metadata.tile_metrics === 'object'
      ? snapshot.metadata.tile_metrics as Record<string, unknown>
      : {};

  return {
    ...snapshot,
    counts: {
      ...snapshot.counts,
      addresses: addressCount,
    },
    metadata: {
      elapsed_ms: snapshot.metadata?.elapsed_ms ?? 0,
      snapshot_size_bytes: snapshot.metadata?.snapshot_size_bytes ?? 0,
      overture_release: snapshot.metadata?.overture_release,
      tile_metrics: {
        ...tileMetrics,
        campaign_addresses_count: addressCount,
        building_proxy_addresses_count: addressCount,
        address_proxy_reason: 'address_pmtiles_zero_hits',
        address_proxy_source: 'scoped_pmtiles_buildings',
      } as unknown as NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics'],
    } as LambdaSnapshotResponse['metadata'],
  };
}

async function resolveDiamondThenBedrock(options: {
  campaignId: string;
  polygon: GeoJSON.Polygon;
  regionCode: string;
}): Promise<{
  addressSource: ProvisionSource;
  snapshot: LambdaSnapshotResponse;
  addressesToInsert: StandardCampaignAddress[];
  resolvedHomeCount: number;
  bedrockLinkGeometry: BedrockNzLinkGeometry | null;
}> {
  const { campaignId, polygon, regionCode } = options;

  if (DiamondMunicipalService.isSupportedRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Diamond municipal S3...', {
      campaignId,
      regionCode,
    });
    const diamondResult = await DiamondMunicipalService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    }).catch((error) => {
      console.warn(
        '[Provision] Diamond S3 probe failed; trying Bedrock S3 next:',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    });

    if (diamondResult) {
      console.log('[Provision] DIAMOND municipal S3 polygon scan complete:', {
        campaignId,
        country: diamondResult.country,
        municipality: diamondResult.municipality,
        addresses: diamondResult.addresses.length,
        bboxCandidates: diamondResult.metrics.addresses.bboxCandidates,
        timings: {
          addresses: diamondResult.metrics.addresses.seconds,
        },
      });

      return {
        addressSource: 'diamond',
        snapshot: diamondResult.snapshot,
        addressesToInsert: addressesForInitialHydration(diamondResult.addresses),
        resolvedHomeCount: diamondResult.addresses.length,
        bedrockLinkGeometry: null,
      };
    }

    console.log('[Provision] No matching Diamond S3 folder found; trying Bedrock S3.');
  }

  if (BedrockNzService.isNzRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock NZ S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockNzService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
    });
    console.log('[Provision] BEDROCK New Zealand S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      buildings: bedrockResult.snapshot.counts.buildings,
      parcels: bedrockResult.metrics.parcels.hits,
      linkerBuildings: bedrockResult.linkGeometry.buildings.length,
      linkerParcels: bedrockResult.linkGeometry.parcels.length,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        buildings: bedrockResult.metrics.buildings.seconds,
        parcels: bedrockResult.metrics.parcels.seconds,
      },
    });
    return {
      addressSource: 'bedrock_nz',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: bedrockResult.linkGeometry,
    };
  }

  if (BedrockAustraliaService.isAustraliaRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock Australia S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockAustraliaService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    });
    console.log('[Provision] BEDROCK Australia S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      touchedTiles: bedrockResult.metrics.addresses.touchedTiles,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        addressesBreakdown: bedrockResult.metrics.addresses.timings,
      },
    });
    return {
      addressSource: 'bedrock_au',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: null,
    };
  }

  if (BedrockCanadaService.isCanadaRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock Canada S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockCanadaService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    });
    console.log('[Provision] BEDROCK Canada S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      touchedTiles: bedrockResult.metrics.addresses.touchedTiles,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        addressesBreakdown: bedrockResult.metrics.addresses.timings,
      },
    });
    return {
      addressSource: 'bedrock_ca',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: null,
    };
  }

  if (BedrockSouthAfricaService.isSouthAfricaRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock South Africa S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockSouthAfricaService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    });
    console.log('[Provision] BEDROCK South Africa S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      touchedTiles: bedrockResult.metrics.addresses.touchedTiles,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        addressesBreakdown: bedrockResult.metrics.addresses.timings,
      },
    });
    return {
      addressSource: 'bedrock_za',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: null,
    };
  }

  if (BedrockUkService.isUkRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock UK S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockUkService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    });
    console.log('[Provision] BEDROCK UK S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      touchedTiles: bedrockResult.metrics.addresses.touchedTiles,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        addressesBreakdown: bedrockResult.metrics.addresses.timings,
      },
    });
    return {
      addressSource: 'bedrock_uk',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: null,
    };
  }

  if (BedrockUsService.isUsRegion(regionCode)) {
    console.log('[Provision] Source probe: checking Bedrock US S3...', {
      campaignId,
      regionCode,
    });
    const bedrockResult = await BedrockUsService.provisionCampaign({
      campaignId,
      polygon,
      addressLimit: APP_LIMIT_SCAN_COUNT,
      regionCode,
    });
    console.log('[Provision] BEDROCK USA S3 polygon scan complete:', {
      campaignId,
      addresses: bedrockResult.addresses.length,
      touchedTiles: bedrockResult.metrics.addresses.touchedTiles,
      timings: {
        addresses: bedrockResult.metrics.addresses.seconds,
        addressesBreakdown: bedrockResult.metrics.addresses.timings,
      },
    });
    return {
      addressSource: 'bedrock_us',
      snapshot: bedrockResult.snapshot,
      addressesToInsert: addressesForInitialHydration(bedrockResult.addresses),
      resolvedHomeCount: bedrockResult.addresses.length,
      bedrockLinkGeometry: null,
    };
  }

  throw new ProvisionError(
    `Provisioning only supports Diamond or Bedrock S3 folders for region "${regionCode}".`,
    422
  );
}

async function runCampaignPostProcessing(params: {
  campaignId: string;
  polygon: GeoJSON.Polygon;
  regionCode: string;
  source: ProvisionSource;
  snapshot: LambdaSnapshotResponse | null;
  insertedCount: number;
  bedrockLinkGeometry?: BedrockNzLinkGeometry | null;
  scopedGeometry?: PrehydratedScopedMapGeometry | null;
  responseMode?: 'full' | 'linker_ready';
}) {
  const {
    campaignId,
    polygon,
    regionCode,
    source,
    snapshot,
    insertedCount,
    bedrockLinkGeometry,
    scopedGeometry,
    responseMode = 'full',
  } = params;
  const supabase = createAdminClient();
  const linkerReadyOnly = responseMode === 'linker_ready';
  const postprocessStarted = performance.now();
  const stageTimings: Record<string, number> = {};
  const timedStage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await action();
    } finally {
      stageTimings[name] = Math.round(performance.now() - started);
      console.log('[Provision] Map-ready stage timing', {
        campaignId,
        stage: name,
        ms: stageTimings[name],
      });
    }
  };

  await updateCampaignProvision(supabase, campaignId, {
    provision_status: linkerReadyOnly ? 'pending' : 'ready',
    provision_phase: 'optimizing',
  });

  try {
    const effectiveSnapshot = snapshot;
    const effectiveInsertedCount = insertedCount;

    let preFetchedBuildingsGeo: unknown;
    if (bedrockLinkGeometry) {
      preFetchedBuildingsGeo = {
        type: 'FeatureCollection',
        features: bedrockLinkGeometry.buildings,
      };
    } else if (scopedGeometry?.buildings?.features.length) {
      preFetchedBuildingsGeo = scopedGeometry.buildings;
    } else if (snapshot && snapshotHasStaticPmtilesGeometry(snapshot)) {
      const bbox = bboxFromPolygon(polygon);
      if (bbox) {
        try {
          preFetchedBuildingsGeo = await fetchScopedPmtilesBuildingFeatures(
            lambdaSnapshotToCampaignSnapshotRow(snapshot),
            bbox,
            new Set(),
            polygon
          );
          const featureCount =
            preFetchedBuildingsGeo &&
            typeof preFetchedBuildingsGeo === 'object' &&
            Array.isArray((preFetchedBuildingsGeo as { features?: unknown }).features)
              ? (preFetchedBuildingsGeo as { features: unknown[] }).features.length
              : 0;
          console.log('[Provision] Scoped PMTiles buildings ready for linker', {
            campaignId,
            buildings: featureCount,
          });
        } catch (pmtilesError) {
          console.warn(
            '[Provision] Failed to extract scoped PMTiles buildings for linker:',
            pmtilesError instanceof Error ? pmtilesError.message : pmtilesError
          );
        }
      }
    }

    const { buildings: normalizedBuildingsGeoJSON, overtureRelease } =
      await timedStage('normalize_buildings', () =>
        BuildingAdapter.fetchAndNormalize(effectiveSnapshot, preFetchedBuildingsGeo)
      );
    const normalizedBuildingCount = normalizedBuildingsGeoJSON.features.length;

    let optimizedPathGeometry: GeoJSON.LineString | null = null;
    let optimizedPathInfo: {
      totalDistanceKm: number;
      totalTimeMinutes: number;
      waypointCount: number;
    } | null = null;

    const skipRouteOptimization = true;
    if (skipRouteOptimization) {
      console.log(
        linkerReadyOnly
          ? '[Provision] Stage 1: Route optimization skipped for wait_for_linker response.'
          : '[Provision] Stage 1: Route optimization deferred; canonical map bundle is the readiness gate.'
      );
    } else if (effectiveInsertedCount >= 2) {
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
    const staticParcelCount = staticParcelCountFromSnapshot(effectiveSnapshot);
    const parcelEnrichment = isParcelRegionSupported(regionCode)
      ? new ParcelEnrichmentService(supabase)
      : null;

    if (parcelEnrichment) {
      try {
        parcelPreparation = await timedStage('prepare_parcels', () =>
          parcelEnrichment.prepareParcelsForProvision(campaignId, scopedGeometry?.parcels as GeoJSON.FeatureCollection | undefined)
        );
      } catch (parcelError) {
        console.warn('[Provision] Parcel preparation failed before linking:', parcelError);
      }
    }

    if (normalizedBuildingCount === 0) {
      const optimizedAt = new Date().toISOString();
      await updateCampaignProvision(supabase, campaignId, {
        provision_status: 'ready',
        provision_phase: 'optimized',
        provisioned_at: optimizedAt,
        map_ready_at: optimizedAt,
        optimized_at: optimizedAt,
        has_parcels: false,
        building_link_confidence: 0,
        map_mode: 'standard_pins',
        link_quality_status: 'unknown',
        link_quality_reason: null,
        data_quality_reason: null,
      });

      console.log('[Provision] Background post-processing complete without building linking:', {
        campaignId,
        addresses: effectiveInsertedCount,
      });
      await prewarmCanonicalMapBundle(supabase, campaignId, scopedGeometry);
      return;
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
    spatialJoinSummary = await timedStage('stable_linker', () =>
      linkerService.runSpatialJoin(
        campaignId,
        normalizedBuildingsGeoJSON as unknown as { features: StableBuildingFeature[] },
        overtureRelease,
        {
          resetExisting: true,
          persistenceMode: source === 'diamond' ? 'gold' : 'silver',
          parcelsGeoJSON: scopedGeometry?.parcels?.features.length
            ? scopedGeometry.parcels as never
            : null,
        }
      )
    );

    let townhouseSummary = {
      total_buildings: 0,
      townhouses_detected: 0,
      apartments_skipped: 0,
      units_created: 0,
      errors_logged: 0,
      avg_units_per_townhouse: 0,
    };

    const mapModeService = new CampaignMapModeService(supabase);
    const effectiveParcelCount = Math.max(parcelPreparation?.parcelCount ?? 0, staticParcelCount);
    const mapModeAssessment = await timedStage('map_mode', () =>
      mapModeService.computeAndPersist(campaignId, {
        totalAddresses: effectiveInsertedCount,
        linkedAddressCount: spatialJoinSummary.matched,
        hasParcels: effectiveParcelCount > 0,
        parcelCount: effectiveParcelCount,
      })
    );

    let optimizedMapModeAssessment = mapModeAssessment;

    console.log('[Provision] Diamond/Bedrock townhouse splitter: Processing multi-unit buildings before final map bundle...');
    try {
      const splitterService = new TownhouseSplitterService(supabase);
      townhouseSummary = await timedStage('townhouse_splitter', () =>
        splitterService.processCampaignTownhouses(
          campaignId,
          normalizedBuildingsGeoJSON as unknown as { features: TownhouseBuildingFeature[] },
          overtureRelease
        )
      );
    } catch (splitterError) {
      console.warn('[Provision] Townhouse splitting failed:', splitterError);
    }

    const mapReadyAt = new Date().toISOString();
    await updateCampaignProvision(supabase, campaignId, {
      provision_status: linkerReadyOnly ? 'pending' : 'ready',
      provision_phase: linkerReadyOnly ? 'map_ready' : 'optimizing',
      provisioned_at: mapReadyAt,
      map_ready_at: mapReadyAt,
      has_parcels: mapModeAssessment.hasParcels,
      building_link_confidence: mapModeAssessment.buildingLinkConfidence,
      map_mode: mapModeAssessment.mapMode,
    });

    await timedStage('prewarm_map_bundle', () =>
      prewarmCanonicalMapBundle(supabase, campaignId, scopedGeometry)
    );

    await updateCampaignProvision(supabase, campaignId, {
      provision_status: 'ready',
      provision_phase: linkerReadyOnly ? 'map_ready' : 'optimizing',
      provisioned_at: mapReadyAt,
      map_ready_at: mapReadyAt,
      has_parcels: mapModeAssessment.hasParcels,
      building_link_confidence: mapModeAssessment.buildingLinkConfidence,
      map_mode: mapModeAssessment.mapMode,
    });

    const linkQualityService = new CampaignLinkQualityService(supabase);
    const linkQuality = await timedStage('link_quality_deferred', async () => {
      const assessment = await linkQualityService.assessPersistedLinks(campaignId);
      await linkQualityService.persist(campaignId, assessment);
      return assessment;
    });
    const shouldRunDeferredRepair =
      !linkerReadyOnly &&
      linkQuality.repairRecommended &&
      parcelEnrichment &&
      parcelPreparation &&
      parcelPreparation.status !== 'ready';

	    if (shouldRunDeferredRepair) {
      try {
        await linkQualityService.updateStatus(
          campaignId,
          'repairing',
          linkQuality.reason ? `Repair running after map-ready: ${linkQuality.reason}` : 'Repair running after map-ready.'
        );
        await timedStage('parcel_repair_deferred', () => parcelEnrichment.runForCampaign(campaignId));
        optimizedMapModeAssessment = await timedStage('map_mode_after_repair', () =>
          mapModeService.computeAndPersist(campaignId, {
            totalAddresses: effectiveInsertedCount,
          })
        );
        await timedStage('prewarm_map_bundle_after_repair', () =>
          prewarmCanonicalMapBundle(supabase, campaignId, scopedGeometry)
        );
      } catch (repairError) {
        console.warn('[Provision] Deferred parcel/link repair failed after map-ready:', {
          campaignId,
          error: repairError instanceof Error ? repairError.message : String(repairError),
        });
      }
    }

    const optimizedAt = new Date().toISOString();
    await updateCampaignProvision(supabase, campaignId, {
      provision_status: 'ready',
      provision_phase: 'optimized',
      optimized_at: optimizedAt,
      has_parcels: optimizedMapModeAssessment.hasParcels,
      building_link_confidence: optimizedMapModeAssessment.buildingLinkConfidence,
      map_mode: optimizedMapModeAssessment.mapMode,
    });

    await timedStage('prewarm_map_bundle_optimized', () =>
      prewarmCanonicalMapBundle(supabase, campaignId)
    );

    console.log('[Provision] Background post-processing complete:', {
      campaignId,
      matched: spatialJoinSummary.matched,
      unitsCreated: townhouseSummary.units_created,
      mapMode: optimizedMapModeAssessment.mapMode,
      addresses: effectiveInsertedCount,
      timings: {
        ...stageTimings,
        total_ms: Math.round(performance.now() - postprocessStarted),
      },
    });
  } catch (error) {
    console.error('[Provision] Deferred post-processing failed:', error);
    const failureReason = provisionFailureReason(error);
    await updateCampaignProvision(supabase, campaignId, {
      provision_phase: 'map_ready',
      link_quality_status: 'failed',
      link_quality_reason: `Post-processing failed: ${failureReason}`,
      data_quality_reason: `Post-processing failed: ${failureReason}`,
    }).catch((updateError) => {
      console.error('[Provision] Failed to persist deferred failure state:', updateError);
    });
  }
}

async function prewarmCanonicalMapBundle(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  scopedGeometry?: PrehydratedScopedMapGeometry | null,
  options?: {
    linksStatusOverride?: string | null;
    parcelDisplayMode?: 'filtered' | 'raw';
  }
) {
  const timings: Record<string, number> = {};
  try {
    await prebuildCampaignMapBundle(supabase, campaignId, (name, durationMs) => {
      timings[name] = Math.round(durationMs);
    }, {
      scopedGeometry,
      linksStatusOverride: options?.linksStatusOverride,
      parcelDisplayMode: options?.parcelDisplayMode,
    });
    console.log('[Provision] Canonical map-bundle prebuilt:', {
      campaignId,
      linksStatusOverride: options?.linksStatusOverride ?? null,
      parcelDisplayMode: options?.parcelDisplayMode ?? 'filtered',
      timings,
    });
  } catch (error) {
    console.warn('[Provision] Canonical map-bundle prewarm failed; /map-bundle will stay pending until the next prewarm:', {
      campaignId,
      message: error instanceof Error ? error.message : String(error),
      timings,
    });
  }
}

export async function POST(request: NextRequest) {
  console.log('[Provision] Starting Diamond/Bedrock S3 map-ready provisioning...');

  let campaignId: string | null = null;

  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

	    const body: ProvisionRequest = await request.json();
	    campaignId = body.campaign_id;
	    const waitForLinker =
	      body.wait_for_linker === true ||
	      body.wait_for_postprocess === true ||
	      body.require_linked_homes === true;

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
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

    if (waitForLinker && BedrockUkService.isUkRegion(regionCode)) {
      try {
        const staticSnapshot = await BedrockUkService.staticSnapshotForCampaign(campaignId, regionCode);
        await upsertSnapshotMetadata(supabase, campaignId, staticSnapshot);
        await updateCampaignProvision(supabase, campaignId, {
          provision_status: 'ready',
          provision_phase: 'map_ready',
          provision_source: 'bedrock_uk',
          provisioned_at: readyAt,
          map_ready_at: readyAt,
          has_parcels: false,
          building_link_confidence: 0,
          map_mode: 'standard_pins',
          parcel_enrichment_status: 'skipped',
        });
        console.log('[Provision] BEDROCK UK static PMTiles snapshot published before address scan:', {
          campaignId,
          buildings: staticSnapshot.s3_keys.buildings,
          addresses: staticSnapshot.s3_keys.addresses,
        });
      } catch (staticSnapshotError) {
        console.warn(
          '[Provision] Failed to publish early UK PMTiles snapshot; continuing with full provision:',
          staticSnapshotError instanceof Error ? staticSnapshotError.message : staticSnapshotError
        );
      }
    }

    const runProvisionWorker = async () => {
      const result = await retryWithBackoff(async () => {
          const sourceTimeoutMs = sourceResolutionTimeoutMs();
          console.log('[Provision] Map-ready provision worker started.', {
            campaignId,
            regionCode,
            sourceTimeoutMs,
          });
          await updateCampaignProvision(supabase, campaignId!, {
            provision_phase: 'source_probed',
          });

          const existingAddressCount = await countCampaignAddresses(supabase, campaignId!);
          const resolvedProvision = await withTimeout(
            resolveDiamondThenBedrock({
              campaignId: campaignId!,
              polygon: polygon as GeoJSON.Polygon,
              regionCode,
            }),
            sourceTimeoutMs,
            `Provision source resolution exceeded ${Math.round(sourceTimeoutMs / 1000)}s before Diamond/Bedrock returned. Check S3/DuckDB/httpfs runtime logs.`
          );
          const {
            addressSource,
            snapshot: rawSnapshot,
            addressesToInsert: resolvedAddresses,
            resolvedHomeCount,
            bedrockLinkGeometry,
          } = resolvedProvision;
          let snapshot = rawSnapshot;
          let addressesToInsert = resolvedAddresses;
          const homeCapNotice = resolvedHomeCount > MAX_CAMPAIGN_HOMES
            ? `This territory has more than ${MAX_CAMPAIGN_HOMES.toLocaleString()} homes. The free demo loaded the first ${MAX_CAMPAIGN_HOMES.toLocaleString()} homes so your map opens quickly.`
            : null;

          await updateCampaignProvision(supabase, campaignId!, {
            provision_source: dbProvisionSource(addressSource),
            provision_phase: 'source_probed',
            data_quality_reason: homeCapNotice,
          });

          let finalAddressCount = existingAddressCount;
          await updateCampaignProvision(supabase, campaignId!, {
            provision_phase: 'addresses_loading',
          });

          addressesToInsert = deduplicateAddresses(addressesToInsert).slice(0, MAX_CAMPAIGN_HOMES);
          const hasResolvedAddresses = addressesToInsert.length > 0;
          if (hasResolvedAddresses) {
            finalAddressCount = await bulkInsertAddresses(supabase, campaignId!, addressesToInsert);
          }

          const hasStaticGeometry = snapshotHasStaticPmtilesGeometry(snapshot);
          if (shouldFailZeroAddressProvision({ hasResolvedAddresses, hasStaticGeometry })) {
            throw new ProvisionError(
              'Provisioning did not find any addresses in this territory. Try a larger polygon or a nearby area.',
              422
            );
          }

          if (finalAddressCount > 0) {
            await updateCampaignProvision(supabase, campaignId!, {
              provision_phase: 'addresses_ready',
              addresses_ready_at: readyAt,
            });
          }

          const campaignPolygon = polygon as GeoJSON.Polygon;
          const scopedGeometry = await resolveScopedCampaignMapGeometry({
            campaignId: campaignId!,
            snapshot: lambdaSnapshotToCampaignSnapshotRow(snapshot),
            campaignRow: {
              bbox: campaign.bbox ?? bboxFromPolygon(campaignPolygon),
              territory_boundary: campaignPolygon,
            },
            recordTiming: (name, durationMs) => {
              console.log('[Provision] Scoped PMTiles geometry timing', {
                campaignId,
                phase: name,
                ms: Math.round(durationMs),
              });
            },
          });
          const scopedBuildingCount = scopedGeometry.buildings?.features.length ?? null;
          snapshot = snapshot ? snapshotWithScopedBuildingCount(snapshot, scopedBuildingCount) : snapshot;

          if (finalAddressCount === 0 && (scopedGeometry.buildings?.features.length ?? 0) > 0) {
            const proxyAddresses = buildProxyAddressesFromBuildings({
              campaignId: campaignId!,
              buildings: scopedGeometry.buildings,
              source: addressSource,
              regionCode,
            });
            const cappedProxyAddresses = proxyAddresses.slice(0, MAX_CAMPAIGN_HOMES);
            if (cappedProxyAddresses.length > 0) {
              console.warn('[Provision] PMTiles address scope produced zero addresses; using scoped building proxy door targets.', {
                campaignId,
                buildings: scopedGeometry.buildings?.features.length ?? 0,
                proxyAddresses: cappedProxyAddresses.length,
                source: addressSource,
              });
              finalAddressCount = await bulkInsertAddresses(supabase, campaignId!, cappedProxyAddresses);
              snapshot = snapshotWithProxyAddressCount(snapshot, finalAddressCount);
              await updateCampaignProvision(supabase, campaignId!, {
                provision_phase: 'addresses_ready',
                addresses_ready_at: new Date().toISOString(),
                data_quality_reason: homeCapNotice,
              });
            }
          }

          await upsertSnapshotMetadata(supabase, campaignId!, snapshot);

	          let linkedAddressCount = 0;
	          let buildingLinkConfidence = 0;
	          let mapMode = 'standard_pins';
	          let linkedBuildingCount = 0;
	          const effectiveBuildingCount = snapshot.counts.buildings;
	          const staticParcelCount = staticParcelCountFromSnapshot(snapshot);
	          const parcelEnrichmentStatus = isParcelRegionSupported(regionCode) ? 'queued' : 'skipped';

          if (parcelEnrichmentStatus === 'queued') {
            await new ParcelEnrichmentService(supabase).markQueued(campaignId!);
          }

          await updateCampaignProvision(supabase, campaignId!, {
            provision_status: 'pending',
            provision_phase: finalAddressCount > 0 ? 'addresses_ready' : 'source_probed',
            provision_source: dbProvisionSource(addressSource),
            provisioned_at: readyAt,
            has_parcels: staticParcelCount > 0,
            building_link_confidence: buildingLinkConfidence,
            map_mode: staticParcelCount > 0 ? 'hybrid' : mapMode,
            parcel_enrichment_status: parcelEnrichmentStatus,
            data_quality_reason: homeCapNotice,
          });

          const initialMapReadyAt = new Date().toISOString();
          const scopedParcelCount = scopedGeometry.parcels?.features.length ?? 0;
          await prewarmCanonicalMapBundle(supabase, campaignId!, scopedGeometry, {
            linksStatusOverride: 'pending_provision',
            parcelDisplayMode: 'raw',
          });
          await updateCampaignProvision(supabase, campaignId!, {
            provision_status: 'ready',
            provision_phase: 'map_ready',
            provisioned_at: initialMapReadyAt,
            map_ready_at: initialMapReadyAt,
            has_parcels: staticParcelCount > 0 || scopedParcelCount > 0,
            building_link_confidence: 0,
            map_mode: (staticParcelCount > 0 || scopedParcelCount > 0) ? 'hybrid' : mapMode,
            data_quality_reason: homeCapNotice,
          });

	          console.log('[Provision] Initial map-ready bundle published; backend linking will optimize the canonical bundle in background.', {
	            campaignId,
	            addresses: finalAddressCount,
	            buildings: scopedBuildingCount ?? effectiveBuildingCount,
	            parcels: scopedParcelCount,
	          });

	          let optimized = false;
	          let postprocessDeferred = true;
	          if (waitForLinker) {
	            console.log('[Provision] wait_for_linker requested; running full linker before response.', {
	              campaignId,
	              addressSource,
	            });
	            await runCampaignPostProcessing({
	              campaignId: campaignId!,
	              polygon: campaignPolygon,
	              regionCode,
	              source: addressSource,
	              snapshot,
	              insertedCount: finalAddressCount,
	              bedrockLinkGeometry,
	              scopedGeometry,
	              responseMode: 'linker_ready',
	            });

	            const [{ data: postProcessCampaign }, linkSummary] = await Promise.all([
	              supabase
	                .from('campaigns')
	                .select('provision_phase, optimized_at, building_link_confidence, map_mode')
	                .eq('id', campaignId!)
	                .maybeSingle(),
	              countCampaignBuildingLinks(supabase, campaignId!),
	            ]);

	            linkedBuildingCount = linkSummary.links;
	            linkedAddressCount = linkSummary.linkedAddresses;
	            buildingLinkConfidence = Number(postProcessCampaign?.building_link_confidence ?? buildingLinkConfidence);
	            mapMode = typeof postProcessCampaign?.map_mode === 'string' ? postProcessCampaign.map_mode : mapMode;
	            optimized = postProcessCampaign?.provision_phase === 'optimized' || Boolean(postProcessCampaign?.optimized_at);
	            postprocessDeferred = false;
	          } else {
	            await runCampaignPostProcessing({
	              campaignId: campaignId!,
	              polygon: campaignPolygon,
	              regionCode,
	              source: addressSource,
	              snapshot,
	              insertedCount: finalAddressCount,
	              bedrockLinkGeometry,
	              scopedGeometry,
	            });
	          }

	          return {
	            success: true,
            campaign_id: campaignId,
            addresses_saved: finalAddressCount,
            buildings_saved: effectiveBuildingCount,
            source: addressSource,
            links_created: linkedBuildingCount,
            units_created: 0,
            has_parcels: staticParcelCount > 0,
            building_link_confidence: buildingLinkConfidence,
            map_mode: staticParcelCount > 0 ? 'hybrid' : mapMode,
            linked_address_count: linkedAddressCount,
            total_campaign_addresses: finalAddressCount,
            provision_status: 'ready',
	            provision_phase: optimized ? 'optimized' : 'map_ready',
	            provision_source: dbProvisionSource(addressSource),
	            map_ready: true,
	            optimized,
	            postprocess_deferred: postprocessDeferred,
	            parcel_enrichment_status: parcelEnrichmentStatus,
	            map_layers: {
	              buildings: `${apiBaseUrl(request)}/api/campaigns/${encodeURIComponent(campaignId!)}/buildings`,
            },
            snapshot_metadata: {
              bucket: snapshot.bucket,
              prefix: snapshot.prefix,
              overture_release: snapshot.metadata?.overture_release,
              tile_metrics: snapshot.metadata?.tile_metrics,
	            },
	            warning: homeCapNotice ?? snapshot.warning ?? null,
	            message:
	              `${addressSource === 'diamond' ? 'Diamond' : 'Bedrock'} campaign is map-ready: ` +
	              `${finalAddressCount} leads loaded. ` +
	              (waitForLinker
	                ? `building linking completed with ${linkedAddressCount} linked homes.`
	                : `route optimization, building linking, townhouse splitting, and parcel enrichment will continue in the background.`),
	          };
      });

      if (result?.provision_source) {
        const { data: provisionRow } = await supabase
          .from('campaigns')
          .select('provision_source')
          .eq('id', campaignId)
          .maybeSingle();

        if (!provisionRow?.provision_source) {
          await updateCampaignProvision(supabase, campaignId!, {
            provision_source: result.provision_source,
          });
          console.warn('[Provision] Repaired missing provision_source after map-ready completion:', {
            campaignId,
            provision_source: result.provision_source,
          });
        }
      }

      return result;
    };

    if (!waitForLinker) {
      after(async () => {
        try {
          await runProvisionWorker();
        } catch (workerError) {
          console.error('[Provision] Background provision worker failed:', workerError);
          const failureReason = provisionFailureReason(workerError);
          try {
            await updateCampaignProvision(createAdminClient(), campaignId!, {
              provision_status: 'failed',
              provision_phase: 'failed',
              link_quality_status: 'failed',
              link_quality_reason: failureReason,
              data_quality_reason: failureReason,
            });
          } catch (updateError) {
            console.error('[Provision] Failed to persist background worker failure:', updateError);
          }
        }
      });

      return NextResponse.json(
        {
          success: true,
          accepted: true,
          campaign_id: campaignId,
          provision_status: 'pending',
          provision_phase: 'created',
          map_ready: false,
          postprocess_deferred: true,
          message: 'Campaign provisioning accepted. Map preparation will continue in the background.',
        },
        { status: 202 }
      );
    }

    const result = await runProvisionWorker();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Provision] Error:', error);

    if (campaignId) {
      const failureReason = provisionFailureReason(error);
      try {
        const supabase = createAdminClient();
        await supabase
          .from('campaigns')
          .update({
            provision_status: 'failed',
            provision_phase: 'failed',
            link_quality_status: 'failed',
            link_quality_reason: failureReason,
            data_quality_reason: failureReason,
          })
          .eq('id', campaignId);
      } catch (updateError) {
        console.error('[Provision] Failed to update provision_status:', updateError);
      }
    }

    const status = error instanceof CampaignHomeLimitError
      ? error.status
      : error instanceof ProvisionError
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : 'Provisioning failed';
    return NextResponse.json(
      {
        error: message,
        ...(error instanceof CampaignHomeLimitError ? campaignHomeLimitErrorPayload(error) : {}),
        provision_status: 'failed',
        provision_phase: 'failed',
      },
      { status }
    );
  }
}
