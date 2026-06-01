import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { bbox as turfBbox, booleanIntersects, feature } from '@turf/turf';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGunzip, gunzipSync } from 'zlib';
import { Readable } from 'stream';
import * as wkx from 'wkx';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { StableLinkerService, type BuildingFeature as SnapshotBuildingFeature } from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';
import { CampaignMapModeService } from '@/lib/services/CampaignMapModeService';
import {
  fetchScopedPmtilesParcels,
  parcelTilesFromSnapshot,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';
import regionBounds from '../../scripts/regions.json';

const PARCEL_BUCKET = 'flyr-pro-addresses-2025';
const PARCEL_ROOT_PREFIX = 'gold-standard';
const PARCEL_BATCH_SIZE = 500;

export type ParcelEnrichmentStatus =
  | 'not_started'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

type SupportedParcelSourceId = string;

type GeoJSONPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

type GeoJSONMultiPolygon = {
  type: 'MultiPolygon';
  coordinates: number[][][][];
};

type GeoJSONGeometry = GeoJSONPolygon | GeoJSONMultiPolygon;

type CampaignRow = {
  id: string;
  bbox: number[] | null;
  territory_boundary: GeoJSONPolygon | null;
  region: string | null;
};

type NormalizedParcelRecord = {
  externalId: string;
  geometry: GeoJSONMultiPolygon;
  properties: Record<string, unknown>;
};

type CampaignBuildingRow = {
  id: string;
  gers_id: string;
  geom: unknown;
  height: number | null;
  house_name: string | null;
  addr_street: string | null;
};

export interface ParcelPreparationResult {
  status: 'ready' | 'skipped' | 'failed';
  sourceId: string | null;
  parcelCount: number;
  parcels: Array<{
    externalId: string;
    geometry: GeoJSONMultiPolygon;
    properties: Record<string, unknown>;
  }>;
  error: string | null;
  debug: ParcelEnrichmentDebug;
}

type ParcelEnrichmentDebug = {
  mode?: 'bbox_only' | 'polygon_intersects';
  source_id?: string | null;
  s3_key?: string | null;
  pmtiles_key?: string | null;
  source_layer?: string | null;
  promote_id?: string | null;
  cache_status?: string | null;
  tile_count?: number;
  feature_count?: number;
  extraction_ms?: number;
  available_source_ids?: string[];
  scanned_lines?: number;
  parsed_records?: number;
  bbox_candidates?: number;
  polygon_matches?: number;
  inserted_count?: number;
  skipped_reason?: string | null;
  unsupported_localities?: string[];
  locality_counts?: Array<{ source_id: SupportedParcelSourceId; count: number }>;
  relink?: {
    strategy?: 'campaign_buildings' | 'snapshot' | 'none';
    gold_linker_ran: boolean;
    consolidated_linker_ran: boolean;
    snapshot_linker_ran?: boolean;
    snapshot_linker_used_parcels?: boolean;
    multi_unit_flags_refreshed: boolean;
    campaign_building_count?: number;
    snapshot_building_count?: number;
    townhouse_refresh_attempted: boolean;
    townhouse_refresh_applied: boolean;
  };
  started_at?: string;
  completed_at?: string;
};

interface RegionBoundsRow {
  code: string;
  name: string;
  country: string;
  bbox: [number, number, number, number];
}

type RegionMetadata = {
  regionCode: string;
  countryCode: string;
  countrySlug: string;
  regionSlugCandidates: string[];
  regionWideSourceIds: string[];
};

type ParcelDatasetRecord = {
  regionCode: string;
  countrySlug: string;
  regionSlug: string;
  sourceId: SupportedParcelSourceId;
  key: string;
  datePart: string;
  localityAliases: string[];
  isRegionWide: boolean;
};

const SOURCE_ID_LOCALITY_ALIASES: Record<string, string[]> = {
  clarington_parcels: ['bowmanville', 'courtice', 'newcastle'],
  strathcona_parcels: ['sherwood park'],
  toronto_parcels: ['east york', 'etobicoke', 'north york', 'scarborough', 'york'],
  york_region_parcels: [
    'aurora',
    'east gwillimbury',
    'georgina',
    'king',
    'markham',
    'newmarket',
    'richmond hill',
    'thornhill',
    'vaughan',
    'whitchurch-stouffville',
  ],
};

const REGION_ROWS = regionBounds as RegionBoundsRow[];

const REGION_METADATA_BY_CODE = new Map<string, RegionMetadata>(
  REGION_ROWS.map((row) => {
    const countrySlug = row.country === 'CA' ? 'canada' : row.country.toLowerCase();
    const regionNameSlug = slugifyForS3(row.name);
    const regionCodeSlug = row.code.toLowerCase();
    const regionSlugCandidates = Array.from(new Set([regionNameSlug, regionCodeSlug]));

    return [
      row.code.toUpperCase(),
      {
        regionCode: row.code.toUpperCase(),
        countryCode: row.country.toUpperCase(),
        countrySlug,
        regionSlugCandidates,
        regionWideSourceIds: regionSlugCandidates.map((slug) => `${slug}_parcels`),
      },
    ] satisfies [string, RegionMetadata];
  })
);

const REGION_CODE_BY_S3_PATH = new Map<string, string>();
for (const metadata of REGION_METADATA_BY_CODE.values()) {
  for (const regionSlug of metadata.regionSlugCandidates) {
    REGION_CODE_BY_S3_PATH.set(`${metadata.countrySlug}/${regionSlug}`, metadata.regionCode);
  }
}

function normalizePhrase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function slugifyForS3(value: string): string {
  return normalizePhrase(value).replace(/ /g, '_');
}

function normalizeLocality(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizePhrase(value);
  return normalized || null;
}

function getRegionMetadata(regionCode: string | null | undefined): RegionMetadata | null {
  if (!regionCode) return null;
  return REGION_METADATA_BY_CODE.get(regionCode.trim().toUpperCase()) ?? null;
}

function deriveSourceAliases(sourceId: string): string[] {
  const aliases = new Set<string>();

  const parts = sourceId
    .trim()
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .filter((part) => part !== 'gold');

  while (parts.length > 0 && ['parcel', 'parcels'].includes(parts[parts.length - 1])) {
    parts.pop();
  }
  while (parts.length > 0 && ['property', 'properties'].includes(parts[parts.length - 1])) {
    parts.pop();
  }

  const derived = normalizeLocality(parts.join(' '));
  if (derived) aliases.add(derived);

  for (const extraAlias of SOURCE_ID_LOCALITY_ALIASES[sourceId] ?? []) {
    const normalized = normalizeLocality(extraAlias);
    if (normalized) aliases.add(normalized);
  }

  return Array.from(aliases);
}

function parseParcelDatasetKey(key: string): ParcelDatasetRecord | null {
  const match = key.match(
    /^gold-standard\/([^/]+)\/([^/]+)\/([^/]+)\/(\d{8})\/([^/]+_gold\.ndjson)$/
  );
  if (!match) return null;

  const [, countrySlug, regionSlug, sourceId, datePart, filename] = match;
  if (filename !== `${sourceId}_gold.ndjson`) {
    return null;
  }

  const regionCode = REGION_CODE_BY_S3_PATH.get(`${countrySlug}/${regionSlug}`);
  if (!regionCode) {
    return null;
  }

  const regionMetadata = getRegionMetadata(regionCode);
  if (!regionMetadata) {
    return null;
  }

  return {
    regionCode,
    countrySlug,
    regionSlug,
    sourceId,
    key,
    datePart,
    localityAliases: deriveSourceAliases(sourceId),
    isRegionWide: regionMetadata.regionWideSourceIds.includes(sourceId),
  };
}

function getCampaignBbox(campaign: CampaignRow): number[] | null {
  if (Array.isArray(campaign.bbox) && campaign.bbox.length === 4) {
    return campaign.bbox;
  }

  if (campaign.territory_boundary) {
    try {
      return turfBbox(feature(campaign.territory_boundary));
    } catch {
      return null;
    }
  }

  return null;
}

function intersectsBbox(geometry: GeoJSONGeometry, bbox: number[]): boolean {
  try {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const [geomMinLon, geomMinLat, geomMaxLon, geomMaxLat] = turfBbox(feature(geometry));

    return !(
      geomMaxLon < minLon ||
      geomMinLon > maxLon ||
      geomMaxLat < minLat ||
      geomMinLat > maxLat
    );
  } catch {
    return false;
  }
}

function isWithinCampaignPolygon(geometry: GeoJSONGeometry, polygon: GeoJSONPolygon): boolean {
  try {
    return booleanIntersects(feature(geometry), feature(polygon));
  } catch {
    return false;
  }
}

function toMultiPolygonGeometry(geometry: unknown): GeoJSONMultiPolygon | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const candidate = geometry as { type?: string; coordinates?: unknown };

  if (candidate.type === 'MultiPolygon' && Array.isArray(candidate.coordinates)) {
    return {
      type: 'MultiPolygon',
      coordinates: candidate.coordinates as number[][][][],
    };
  }

  if (candidate.type === 'Polygon' && Array.isArray(candidate.coordinates)) {
    return {
      type: 'MultiPolygon',
      coordinates: [candidate.coordinates as number[][][]],
    };
  }

  return null;
}

