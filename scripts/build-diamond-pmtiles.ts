#!/usr/bin/env tsx
/**
 * Build the Diamond Mode geometry artifact for a campaign.
 *
 * This script intentionally exports only static geometry and stable join IDs.
 * Door status, notes, leads, visits, and assignments stay in Supabase/SQLite.
 *
 * Usage:
 *   npx tsx scripts/build-diamond-pmtiles.ts <campaign-id>
 *   npx tsx scripts/build-diamond-pmtiles.ts <campaign-id> --dry-run --keep-workdir
 *   npx tsx scripts/build-diamond-pmtiles.ts <campaign-id> --stage-prefix=staging
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import { isLinkableBuildingFootprint } from '@/lib/geo/buildingFootprintFilter';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Position = [number, number];
type Geometry = {
  type: string;
  coordinates: unknown;
};
type Feature = {
  type: 'Feature';
  id?: string;
  geometry: Geometry | null;
  properties?: Record<string, unknown> | null;
};
type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};
type TurfPolygonFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
type ExistingSnapshot = {
  bucket?: string | null;
  prefix?: string | null;
  buildings_key?: string | null;
  metadata_key?: string | null;
  buildings_count?: number | null;
  addresses_count?: number | null;
  roads_count?: number | null;
  tile_metrics?: Record<string, unknown> | null;
};
type CampaignContext = {
  id: string;
  bbox?: unknown;
  territory_boundary?: unknown;
  provision_source?: string | null;
};
type CampaignAddressExportRow = {
  id: string;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  source?: string | null;
  source_id?: string | null;
  gers_id?: string | null;
  building_id?: string | null;
  building_gers_id?: string | null;
  geom?: unknown;
  scans?: number | null;
};
type GoldBuildingExportRow = {
  id: string;
  area_sqm?: number | null;
  height_m?: number | null;
  floors?: number | null;
  building_type?: string | null;
  subtype?: string | null;
  geom?: unknown;
  geom_geojson?: string | null;
};
type MatchConfidence = 'inside' | 'nearby' | 'unmatched';
type AddressBuildingMatch = {
  address: CampaignAddressExportRow;
  point: Position;
  buildingId: string | null;
  confidence: MatchConfidence;
  distanceMeters: number | null;
};

const ADDRESS_CIRCLE_RADIUS_METERS = 2.8;
const ADDRESS_CIRCLE_STEPS = 32;

const args = process.argv.slice(2);
const campaignId = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const keepWorkdir = args.includes('--keep-workdir');
const BUILDING_TILE_BUFFER_UNITS = Number(process.env.BUILDING_TILE_BUFFER_UNITS ?? 127);
const BUILDING_BOUNDS_BUFFER_METERS = Number(process.env.BUILDING_BOUNDS_BUFFER_METERS ?? 128);
const SNAPSHOT_BUILDING_PADDING_METERS = Number(
  readFlag('padding-meters') ?? process.env.DIAMOND_BUILD_PADDING_METERS ?? '80'
);
const minzoom = Number(readFlag('minzoom') ?? '13');
const maxzoom = Number(readFlag('maxzoom') ?? '18');
const MAX_NEARBY_BUILDING_METERS = Number(readFlag('max-nearby-meters') ?? '55');
const geometryStagePrefix = normalizeStagePrefix(readFlag('stage-prefix') ?? process.env.GEOMETRY_STAGE_PREFIX);
const geometryStage = process.env.GEOMETRY_STAGE?.trim() || geometryStagePrefix || 'production';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket =
  process.env.DIAMOND_GEOMETRY_BUCKET ||
  process.env.FLYR_SNAPSHOTS_BUCKET ||
  process.env.AWS_BUCKET_NAME ||
  'flyr-pro-addresses-2025';
const region = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';
const rawApiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://www.flyrpro.app'
).replace(/\/+$/, '');
const apiBaseUrl = rawApiBaseUrl === 'https://flyrpro.app' ? 'https://www.flyrpro.app' : rawApiBaseUrl;

if (!campaignId) {
  console.error('Usage: npx tsx scripts/build-diamond-pmtiles.ts <campaign-id> [--dry-run] [--keep-workdir]');
  process.exit(1);
}
if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const s3 = new S3Client({
  region,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    : undefined,
});

main().catch((error) => {
  console.error('❌ Diamond PMTiles build failed:', error);
  process.exit(1);
});

async function main() {
  const workdir = await mkdtemp(path.join(tmpdir(), `flyr-diamond-${campaignId}-`));
  console.log(`💎 Building Diamond PMTiles artifact for campaign ${campaignId}`);
  console.log(`   Workdir: ${workdir}`);

  try {
    const { campaign, snapshot } = await loadCampaignContext(campaignId!);
    await ensureCampaignLinksForDiamond(campaignId!, campaign);
    const exportedBuildings = await exportBuildingFeatures(campaignId!, snapshot, campaign);
    const linkedBuildings = await relinkDiamondBuildingFeatures(campaignId!, exportedBuildings);
    const buildings = filterCampaignAddressBuildings(linkedBuildings);
    const addresses = await exportAddressFeatures(campaignId!);
    const addressCircles = buildAddressCircleFeatures(addresses);
    const parcels = await exportParcelFeatures(campaignId!);

    if (buildings.features.length === 0) {
      throw new Error('No polygon building features were exported for this campaign.');
    }
    if (addresses.features.length === 0) {
      throw new Error('No address point features were exported for this campaign.');
    }

    const bounds = normalizeBounds(campaign.bbox) ?? calculateBounds([...buildings.features, ...addresses.features, ...parcels.features]);
    const prefix = withGeometryStagePrefix(`campaigns/${campaignId}`);
    const pmtilesKey = `${prefix}/buildings.pmtiles`;
    const tilejsonKey = `${prefix}/buildings.json`;
    const geojsonKey = `${prefix}/buildings.geojson.gz`;
    const version = nextGeometryVersion(snapshot);

    const buildingsPath = path.join(workdir, 'buildings.geojson');
    const addressesPath = path.join(workdir, 'addresses.geojson');
    const addressCirclesPath = path.join(workdir, 'address_circles.geojson');
    const parcelsPath = path.join(workdir, 'parcels.geojson');
    const pmtilesPath = path.join(workdir, 'buildings.pmtiles');
    const tilejsonPath = path.join(workdir, 'buildings.json');

    await writeFile(buildingsPath, JSON.stringify(buildings));
    await writeFile(addressesPath, JSON.stringify(addresses));
    await writeFile(addressCirclesPath, JSON.stringify(addressCircles));
    await writeFile(parcelsPath, JSON.stringify(parcels));

    await runTippecanoe({
      buildingsPath,
      addressesPath,
      addressCirclesPath,
      parcelsPath: parcels.features.length > 0 ? parcelsPath : null,
      outputPath: pmtilesPath,
      minzoom,
      maxzoom,
    });

    const pmtilesBytes = await readFile(pmtilesPath);
    const pmtilesHash = sha256(pmtilesBytes);
    const pmtilesSize = await stat(pmtilesPath);
    const tilejson = buildTileJSON({
      campaignId: campaignId!,
      bounds,
      minzoom,
      maxzoom,
      pmtilesKey,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256: pmtilesHash,
      hasParcels: parcels.features.length > 0,
    });
    await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));

    const thinBuildingsGzip = gzipSync(JSON.stringify(buildings));

    console.log(`✅ Exported ${buildings.features.length} building feature(s)`);
    console.log(`✅ Exported ${addresses.features.length} address point feature(s)`);
    console.log(`✅ Exported ${addressCircles.features.length} address circle feature(s)`);
    console.log(`✅ Exported ${parcels.features.length} parcel feature(s)`);
    console.log(`✅ Wrote PMTiles (${(pmtilesSize.size / 1024 / 1024).toFixed(2)} MB)`);

    if (dryRun) {
      console.log('🧪 Dry run: skipping S3 upload and campaign_snapshots update.');
      return;
    }

    const pmtilesEtag = await uploadArtifact(pmtilesKey, pmtilesBytes, 'application/vnd.pmtiles');
    await uploadArtifact(tilejsonKey, await readFile(tilejsonPath), 'application/json; charset=utf-8');
    await uploadArtifact(geojsonKey, thinBuildingsGzip, 'application/geo+json', 'gzip');

    await upsertCampaignSnapshot({
      campaignId: campaignId!,
      snapshot,
      bucket,
      prefix,
      pmtilesKey,
      tilejsonKey,
      geojsonKey,
      buildingsCount: buildings.features.length,
      addressesCount: addresses.features.length,
      parcelsCount: parcels.features.length,
      geometryVersion: version,
      pmtilesEtag,
      pmtilesSha256: pmtilesHash,
      bounds,
      minzoom,
      maxzoom,
      pmtilesSizeBytes: pmtilesSize.size,
    });

    console.log('🚀 Diamond artifact is live.');
    console.log(`   PMTiles: s3://${bucket}/${pmtilesKey}`);
    console.log(`   TileJSON: s3://${bucket}/${tilejsonKey}`);
  } finally {
    if (keepWorkdir) {
      console.log(`🗂️  Kept workdir: ${workdir}`);
    } else {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

function readFlag(name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function normalizeStagePrefix(value: string | undefined) {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function withGeometryStagePrefix(key: string) {
  const normalizedKey = key.replace(/^\/+/, '');
  if (!geometryStagePrefix) return normalizedKey;
  return normalizedKey.startsWith(`${geometryStagePrefix}/`)
    ? normalizedKey
    : `${geometryStagePrefix}/${normalizedKey}`;
}

async function loadCampaignContext(id: string) {
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, bbox, territory_boundary, provision_source')
    .eq('id', id)
    .maybeSingle();
  if (campaignError || !campaign) {
    throw new Error(`Campaign not found: ${campaignError?.message ?? id}`);
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, metadata_key, buildings_count, addresses_count, roads_count, tile_metrics')
    .eq('campaign_id', id)
    .maybeSingle();
  if (snapshotError) {
    throw new Error(`Failed to load existing campaign snapshot: ${snapshotError.message}`);
  }

  return { campaign: campaign as CampaignContext, snapshot: snapshot as ExistingSnapshot | null };
}

async function exportBuildingFeatures(
  id: string,
  snapshot: ExistingSnapshot | null,
  campaign: CampaignContext
): Promise<FeatureCollection> {
  const { data, error } = await supabase.rpc('rpc_get_campaign_full_features', { p_campaign_id: id });
  if (error) {
    console.warn(`⚠️  rpc_get_campaign_full_features failed: ${error.message}`);
    console.warn('   Falling back to persisted campaign/gold geometry before snapshot fallback.');
    const dbFallback = await exportBuildingFeaturesFromPersistedRows(id, campaign);
    if (dbFallback.features.length > 0) {
      console.log(`✅ Exported ${dbFallback.features.length} building feature(s) from persisted fallback`);
      return dbFallback;
    }
    console.warn('   Falling back to existing static buildings GeoJSON snapshot.');
    return exportBuildingFeaturesFromSnapshot(snapshot, campaign);
  }

  const collection = normalizeFeatureCollection(data);
  const features = collection.features
    .filter((feature) => isPolygonLike(feature.geometry))
    .map(thinBuildingFeature)
    .filter((feature): feature is Feature => Boolean(feature));

  if (features.length === 0) {
    console.warn('⚠️  rpc_get_campaign_full_features returned no polygon features.');
    console.warn('   Falling back to persisted campaign/gold geometry before snapshot fallback.');
    const dbFallback = await exportBuildingFeaturesFromPersistedRows(id, campaign);
    if (dbFallback.features.length > 0) {
      console.log(`✅ Exported ${dbFallback.features.length} building feature(s) from persisted fallback`);
      return dbFallback;
    }
    console.warn('   Falling back to existing static buildings GeoJSON snapshot.');
    return exportBuildingFeaturesFromSnapshot(snapshot, campaign);
  }

  return { type: 'FeatureCollection', features };
}

async function ensureCampaignLinksForDiamond(id: string, campaign: CampaignContext) {
  if (String(campaign.provision_source ?? '').toLowerCase() !== 'gold') return;

  const { count, error: countError } = await supabase
    .from('campaign_addresses')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .not('building_id', 'is', null);

  if (countError) {
    console.warn(`⚠️  Failed to inspect Gold links before Diamond build: ${countError.message}`);
    return;
  }

  if ((count ?? 0) > 0) return;

  console.log('🔗 No Gold building links found; running SQL linker before Diamond export...');
  const { data, error } = await supabase.rpc('link_campaign_addresses_all', {
    p_campaign_id: id,
  });

  if (error) {
    console.warn(`⚠️  SQL linker failed before Diamond export: ${error.message}`);
    return;
  }

  console.log('✅ SQL linker completed before Diamond export:', JSON.stringify(data));
}

async function exportBuildingFeaturesFromPersistedRows(
  id: string,
  campaign: CampaignContext
): Promise<FeatureCollection> {
  const campaignBuildingFeatures = await exportCampaignBuildingFeatures(id);
  if (campaignBuildingFeatures.features.length > 0) {
    return campaignBuildingFeatures;
  }

  if (String(campaign.provision_source ?? '').toLowerCase() === 'gold') {
    return exportGoldBuildingFeatures(id, campaign.territory_boundary);
  }

  return { type: 'FeatureCollection', features: [] };
}

async function exportCampaignBuildingFeatures(id: string): Promise<FeatureCollection> {
  const selectClauses = [
    'id, gers_id, source, geom, height_m, height, floors, area_sqm, building_type, subtype, is_hidden',
    'id, gers_id, geom, height_m, height, floors, area_sqm, building_type, subtype, is_hidden',
    'id, gers_id, geom, height, is_hidden',
  ];
  let rows: Array<Record<string, unknown>> = [];
  let lastError: unknown = null;

  for (const selectClause of selectClauses) {
    try {
      rows = (await fetchAllPages((from, to) =>
        supabase
          .from('buildings')
          .select(selectClause)
          .eq('campaign_id', id)
          .order('id', { ascending: true })
          .range(from, to)
      )) as unknown as Array<Record<string, unknown>>;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn(`⚠️  buildings fallback failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return { type: 'FeatureCollection', features: [] };
  }

  const features = rows
    .filter((row) => (row as { is_hidden?: boolean | null }).is_hidden !== true)
    .map((row) => {
      const source = row as Record<string, unknown>;
      const geometry = parseGeometry(source.geom);
      if (!isPolygonLike(geometry)) return null;
      const buildingId = stringValue(source.gers_id) || stringValue(source.id);
      if (!buildingId) return null;
      const areaSqm = numberValue(source.area_sqm) ?? numberValue(source.area);
      const height = normalizeHeightMeters(
        numberValue(source.height_m) ?? numberValue(source.height),
        numberValue(source.floors),
        areaSqm
      );

      const feature: Feature = {
        type: 'Feature' as const,
        id: buildingId,
        geometry,
        properties: {
          building_id: buildingId,
          address_id: '',
          gers_id: buildingId,
          source: stringValue(source.source) || 'campaign',
          height,
          height_m: height,
          floors: numberValue(source.floors),
          area_sqm: areaSqm,
          building_type: stringValue(source.building_type),
          subtype: stringValue(source.subtype),
          address_count: null,
        },
      };
      return feature;
    })
    .filter((feature): feature is Feature => feature !== null);

  return { type: 'FeatureCollection', features };
}

async function exportGoldBuildingFeatures(id: string, territoryBoundary: unknown): Promise<FeatureCollection> {
  const addressRows = await fetchAllPages<CampaignAddressExportRow>((from, to) =>
    supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, building_id, building_gers_id, scans')
      .eq('campaign_id', id)
      .order('id', { ascending: true })
      .range(from, to)
  ).catch((error) => {
    console.warn(`⚠️  campaign_addresses fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    return [] as CampaignAddressExportRow[];
  });

  const addressesByBuildingId = groupAddressesByBuilding(addressRows);
  const linkedBuildingIds = Array.from(addressesByBuildingId.keys());
  const buildings: GoldBuildingExportRow[] = [];

  for (let index = 0; index < linkedBuildingIds.length; index += 200) {
    const batch = linkedBuildingIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from('ref_buildings_gold')
      .select('id, area_sqm, height_m, floors, building_type, subtype, geom')
      .in('id', batch);
    if (error) {
      console.warn(`⚠️  ref_buildings_gold linked fallback failed: ${error.message}`);
      break;
    }
    buildings.push(...((data ?? []) as GoldBuildingExportRow[]));
  }

  if (buildings.length === 0 && territoryBoundary) {
    const { data, error } = await supabase.rpc('get_gold_buildings_in_polygon_geojson', {
      p_polygon_geojson: JSON.stringify(territoryBoundary),
    });
    if (error) {
      console.warn(`⚠️  gold polygon fallback failed: ${error.message}`);
    } else {
      buildings.push(...parseGoldBuildingRows(data));
    }
  }

  const renderableBuildings = filterRenderableGoldBuildings(buildings);
  const features = renderableBuildings
    .map((building) => {
      const geometry = parseGeometry(building.geom_geojson ?? building.geom);
      if (!isPolygonLike(geometry)) return null;
      const linkedAddresses = addressesByBuildingId.get(building.id) ?? [];
      const firstAddress = linkedAddresses[0] ?? null;
      const scansTotal = linkedAddresses.reduce((sum, address) => sum + (address.scans ?? 0), 0);
      const height = normalizeHeightMeters(building.height_m, building.floors, building.area_sqm);

      const feature: Feature = {
        type: 'Feature' as const,
        id: building.id,
        geometry,
        properties: {
          building_id: building.id,
          address_id: linkedAddresses.length === 1 ? firstAddress?.id ?? '' : '',
          gers_id: building.id,
          source: 'gold',
          height,
          height_m: height,
          floors: building.floors ?? null,
          building_type: building.building_type ?? null,
          subtype: building.subtype ?? null,
          area_sqm: building.area_sqm ?? null,
          address_count: linkedAddresses.length,
          scans_total: scansTotal,
        },
      };
      return feature;
    })
    .filter((feature): feature is Feature => feature !== null);

  return { type: 'FeatureCollection', features };
}

async function relinkDiamondBuildingFeatures(
  id: string,
  collection: FeatureCollection
): Promise<FeatureCollection> {
  const addresses = await loadCampaignAddressesForDiamond(id);
  if (addresses.length === 0) {
    console.warn('⚠️  No campaign address points found; clearing Diamond building address join IDs.');
    return clearBuildingAddressLinks(collection, 'no_address_points');
  }

  const linkableBuildings = collection.features.filter(isLinkableBuildingFeature);
  const matches = matchAddressesToBuildings(addresses, linkableBuildings);
  const matchesByBuilding = new Map<string, AddressBuildingMatch[]>();

  for (const match of matches) {
    if (!match.buildingId) continue;
    const group = matchesByBuilding.get(match.buildingId) ?? [];
    group.push(match);
    matchesByBuilding.set(match.buildingId, group);
  }

  let linkedAddressCount = 0;
  let singleAddressBuildingCount = 0;
  let multiAddressBuildingCount = 0;

  const features = collection.features.map((feature) => {
    const properties = asRecord(feature.properties);
    const id = buildingFeatureId(feature);
    const linkedMatches = id ? matchesByBuilding.get(id) ?? [] : [];
    const primaryMatch = linkedMatches[0] ?? null;
    const addressIds = linkedMatches.map((match) => match.address.id);
    const scansTotal = linkedMatches.reduce((sum, match) => sum + (match.address.scans ?? 0), 0);

    linkedAddressCount += linkedMatches.length;
    if (linkedMatches.length === 1) singleAddressBuildingCount += 1;
    if (linkedMatches.length > 1) multiAddressBuildingCount += 1;

    return {
      ...feature,
      properties: {
        ...properties,
        address_id: linkedMatches.length === 1 ? primaryMatch?.address.id ?? '' : '',
        address_ids: addressIds.join(','),
        address_count: linkedMatches.length,
        scans_total: scansTotal,
        confidence: primaryMatch?.confidence ?? null,
        link_source: linkedMatches.length > 0 ? 'diamond_spatial_linker' : null,
      },
    };
  });

  const linkedAddressIds = new Set(
    matches
      .filter((match) => match.buildingId)
      .map((match) => match.address.id)
  );
  const unmatchedAddressCount = addresses.length - linkedAddressIds.size;
  const deduped = clearDuplicateBuildingAddressIds({ type: 'FeatureCollection', features });

  console.log(
    `🔗 Diamond spatial linker: ${linkedAddressCount}/${addresses.length} address(es) linked; ` +
    `${singleAddressBuildingCount} single-address building(s), ` +
    `${multiAddressBuildingCount} multi-address building(s), ` +
    `${unmatchedAddressCount} unmatched`
  );

  return deduped;
}

async function loadCampaignAddressesForDiamond(id: string): Promise<CampaignAddressExportRow[]> {
  const rows = await fetchAllPages<CampaignAddressExportRow>((from, to) =>
    supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, locality, postal_code, source, source_id, gers_id, building_id, building_gers_id, geom, scans')
      .eq('campaign_id', id)
      .order('id', { ascending: true })
      .range(from, to)
  ).catch((error) => {
    console.warn(`⚠️  campaign_addresses spatial linker load failed: ${error instanceof Error ? error.message : String(error)}`);
    return [] as CampaignAddressExportRow[];
  });

  return rows.filter((row) => parsePoint(row.geom) !== null);
}

async function exportAddressFeatures(id: string): Promise<FeatureCollection> {
  const rows = await loadCampaignAddressesForDiamond(id);
  const features = rows
    .map((row) => {
      const point = parsePoint(row.geom);
      if (!point) return null;

      const addressId = stringValue(row.id);
      if (!addressId) return null;

      const houseNumber = stringValue(row.house_number);
      const formatted = stringValue(row.formatted) ?? '';
      const buildingId =
        stringValue(row.building_gers_id) ??
        stringValue(row.building_id) ??
        stringValue(row.gers_id) ??
        '';

      const feature: Feature = {
        type: 'Feature',
        id: addressId,
        geometry: {
          type: 'Point',
          coordinates: point,
        },
        properties: {
          id: addressId,
          address_id: addressId,
          formatted,
          house_number: houseNumber,
          house_number_label: houseNumber,
          street_name: stringValue(row.street_name) ?? '',
          locality: stringValue(row.locality) ?? '',
          postal_code: stringValue(row.postal_code) ?? '',
          source: stringValue(row.source) ?? 'campaign',
          source_id: stringValue(row.source_id) ?? '',
          gers_id: stringValue(row.gers_id) ?? buildingId,
          building_gers_id: buildingId,
          building_id: buildingId,
          scans_total: numberValue(row.scans) ?? 0,
          label_priority: houseNumber ? 10 : 100,
        },
      };
      return feature;
    })
    .filter((feature): feature is Feature => feature !== null);

  return { type: 'FeatureCollection', features };
}

function buildAddressCircleFeatures(addresses: FeatureCollection): FeatureCollection {
  const features = addresses.features
    .map((address): Feature | null => {
      if (address.geometry?.type !== 'Point' || !Array.isArray(address.geometry.coordinates)) return null;
      const point = pointFromLonLat(
        Number(address.geometry.coordinates[0]),
        Number(address.geometry.coordinates[1])
      );
      if (!point) return null;

      const circle = turf.circle(point, ADDRESS_CIRCLE_RADIUS_METERS / 1000, {
        steps: ADDRESS_CIRCLE_STEPS,
        units: 'kilometers',
      });

      return {
        type: 'Feature' as const,
        id: address.id,
        geometry: circle.geometry as Geometry,
        properties: {
          ...asRecord(address.properties),
          geometry_source: 'address_circle',
          radius_m: ADDRESS_CIRCLE_RADIUS_METERS,
        },
      };
    })
    .filter((feature): feature is Feature => feature !== null);

  return { type: 'FeatureCollection', features };
}

function matchAddressesToBuildings(
  addresses: CampaignAddressExportRow[],
  buildings: Feature[]
): AddressBuildingMatch[] {
  const buildingCentroids = new Map<string, Position>();
  for (const building of buildings) {
    const id = buildingFeatureId(building);
    if (!id || !isPolygonLike(building.geometry)) continue;
    buildingCentroids.set(
      id,
      turf.centroid(building as unknown as TurfPolygonFeature).geometry.coordinates as Position
    );
  }

  const usedNearbyBuildingIds = new Set<string>();
  const matches: AddressBuildingMatch[] = [];

  for (const address of addresses) {
    const point = parsePoint(address.geom);
    if (!point) continue;
    const pointFeature = turf.point(point);

    const containing = buildings
      .filter((building) => isPolygonLike(building.geometry))
      .filter((building) =>
        turf.booleanPointInPolygon(pointFeature, building as unknown as TurfPolygonFeature)
      )
      .sort(
        (a, b) =>
          turf.area(b as unknown as TurfPolygonFeature) -
          turf.area(a as unknown as TurfPolygonFeature)
      );

    if (containing.length > 0) {
      matches.push({
        address,
        point,
        buildingId: buildingFeatureId(containing[0]),
        confidence: 'inside',
        distanceMeters: 0,
      });
      continue;
    }

    let nearest: { building: Feature; distanceMeters: number } | null = null;
    for (const building of buildings) {
      const id = buildingFeatureId(building);
      if (!id || usedNearbyBuildingIds.has(id)) continue;
      const centroid = buildingCentroids.get(id);
      if (!centroid) continue;
      const distanceMeters = turf.distance(pointFeature, turf.point(centroid), { units: 'kilometers' }) * 1000;
      if (distanceMeters > MAX_NEARBY_BUILDING_METERS) continue;
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = { building, distanceMeters };
      }
    }

    if (nearest) {
      const id = buildingFeatureId(nearest.building);
      if (id) usedNearbyBuildingIds.add(id);
      matches.push({
        address,
        point,
        buildingId: id,
        confidence: 'nearby',
        distanceMeters: Math.round(nearest.distanceMeters * 10) / 10,
      });
    } else {
      matches.push({
        address,
        point,
        buildingId: null,
        confidence: 'unmatched',
        distanceMeters: null,
      });
    }
  }

  return matches;
}

function clearBuildingAddressLinks(collection: FeatureCollection, reason: string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...asRecord(feature.properties),
        address_id: '',
        address_ids: '',
        address_count: 0,
        confidence: null,
        link_source: reason,
      },
    })),
  };
}

function clearDuplicateBuildingAddressIds(collection: FeatureCollection): FeatureCollection {
  const ownerByAddressId = new Map<string, string>();
  const duplicateAddressIds = new Set<string>();

  for (const feature of collection.features) {
    const properties = asRecord(feature.properties);
    const addressId = stringValue(properties.address_id);
    const buildingId = buildingFeatureId(feature);
    if (!addressId || !buildingId) continue;
    const owner = ownerByAddressId.get(addressId);
    if (owner && owner !== buildingId) {
      duplicateAddressIds.add(addressId);
    } else {
      ownerByAddressId.set(addressId, buildingId);
    }
  }

  if (duplicateAddressIds.size === 0) return collection;

  let cleared = 0;
  const features = collection.features.map((feature) => {
    const properties = asRecord(feature.properties);
    const addressId = stringValue(properties.address_id);
    if (!addressId || !duplicateAddressIds.has(addressId)) return feature;
    const buildingId = buildingFeatureId(feature);
    if (buildingId && ownerByAddressId.get(addressId) === buildingId) return feature;
    cleared += 1;
    return {
      ...feature,
      properties: {
        ...properties,
        address_id: '',
        link_conflict: 'duplicate_address_id',
      },
    };
  });

  console.warn(
    `⚠️  Diamond linker cleared ${cleared} duplicate building address assignment(s) ` +
    `for ${duplicateAddressIds.size} address id(s).`
  );
  return { type: 'FeatureCollection', features };
}

function isLinkableBuildingFeature(feature: Feature): boolean {
  if (!isPolygonLike(feature.geometry)) return false;
  const properties = asRecord(feature.properties);
  const areaSqm = numberValue(properties.area_sqm) ?? numberValue(properties.area);
  const buildingType = stringValue(properties.building_type) ?? stringValue(properties.class) ?? stringValue(properties.type);
  const subtype = stringValue(properties.subtype);
  return isLinkableBuildingFootprint({
    area_sqm: areaSqm,
    building_type: buildingType,
    subtype,
  });
}

function groupAddressesByBuilding(addresses: CampaignAddressExportRow[]) {
  const groups = new Map<string, CampaignAddressExportRow[]>();
  for (const address of addresses) {
    const buildingId = stringValue(address.building_id) || stringValue(address.building_gers_id);
    if (!buildingId) continue;
    const group = groups.get(buildingId) ?? [];
    group.push(address);
    groups.set(buildingId, group);
  }
  return groups;
}

function buildingFeatureId(feature: Feature): string | null {
  const properties = asRecord(feature.properties);
  return (
    stringValue(properties.building_id) ||
    stringValue(properties.gers_id) ||
    stringValue(properties.id) ||
    stringValue(feature.id)
  );
}

function parseGoldBuildingRows(raw: unknown): GoldBuildingExportRow[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseGoldBuildingRows(item));
  }
  if (typeof raw === 'string') {
    try {
      return parseGoldBuildingRows(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (typeof raw !== 'object') return [];

  const value = raw as Record<string, unknown>;
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.flatMap((feature) => parseGoldBuildingRows(feature));
  }
  if (value.type === 'Feature') {
    const properties = asRecord(value.properties);
    const id = stringValue(properties.id) || stringValue(value.id);
    if (!id) return [];
    return [{
      id,
      area_sqm: numberValue(properties.area_sqm),
      height_m: numberValue(properties.height_m),
      floors: numberValue(properties.floors),
      building_type: stringValue(properties.building_type),
      subtype: stringValue(properties.subtype),
      geom: value.geometry,
    }];
  }

  const id = stringValue(value.id);
  return id ? [{
    id,
    area_sqm: numberValue(value.area_sqm),
    height_m: numberValue(value.height_m),
    floors: numberValue(value.floors),
    building_type: stringValue(value.building_type),
    subtype: stringValue(value.subtype),
    geom: value.geom,
    geom_geojson: stringValue(value.geom_geojson),
  }] : [];
}

function normalizeHeightMeters(
  heightMeters: number | null | undefined,
  floors: number | null | undefined,
  areaSqm: number | null | undefined
): number {
  if (typeof heightMeters === 'number' && Number.isFinite(heightMeters) && heightMeters > 0) {
    return heightMeters;
  }
  if (typeof floors === 'number' && Number.isFinite(floors) && floors > 0) {
    return Math.max(floors * 3, 3);
  }

  const area = typeof areaSqm === 'number' && Number.isFinite(areaSqm) ? areaSqm : 0;
  if (area >= 1000) return 14;
  if (area >= 450) return 12;
  if (area >= 220) return 10;
  if (area >= 90) return 8;
  return 6;
}

function isRenderableGoldBuilding(building: GoldBuildingExportRow): boolean {
  return isLinkableBuildingFootprint(building);
}

function filterRenderableGoldBuildings(buildings: GoldBuildingExportRow[]): GoldBuildingExportRow[] {
  const filtered = buildings.filter(isRenderableGoldBuilding);
  const removed = buildings.length - filtered.length;
  if (removed > 0) {
    console.log(`🧹 Filtered ${removed} shed/outbuilding footprints from Gold buildings`);
  }
  return filtered;
}

function hasCampaignAddressLink(feature: Feature): boolean {
  const properties = asRecord(feature.properties);
  const addressCount = numberValue(properties.address_count);
  const addressId = stringValue(properties.address_id);
  const addressIds = stringValue(properties.address_ids);
  return Boolean(
    (typeof addressCount === 'number' && addressCount > 0) ||
      addressId ||
      addressIds
  );
}

function filterCampaignAddressBuildings(collection: FeatureCollection): FeatureCollection {
  const linkedFeatures = collection.features.filter(hasCampaignAddressLink);
  const removed = collection.features.length - linkedFeatures.length;
  if (linkedFeatures.length === 0) {
    console.warn('⚠️  No linked building features after Diamond relink; keeping all renderable buildings.');
    return collection;
  }
  if (removed > 0) {
    console.log(`🧹 Filtered ${removed} unlinked shed/accessory territory building(s) from Diamond PMTiles`);
  }
  return { type: 'FeatureCollection', features: linkedFeatures };
}

async function exportBuildingFeaturesFromSnapshot(snapshot: ExistingSnapshot | null): Promise<FeatureCollection> {
  const key = snapshot?.buildings_key;
  const snapshotBucket = snapshot?.bucket || bucket;
  if (!key) {
    throw new Error('No RPC building features and no existing buildings_key snapshot to fall back to.');
  }

  const response = await s3.send(new GetObjectCommand({
    Bucket: snapshotBucket,
    Key: key,
  }));
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error(`Empty S3 response for s3://${snapshotBucket}/${key}`);
  }

  const buffer = Buffer.from(bytes);
  const text = key.endsWith('.gz') || response.ContentEncoding === 'gzip'
    ? gunzipSync(buffer).toString('utf8')
    : buffer.toString('utf8');
  const collection = normalizeFeatureCollection(JSON.parse(text));
  const features = collection.features
    .filter((feature) => isPolygonLike(feature.geometry))
    .map(thinBuildingFeature)
    .filter((feature): feature is Feature => Boolean(feature));

  return { type: 'FeatureCollection', features };
}

async function exportParcelFeatures(id: string): Promise<FeatureCollection> {
  const rows = await fetchAllPages((from, to) =>
    supabase
      .from('campaign_parcels')
      .select('id, external_id, geom, properties')
      .eq('campaign_id', id)
      .range(from, to)
  );

  const features = rows
    .map((row) => {
      const source = row as Record<string, unknown>;
      const geometry = parseGeometry(source.geom);
      if (!isPolygonLike(geometry)) return null;
      const properties = asRecord(source.properties);
      const parcelId = stringValue(source.external_id) || stringValue(properties.parcel_id) || stringValue(source.id);
      if (!parcelId) return null;

      const feature: Feature = {
        type: 'Feature' as const,
        geometry,
        properties: {
          parcel_id: parcelId,
          source: 'campaign_parcels',
        },
      };
      return feature;
    })
    .filter((feature): feature is Feature => feature !== null);

  return { type: 'FeatureCollection', features };
}

function thinBuildingFeature(feature: Feature): Feature | null {
  const properties = asRecord(feature.properties);
  const buildingId =
    stringValue(properties.building_id) ||
    stringValue(properties.gers_id) ||
    stringValue(properties.id) ||
    stringValue(feature.id);

  if (!buildingId || !feature.geometry) return null;

  const addressId = stringValue(properties.address_id);
  const gersId = stringValue(properties.gers_id) || buildingId;
  const source = stringValue(properties.source) || 'campaign';
  const areaSqm = numberValue(properties.area_sqm) ?? numberValue(properties.area);
  const buildingType = stringValue(properties.building_type);
  const subtype = stringValue(properties.subtype);

  if (!isRenderableGoldBuilding({
    id: buildingId,
    area_sqm: areaSqm,
    building_type: buildingType,
    subtype,
  })) {
    return null;
  }

  const height = normalizeHeightMeters(
    numberValue(properties.height_m) ?? numberValue(properties.height),
    numberValue(properties.floors),
    areaSqm
  );

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      building_id: buildingId,
      address_id: addressId,
      gers_id: gersId,
      source,
      height,
      height_m: height,
      floors: numberValue(properties.floors),
      area_sqm: areaSqm,
      building_type: stringValue(properties.building_type),
      subtype: stringValue(properties.subtype),
      address_count: numberValue(properties.address_count),
    },
  };
}

async function fetchAllPages<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
) {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function runTippecanoe(options: {
  buildingsPath: string;
  addressesPath: string;
  addressCirclesPath: string;
  parcelsPath: string | null;
  outputPath: string;
  minzoom: number;
  maxzoom: number;
}) {
  const tippecanoe = process.env.TIPPECANOE_BIN || 'tippecanoe';
  const tippecanoeTempDir = process.env.TIPPECANOE_TEMP_DIR || process.env.TMPDIR;
  const commandArgs = [
    '--force',
    '--output',
    options.outputPath,
    '--minimum-zoom',
    String(options.minzoom),
    '--maximum-zoom',
    String(options.maxzoom),
    // Keep extruded building footprints from being clipped at tile edges.
    '--buffer',
    String(BUILDING_TILE_BUFFER_UNITS),
    '--no-clipping',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `buildings:${options.buildingsPath}`,
    '--named-layer',
    `addresses:${options.addressesPath}`,
    '--named-layer',
    `address_circles:${options.addressCirclesPath}`,
  ];

  if (tippecanoeTempDir) {
    commandArgs.splice(1, 0, '--temporary-directory', tippecanoeTempDir);
  }

  if (options.parcelsPath && existsSync(options.parcelsPath)) {
    commandArgs.push('--named-layer', `parcels:${options.parcelsPath}`);
  }

  console.log(`🛠️  ${tippecanoe} ${commandArgs.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(tippecanoe, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited with code ${code}`));
    });
  });
}

function buildTileJSON(options: {
  campaignId: string;
  bounds: [number, number, number, number] | null;
  minzoom: number;
  maxzoom: number;
  pmtilesKey: string;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  hasParcels: boolean;
}) {
  return {
    tilejson: '3.0.0',
    name: `FLYR Diamond ${options.campaignId}`,
    scheme: 'xyz',
    tiles: [
      `${apiBaseUrl}/api/campaigns/${options.campaignId}/diamond-tiles/buildings/{z}/{x}/{y}.mvt`,
    ],
    vector_layers: [
      {
        id: 'buildings',
        fields: {
          building_id: 'String',
          address_id: 'String',
          address_ids: 'String',
          gers_id: 'String',
          source: 'String',
          height: 'Number',
          building_type: 'String',
          address_count: 'Number',
          scans_total: 'Number',
          confidence: 'String',
          link_source: 'String',
        },
      },
      {
        id: 'addresses',
        fields: {
          id: 'String',
          address_id: 'String',
          formatted: 'String',
          house_number: 'String',
          house_number_label: 'String',
          street_name: 'String',
          locality: 'String',
          postal_code: 'String',
          source: 'String',
          source_id: 'String',
          gers_id: 'String',
          building_gers_id: 'String',
          building_id: 'String',
          scans_total: 'Number',
          label_priority: 'Number',
        },
      },
      {
        id: 'address_circles',
        fields: {
          id: 'String',
          address_id: 'String',
          formatted: 'String',
          house_number: 'String',
          house_number_label: 'String',
          street_name: 'String',
          locality: 'String',
          postal_code: 'String',
          source: 'String',
          source_id: 'String',
          gers_id: 'String',
          building_gers_id: 'String',
          building_id: 'String',
          scans_total: 'Number',
          label_priority: 'Number',
          geometry_source: 'String',
          radius_m: 'Number',
        },
      },
      ...(options.hasParcels
        ? [{
            id: 'parcels',
            fields: {
              parcel_id: 'String',
              source: 'String',
            },
          }]
        : []),
    ],
    bounds: options.bounds ?? undefined,
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    attribution: 'FLYR',
    metadata: {
      pmtiles_key: options.pmtilesKey,
      pmtiles_size_bytes: options.pmtilesSizeBytes,
      pmtiles_sha256: options.pmtilesSha256,
    },
  };
}

async function uploadArtifact(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  contentEncoding?: string
) {
  console.log(`☁️  Uploading s3://${bucket}/${key}`);
  const result = await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentEncoding: contentEncoding,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return result.ETag?.replace(/^"|"$/g, '') ?? null;
}

async function upsertCampaignSnapshot(options: {
  campaignId: string;
  snapshot: ExistingSnapshot | null;
  bucket: string;
  prefix: string;
  pmtilesKey: string;
  tilejsonKey: string;
  geojsonKey: string;
  buildingsCount: number;
  addressesCount: number;
  parcelsCount: number;
  geometryVersion: number;
  pmtilesEtag: string | null;
  pmtilesSha256: string;
  bounds: [number, number, number, number] | null;
  minzoom: number;
  maxzoom: number;
  pmtilesSizeBytes: number;
}) {
  const existingMetrics = options.snapshot?.tile_metrics ?? {};
  const existingBuildingsKey = options.snapshot?.buildings_key ?? null;
  const fallbackGeojsonKey =
    typeof existingMetrics.geojson_key === 'string'
      ? existingMetrics.geojson_key
      : existingBuildingsKey && !existingBuildingsKey.endsWith('.pmtiles')
        ? existingBuildingsKey
        : options.geojsonKey;

  const tileMetrics = {
    ...existingMetrics,
    artifact_type: 'diamond',
    map_status: 'ready',
    diamond_mode: true,
    geometry_provider: 'pmtiles_zxy',
    building_bounds_buffer_meters: BUILDING_BOUNDS_BUFFER_METERS,
    tile_buffer: BUILDING_TILE_BUFFER_UNITS,
    geometry_version: options.geometryVersion,
    pmtiles_key: options.pmtilesKey,
    pmtiles_version: options.geometryVersion,
    pmtiles_etag: options.pmtilesEtag,
    pmtiles_sha256: options.pmtilesSha256,
    pmtiles_size_bytes: options.pmtilesSizeBytes,
    geometry_stage: geometryStage,
    geometry_stage_prefix: geometryStagePrefix,
    geometry_build_status: 'ready',
    stale_geometry: false,
    geometry_build_completed_at: new Date().toISOString(),
    tilejson_key: options.tilejsonKey,
    geojson_key: fallbackGeojsonKey,
    source_layers: {
      buildings: 'buildings',
      addresses: 'addresses',
      address_circles: 'address_circles',
      parcels: 'parcels',
    },
    promote_ids: {
      buildings: 'address_id',
      addresses: 'address_id',
      address_circles: 'address_id',
      parcels: 'parcel_id',
    },
    join_key: 'address_id',
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    bounds: options.bounds,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('campaign_snapshots')
    .upsert(
      {
        campaign_id: options.campaignId,
        bucket: options.bucket,
        prefix: options.prefix,
        buildings_key: options.pmtilesKey,
        metadata_key: options.tilejsonKey,
        buildings_count: options.buildingsCount,
        addresses_count: options.addressesCount,
        roads_count: options.snapshot?.roads_count ?? null,
        tile_metrics: tileMetrics,
        created_at: new Date().toISOString(),
        expires_at: null,
      },
      { onConflict: 'campaign_id' }
    );

  if (error) {
    throw new Error(`Failed to upsert campaign_snapshots: ${error.message}`);
  }
}

function normalizeFeatureCollection(value: unknown): FeatureCollection {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object') return { type: 'FeatureCollection', features: [] };
  const collection = parsed as Partial<FeatureCollection>;
  return {
    type: 'FeatureCollection',
    features: Array.isArray(collection.features) ? collection.features : [],
  };
}

function parseGeometry(value: unknown): Geometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Geometry;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as Geometry;
  return null;
}

function parsePoint(value: unknown): Position | null {
  const geometry = parseGeometry(value);
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return pointFromLonLat(Number(geometry.coordinates[0]), Number(geometry.coordinates[1]));
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const wktMatch = trimmed.match(/(?:SRID=\d+;)?POINT\s*\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
  if (wktMatch) {
    return pointFromLonLat(Number(wktMatch[1]), Number(wktMatch[2]));
  }

  return pointFromWkbHex(trimmed);
}

function pointFromLonLat(lon: number, lat: number): Position | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

function pointFromWkbHex(value: string): Position | null {
  const hex = value.replace(/^\\x/i, '');
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 42) return null;

  try {
    const buffer = Buffer.from(hex, 'hex');
    const littleEndian = buffer.readUInt8(0) === 1;
    const readUInt32 = (offset: number) =>
      littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    const readDouble = (offset: number) =>
      littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);

    const rawType = readUInt32(1);
    const hasSrid = (rawType & 0x20000000) !== 0;
    const geometryType = rawType & 0xff;
    if (geometryType !== 1) return null;

    const coordinateOffset = 5 + (hasSrid ? 4 : 0);
    if (buffer.length < coordinateOffset + 16) return null;
    return pointFromLonLat(readDouble(coordinateOffset), readDouble(coordinateOffset + 8));
  } catch {
    return null;
  }
}

function isPolygonLike(geometry: Geometry | null | undefined) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nextGeometryVersion(snapshot: ExistingSnapshot | null) {
  const current =
    numberValue(snapshot?.tile_metrics?.geometry_version) ??
    numberValue(snapshot?.tile_metrics?.pmtiles_version) ??
    0;
  return current + 1;
}

function normalizeBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const bounds = value.slice(0, 4).map(Number);
  return bounds.every(Number.isFinite) ? bounds as [number, number, number, number] : null;
}

function calculateBounds(features: Feature[]): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    visitPositions(feature.geometry?.coordinates, (position) => {
      const [lon, lat] = position;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
  }

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function visitPositions(value: unknown, visitor: (position: Position) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor([value[0], value[1]]);
    return;
  }
  for (const child of value) {
    visitPositions(child, visitor);
  }
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