function parseGeometryValue(geometry: unknown): GeoJSONMultiPolygon | null {
  if (!geometry) return null;

  if (typeof geometry === 'object') {
    return toMultiPolygonGeometry(geometry);
  }

  if (typeof geometry !== 'string') {
    return null;
  }

  const trimmed = geometry.trim();
  if (!trimmed) return null;

  try {
    return toMultiPolygonGeometry(JSON.parse(trimmed));
  } catch {
    // Fall through to WKT parsing.
  }

  try {
    const parsed = wkx.Geometry.parse(trimmed);
    return toMultiPolygonGeometry(parsed.toGeoJSON());
  } catch {
    return null;
  }
}

function parseParcelJsonLine(line: string): { parsed: unknown; sanitizedNonFiniteNumber: boolean } {
  try {
    return { parsed: JSON.parse(line), sanitizedNonFiniteNumber: false };
  } catch (error) {
    if (!/\bNaN\b/.test(line)) {
      throw error;
    }

    const sanitized = line.replace(/(:|,|\[)\s*NaN(?=\s*[,}\]])/g, '$1 null');
    return { parsed: JSON.parse(sanitized), sanitizedNonFiniteNumber: true };
  }
}

function normalizeParcelLine(raw: unknown): NormalizedParcelRecord | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const isFeature = record.type === 'Feature';

  const featureProperties = isFeature && record.properties && typeof record.properties === 'object'
    ? { ...(record.properties as Record<string, unknown>) }
    : {};

  const geometry = parseGeometryValue(
    isFeature ? record.geometry : (record.geometry ?? record.geom ?? record.geom_json)
  );

  if (!geometry) return null;

  const properties = isFeature
    ? featureProperties
    : record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
      ? { ...(record.properties as Record<string, unknown>) }
    : Object.fromEntries(
        Object.entries(record).filter(([key]) => !['geometry', 'geom', 'geom_json'].includes(key))
      );

  const externalIdCandidate =
    featureProperties.external_id ??
    featureProperties.parcel_id ??
    featureProperties.PARCELID ??
    record.external_id ??
    record.parcel_id ??
    record.id;

  const externalId = typeof externalIdCandidate === 'string' || typeof externalIdCandidate === 'number'
    ? String(externalIdCandidate).trim()
    : '';

  if (!externalId) return null;

  return {
    externalId,
    geometry,
    properties,
  };
}

async function streamBodyToString(body: { transformToString?: () => Promise<string> } | undefined) {
  if (!body?.transformToString) return '';
  return body.transformToString();
}

async function streamBodyToBytes(body: { transformToByteArray?: () => Promise<Uint8Array> } | undefined) {
  if (!body?.transformToByteArray) return null;
  return body.transformToByteArray();
}

async function* streamBodyLines(body: unknown, options?: { compressed?: boolean }): AsyncGenerator<string> {
  const asyncIterable = body as AsyncIterable<Uint8Array> | null;
  if (asyncIterable && typeof asyncIterable[Symbol.asyncIterator] === 'function') {
    const source = options?.compressed
      ? Readable.from(asyncIterable).pipe(createGunzip())
      : asyncIterable;
    const decoder = new TextDecoder('utf-8');
    let buffered = '';

    for await (const chunk of source) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        yield line;
      }
    }

    buffered += decoder.decode();
    if (buffered) {
      yield buffered;
    }
    return;
  }

  const normalizedText = options?.compressed
    ? gunzipSync(Buffer.from(
        (await streamBodyToBytes(body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined)) ?? []
      )).toString('utf8')
    : await streamBodyToString(body as { transformToString?: () => Promise<string> } | undefined);
  for (const line of normalizedText.split(/\r?\n/)) {
    yield line;
  }
}

export class ParcelEnrichmentService {
  private readonly s3: S3Client;

  constructor(private readonly supabase: SupabaseClient) {
    this.s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
  }

  async markQueued(campaignId: string) {
    await this.supabase
      .from('campaigns')
      .update({
        parcel_enrichment_status: 'queued',
        parcel_enrichment_error: null,
        parcel_enrichment_debug: {
          status: 'queued',
          queued_at: new Date().toISOString(),
        },
      })
      .eq('id', campaignId);
  }

  async prepareParcelsForProvision(
    campaignId: string,
    preloadedParcels?: GeoJSON.FeatureCollection
  ): Promise<ParcelPreparationResult> {
    const campaign = await this.getCampaign(campaignId);
    const result = preloadedParcels?.features.length
      ? this.preparePreloadedParcels(preloadedParcels)
      : await this.loadCampaignParcels(campaignId, campaign);

    if (result.status === 'ready') {
      await this.replaceCampaignParcels(campaignId, result.parcels);
    }

    await this.markTerminalState(campaignId, result.status, {
      sourceId: result.sourceId,
      parcelCount: result.parcelCount,
      error: result.error,
      debug: result.debug,
    });

    return result;
  }

  private preparePreloadedParcels(preloadedParcels: GeoJSON.FeatureCollection): ParcelPreparationResult {
    const parcels = preloadedParcels.features
      .map((parcel) => normalizeParcelLine(parcel))
      .filter((parcel): parcel is NormalizedParcelRecord => Boolean(parcel));

    return {
      status: 'ready',
      sourceId: 'preloaded_pmtiles',
      parcelCount: parcels.length,
      parcels,
      error: null,
      debug: {
        mode: 'polygon_intersects',
        source_id: 'preloaded_pmtiles',
        inserted_count: parcels.length,
        completed_at: new Date().toISOString(),
      },
    };
  }

  async runForCampaign(campaignId: string) {
    const campaign = await this.getCampaign(campaignId);
    const campaignPolygon = campaign.territory_boundary;
    const debug: ParcelEnrichmentDebug = {
      mode: campaignPolygon ? 'polygon_intersects' : 'bbox_only',
      started_at: new Date().toISOString(),
    };

    await this.supabase
      .from('campaigns')
      .update({
        parcel_enrichment_status: 'processing',
        parcel_enrichment_error: null,
        parcel_enrichment_debug: debug,
      })
      .eq('id', campaignId);

    try {
      const result = await this.loadCampaignParcels(campaignId, campaign, debug);
      if (result.status !== 'ready') {
        await this.markTerminalState(campaignId, result.status, {
          sourceId: result.sourceId,
          parcelCount: result.parcelCount,
          error: result.error,
          debug: result.debug,
        });
        await new CampaignMapModeService(this.supabase).computeAndPersist(campaignId, {
          hasParcels: false,
          parcelCount: 0,
        });
        return;
      }

      await this.replaceCampaignParcels(campaignId, result.parcels);
      if (result.parcelCount === 0) {
        await this.markTerminalState(campaignId, 'ready', {
          sourceId: result.sourceId,
          parcelCount: 0,
          debug: result.debug,
        });
        await new CampaignMapModeService(this.supabase).computeAndPersist(campaignId, {
          hasParcels: false,
          parcelCount: 0,
        });
        return;
      }

      const relinkResult = await this.relinkCampaign(campaignId, campaign.territory_boundary, result.parcels);
      const multiUnitFlagsRefreshed = await this.refreshMultiUnitFlags(campaignId);
      const townhouseRefreshResult = await this.refreshTownhouseUnits(campaignId);

      await this.markTerminalState(campaignId, 'ready', {
        sourceId: result.sourceId,
        parcelCount: result.parcelCount,
        debug: {
          ...result.debug,
          relink: {
            strategy: relinkResult.strategy,
            gold_linker_ran: relinkResult.gold_linker_ran,
            consolidated_linker_ran: relinkResult.consolidated_linker_ran,
            snapshot_linker_ran: relinkResult.snapshot_linker_ran,
            snapshot_linker_used_parcels: relinkResult.snapshot_linker_used_parcels,
            multi_unit_flags_refreshed: multiUnitFlagsRefreshed,
            campaign_building_count: relinkResult.campaign_building_count,
            snapshot_building_count: relinkResult.snapshot_building_count,
            townhouse_refresh_attempted: townhouseRefreshResult.attempted,
            townhouse_refresh_applied: townhouseRefreshResult.applied,
          },
          completed_at: new Date().toISOString(),
        },
      });
      await new CampaignMapModeService(this.supabase).computeAndPersist(campaignId, {
        hasParcels: result.parcelCount > 0,
        parcelCount: result.parcelCount,
      });
    } catch (error) {
      await this.markTerminalState(campaignId, 'failed', {
        error: error instanceof Error ? error.message : 'Unknown parcel enrichment error.',
        debug: {
          ...debug,
          completed_at: new Date().toISOString(),
        },
      });
    }
  }

  private async getCampaign(campaignId: string): Promise<CampaignRow> {
    const { data: campaign, error: campaignError } = await this.supabase
      .from('campaigns')
      .select('id, bbox, territory_boundary, region')
      .eq('id', campaignId)
      .single<CampaignRow>();

    if (campaignError || !campaign) {
      throw new Error(`Campaign lookup failed: ${campaignError?.message || 'not found'}`);
    }

    return campaign;
  }

  private async getCampaignSnapshot(campaignId: string): Promise<CampaignSnapshotRow | null> {
    const { data, error } = await this.supabase
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, addresses_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (error) {
      throw new Error(`Campaign snapshot lookup failed: ${error.message}`);
    }

    return (data as CampaignSnapshotRow | null) ?? null;
  }

  private async loadCampaignParcels(
    campaignId: string,
    campaign: CampaignRow,
    debugOverride?: ParcelEnrichmentDebug
  ): Promise<ParcelPreparationResult> {
    const bbox = getCampaignBbox(campaign);
    const campaignPolygon = campaign.territory_boundary;
    if (!bbox) {
      return {
        status: 'failed',
        sourceId: null,
        parcelCount: 0,
        parcels: [],
        error: 'Campaign has no bbox or territory boundary for parcel filtering.',
        debug: {
          ...(debugOverride ?? {}),
          mode: campaignPolygon ? 'polygon_intersects' : 'bbox_only',
          skipped_reason: 'Campaign has no bbox or territory boundary for parcel filtering.',
          completed_at: new Date().toISOString(),
        },
      };
    }

    const debug: ParcelEnrichmentDebug = {
      mode: campaignPolygon ? 'polygon_intersects' : 'bbox_only',
      started_at: debugOverride?.started_at ?? new Date().toISOString(),
      ...debugOverride,
    };

    const snapshot = await this.getCampaignSnapshot(campaignId);
    const parcelTiles = parcelTilesFromSnapshot(snapshot);
    if (!snapshot || !parcelTiles) {
      return {
        status: 'failed',
        sourceId: null,
        parcelCount: 0,
        parcels: [],
        error: 'PMTiles parcel artifact unavailable for campaign parcel enrichment.',
        debug: {
          ...debug,
          skipped_reason: 'Missing campaign snapshot parcels_pmtiles_key.',
          completed_at: new Date().toISOString(),
        },
      };
    }

    if (!campaignPolygon) {
      return {
        status: 'failed',
        sourceId: null,
        parcelCount: 0,
        parcels: [],
        error: 'Campaign has no territory boundary for PMTiles parcel filtering.',
        debug: {
          ...debug,
          skipped_reason: 'Campaign has no territory boundary for PMTiles parcel filtering.',
          completed_at: new Date().toISOString(),
        },
      };
    }

    debug.source_id = parcelTiles.datePart;
    debug.pmtiles_key = parcelTiles.pmtilesKey;
    debug.source_layer = parcelTiles.sourceLayer;
    debug.promote_id = parcelTiles.promoteId;

    try {
      const scoped = await fetchScopedPmtilesParcels(
        campaignId,
        snapshot,
        parcelTiles,
        bbox as [number, number, number, number],
        campaignPolygon as GeoJSON.Polygon
      );
      const parcels = scoped.parcels
        .map((parcel) => normalizeParcelLine({
          type: 'Feature',
          geometry: JSON.parse(parcel.geom),
          properties: {
            ...parcel.properties,
            external_id: parcel.external_id,
            parcel_id: parcel.external_id,
          },
        }))
        .filter((parcel): parcel is NormalizedParcelRecord => Boolean(parcel));

      debug.cache_status = scoped.cacheStatus;
      debug.tile_count = scoped.timings.tileCount;
      debug.feature_count = scoped.timings.featureCount;
      debug.extraction_ms = scoped.timings.totalMs;
      debug.bbox_candidates = scoped.parcels.length;
      debug.polygon_matches = parcels.length;
      debug.inserted_count = parcels.length;
      debug.completed_at = new Date().toISOString();

      return {
        status: 'ready',
        sourceId: parcelTiles.pmtilesKey,
        parcelCount: parcels.length,
        parcels,
        error: null,
        debug,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        sourceId: parcelTiles.pmtilesKey,
        parcelCount: 0,
        parcels: [],
        error: `PMTiles parcel artifact unavailable: ${errorMessage}`,
        debug: {
          ...debug,
          completed_at: new Date().toISOString(),
        },
      };
    }
  }

  private async replaceCampaignParcels(campaignId: string, parcels: NormalizedParcelRecord[]) {
    await this.supabase
      .from('campaign_parcels')
      .delete()
      .eq('campaign_id', campaignId);

    if (parcels.length === 0) {
      return;
    }

    for (let i = 0; i < parcels.length; i += PARCEL_BATCH_SIZE) {
      const batch = parcels.slice(i, i + PARCEL_BATCH_SIZE).map((parcel) => ({
        campaign_id: campaignId,
        external_id: parcel.externalId,
        geom: JSON.stringify(parcel.geometry),
        properties: parcel.properties,
      }));

      const { error } = await this.supabase
        .from('campaign_parcels')
        .insert(batch);

      if (error) {
        throw new Error(`Parcel insert failed: ${error.message}`);
      }
    }
  }

  private async inferSourceId(campaignId: string, datasets: ParcelDatasetRecord[]): Promise<{
    dataset: ParcelDatasetRecord | null;
    unsupportedLocalities: string[];
    localityCounts: Array<{ source_id: SupportedParcelSourceId; count: number }>;
  }> {
    const rows = await fetchAllInPages(async (from, to) =>
      await this.supabase
        .from('campaign_addresses')
        .select('locality')
        .eq('campaign_id', campaignId)
        .range(from, to)
    );

    const localities = rows
      .map((row) => normalizeLocality((row as { locality?: string | null }).locality))
      .filter((value): value is string => Boolean(value));

    return this.selectBestParcelDataset(localities, datasets);
  }

  private selectBestParcelDataset(
    localities: string[],
    datasets: ParcelDatasetRecord[]
  ): {
    dataset: ParcelDatasetRecord | null;
    unsupportedLocalities: string[];
    localityCounts: Array<{ source_id: SupportedParcelSourceId; count: number }>;
  } {
    const localityCounts = new Map<SupportedParcelSourceId, number>();
    const unsupportedLocalities = new Set<string>();
    const localityScopedDatasets = datasets.filter((dataset) => !dataset.isRegionWide);

    for (const locality of localities) {
      const matchingDatasets = localityScopedDatasets.filter((dataset) =>
        dataset.localityAliases.includes(locality)
      );

      if (matchingDatasets.length === 0) {
        unsupportedLocalities.add(locality);
        continue;
      }

      for (const dataset of matchingDatasets) {
        localityCounts.set(dataset.sourceId, (localityCounts.get(dataset.sourceId) || 0) + 1);
      }
    }

    const ranked = Array.from(localityCounts.entries()).sort((a, b) => b[1] - a[1]);
    const localitySummary = ranked.map(([source_id, count]) => ({ source_id, count }));

    const regionWideDataset = datasets.find((dataset) => dataset.isRegionWide) ?? null;
    const selectedDataset =
      (ranked.length > 0
        ? datasets.find((dataset) => dataset.sourceId === ranked[0][0]) ?? null
        : null) ??
      regionWideDataset ??
      (datasets.length === 1 ? datasets[0] : null);

    if (!selectedDataset && unsupportedLocalities.size > 0) {
      console.warn('[ParcelEnrichment] Unsupported localities:', Array.from(unsupportedLocalities));
    }

    return {
      dataset: selectedDataset,
      unsupportedLocalities: Array.from(unsupportedLocalities).sort(),
      localityCounts: localitySummary,
    };
  }

  private async listLatestParcelDatasetsForRegion(regionMetadata: RegionMetadata): Promise<ParcelDatasetRecord[]> {
    const latestBySourceId = new Map<string, ParcelDatasetRecord>();

    for (const regionSlug of regionMetadata.regionSlugCandidates) {
      const prefix = `${PARCEL_ROOT_PREFIX}/${regionMetadata.countrySlug}/${regionSlug}/`;
      let continuationToken: string | undefined;

      do {
        const response = await this.s3.send(
          new ListObjectsV2Command({
            Bucket: PARCEL_BUCKET,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents || []) {
          const key = object.Key || '';
          const dataset = parseParcelDatasetKey(key);
          if (!dataset || dataset.regionCode !== regionMetadata.regionCode) continue;

          const existing = latestBySourceId.get(dataset.sourceId);
          if (!existing || dataset.datePart > existing.datePart) {
            latestBySourceId.set(dataset.sourceId, dataset);
          }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    }

    return Array.from(latestBySourceId.values()).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  private async relinkCampaign(
    campaignId: string,
    polygon: GeoJSONPolygon | null,
    parcels: NormalizedParcelRecord[]
  ): Promise<{
    strategy: 'campaign_buildings' | 'snapshot' | 'none';
    gold_linker_ran: boolean;
    consolidated_linker_ran: boolean;
    snapshot_linker_ran: boolean;
    snapshot_linker_used_parcels: boolean;
    campaign_building_count: number;
    snapshot_building_count: number;
  }> {
    const campaignBuildings = await this.loadCampaignBuildings(campaignId);
    const campaignBuildingCount = campaignBuildings.features.length;
    const linker = new StableLinkerService(this.supabase);
    const parcelBridgeGeoJSON = {
      features: parcels.map((parcel) => ({
        type: 'Feature' as const,
        geometry: parcel.geometry,
        properties: {
          ...parcel.properties,
          external_id: parcel.externalId,
          parcel_id: parcel.externalId,
        },
      })),
    };

    if (campaignBuildingCount > 0) {
      console.log('[ParcelEnrichment] Relinking campaign building store with area-only house filtering:', {
        campaignId,
        campaignBuildingCount,
        hasPolygon: Boolean(polygon),
        parcelCount: parcels.length,
      });
      await linker.runSpatialJoin(
        campaignId,
        { features: campaignBuildings.features },
        '2026-01-21.0',
        {
          resetExisting: true,
          persistenceMode: 'gold',
          parcelsGeoJSON: parcelBridgeGeoJSON,
        }
      );

      return {
        strategy: 'campaign_buildings',
        gold_linker_ran: true,
        consolidated_linker_ran: true,
        snapshot_linker_ran: false,
        snapshot_linker_used_parcels: parcels.length > 0,
        campaign_building_count: campaignBuildingCount,
        snapshot_building_count: 0,
      };
    }

    const snapshot = await this.loadSnapshotBuildings(campaignId);
    if (!snapshot || snapshot.buildingsGeoJSON.features.length === 0) {
      console.warn('[ParcelEnrichment] No viable building source for parcel-aware relink:', {
        campaignId,
        campaignBuildingCount,
      });
      return {
        strategy: 'none',
        gold_linker_ran: false,
        consolidated_linker_ran: false,
        snapshot_linker_ran: false,
        snapshot_linker_used_parcels: false,
        campaign_building_count: campaignBuildingCount,
        snapshot_building_count: 0,
      };
    }

    console.log('[ParcelEnrichment] Relinking snapshot with area-only house filtering:', {
      campaignId,
      campaignBuildingCount,
      snapshotBuildingCount: snapshot.buildingsGeoJSON.features.length,
      parcelCount: parcels.length,
    });
    await linker.runSpatialJoin(
      campaignId,
      snapshot.buildingsGeoJSON,
      snapshot.overtureRelease,
      {
        resetExisting: true,
        parcelsGeoJSON: parcelBridgeGeoJSON,
      }
    );

    return {
      strategy: 'snapshot',
      gold_linker_ran: false,
      consolidated_linker_ran: true,
      snapshot_linker_ran: true,
      snapshot_linker_used_parcels: parcels.length > 0,
      campaign_building_count: campaignBuildingCount,
      snapshot_building_count: snapshot.buildingsGeoJSON.features.length,
    };
  }

  private async refreshMultiUnitFlags(campaignId: string): Promise<boolean> {
    const links = await fetchAllInPages(async (from, to) =>
      await this.supabase
        .from('building_address_links')
        .select('id, building_id')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    if (links.length === 0) return false;

    const counts = new Map<string, number>();
    for (const row of links) {
      const buildingId = String((row as { building_id?: string | null }).building_id || '');
      if (!buildingId) continue;
      counts.set(buildingId, (counts.get(buildingId) || 0) + 1);
    }

    await Promise.all(
      links.map((row) => {
        const record = row as { id: string; building_id?: string | null };
        const buildingId = String(record.building_id || '');
        const unitCount = counts.get(buildingId) || 1;
        return this.supabase
          .from('building_address_links')
          .update({
            unit_count: unitCount,
            is_multi_unit: unitCount > 1,
            unit_arrangement: unitCount > 1 ? 'horizontal' : 'single',
          })
          .eq('id', record.id);
      })
    );

    return true;
  }

  private async refreshTownhouseUnits(campaignId: string): Promise<{
    attempted: boolean;
    applied: boolean;
  }> {
    const snapshot = await this.loadSnapshotBuildings(campaignId);
    if (!snapshot || snapshot.buildingsGeoJSON.features.length === 0) {
      return {
        attempted: false,
        applied: false,
      };
    }

    const splitter = new TownhouseSplitterService(this.supabase);
    await splitter.processCampaignTownhouses(
      campaignId,
      snapshot.buildingsGeoJSON as { features: Array<{ type: 'Feature'; geometry: { type: 'Polygon'; coordinates: number[][][] }; properties: { gers_id: string } }> },
      snapshot.overtureRelease
    );
    return {
      attempted: true,
      applied: true,
    };
  }

  private async loadCampaignBuildings(campaignId: string): Promise<{ features: SnapshotBuildingFeature[] }> {
    const rows = await fetchAllInPages(async (from, to) =>
      await this.supabase
        .from('buildings')
        .select('id, gers_id, geom, height, house_name, addr_street')
        .eq('campaign_id', campaignId)
        .eq('is_hidden', false)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const features: SnapshotBuildingFeature[] = [];
    for (const row of rows as CampaignBuildingRow[]) {
      const geometry = parseGeometryValue(row.geom);
      const polygon = geometry?.coordinates?.[0];
      if (!polygon || polygon.length === 0) {
        continue;
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: polygon,
        },
        properties: {
          gers_id: row.id,
          name: row.house_name ?? row.gers_id ?? null,
          height: row.height ?? null,
          layer: 'building',
          primary_street: row.addr_street ?? null,
        },
      });
    }

    return { features };
  }

  private async loadSnapshotBuildings(campaignId: string): Promise<{
    overtureRelease: string;
    buildingsGeoJSON: { features: SnapshotBuildingFeature[] };
  } | null> {
    const { data: snapshot, error: snapshotError } = await this.supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, overture_release, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (snapshotError || !snapshot?.bucket || !snapshot?.buildings_key) {
      return null;
    }

    const tileMetrics =
      snapshot.tile_metrics && typeof snapshot.tile_metrics === 'object'
        ? snapshot.tile_metrics as Record<string, unknown>
        : {};
    const buildingsGeojsonKey =
      typeof tileMetrics.buildings_geojson_key === 'string'
        ? tileMetrics.buildings_geojson_key
        : null;
    const buildingsKey = buildingsGeojsonKey ?? snapshot.buildings_key;
    if (!buildingsKey.endsWith('.geojson') && !buildingsKey.endsWith('.geojson.gz')) {
      console.warn('[ParcelEnrichment] Snapshot buildings key is not GeoJSON; skipping snapshot relink:', {
        campaignId,
        buildingsKey,
      });
      return null;
    }

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: snapshot.bucket,
        Key: buildingsKey,
      })
    );

    const bytes = await streamBodyToBytes(response.Body);
    if (!bytes) return null;

    const text = buildingsKey.endsWith('.gz') || response.ContentEncoding === 'gzip'
      ? gunzipSync(Buffer.from(bytes)).toString('utf-8')
      : Buffer.from(bytes).toString('utf-8');
    const buildingsGeoJSON = JSON.parse(text) as { features?: SnapshotBuildingFeature[] };
    if (!Array.isArray(buildingsGeoJSON.features) || buildingsGeoJSON.features.length === 0) {
      return null;
    }

    return {
      overtureRelease: snapshot.overture_release || '2026-01-21.0',
      buildingsGeoJSON: {
        features: buildingsGeoJSON.features,
      },
    };
  }

  private async markTerminalState(
    campaignId: string,
    status: Extract<ParcelEnrichmentStatus, 'ready' | 'failed' | 'skipped'>,
    options: {
      sourceId?: string | null;
      parcelCount?: number;
      error?: string | null;
      debug?: ParcelEnrichmentDebug;
    }
  ) {
    await this.supabase
      .from('campaigns')
      .update({
        parcel_enrichment_status: status,
        parcel_source_id: options.sourceId ?? null,
        parcel_count: options.parcelCount ?? 0,
        parcel_enriched_at: status === 'ready' ? new Date().toISOString() : null,
        parcel_enrichment_error: options.error ?? null,
        parcel_enrichment_debug: options.debug ?? {},
      })
      .eq('id', campaignId);
  }
}
