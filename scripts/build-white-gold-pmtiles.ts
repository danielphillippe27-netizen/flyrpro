#!/usr/bin/env tsx
/**
 * Build the White Gold fallback geometry artifact for a campaign.
 *
 * White Gold intentionally stores static geometry + stable join IDs only.
 * Live campaign state stays in Supabase/SQLite and is applied by feature-state.
 *
 * Usage:
 *   npx tsx scripts/build-white-gold-pmtiles.ts <campaign-id>
 *   npx tsx scripts/build-white-gold-pmtiles.ts <campaign-id> --dry-run --keep-workdir
 *   npx tsx scripts/build-white-gold-pmtiles.ts --all-silver
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as turf from '@turf/turf';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Bounds = [number, number, number, number];
type PointGeometry = GeoJSON.Point;
type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type AnyGeometry = GeoJSON.Geometry;
type Properties = Record<string, unknown>;
type BuildingFeature = GeoJSON.Feature<PolygonGeometry, Properties>;
type AddressFeature = GeoJSON.Feature<PointGeometry, Properties>;
type LinkFeature = GeoJSON.Feature<GeoJSON.LineString, Properties>;

type CampaignContext = {
  id: string;
  bbox?: unknown;
  territory_boundary?: unknown;
  provision_source?: string | null;
};

type ExistingSnapshot = {
  bucket?: string | null;
  prefix?: string | null;
  buildings_key?: string | null;
  addresses_key?: string | null;
  roads_key?: string | null;
  metadata_key?: string | null;
  buildings_count?: number | null;
  addresses_count?: number | null;
  roads_count?: number | null;
  tile_metrics?: Record<string, unknown> | null;
};

type CampaignAddressRow = {
  id: string;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  locality: string | null;
  postal_code: string | null;
  source: string | null;
  source_id: string | null;
  gers_id: string | null;
  building_id?: string | null;
  building_gers_id?: string | null;
  geom: unknown;
};

type MatchConfidence = 'inside' | 'nearby' | 'unmatched';

type AddressMatch = {
  address: CampaignAddressRow;
  point: [number, number];
  buildingId: string | null;
  confidence: MatchConfidence;
  distanceMeters: number | null;
};

const NON_LINKABLE_BUILDING_TYPES = new Set([
  'shed',
  'garage',
  'garages',
  'carport',
  'parking',
  'parking_garage',
  'outbuilding',
  'accessory',
  'ancillary',
]);

const args = process.argv.slice(2);
const campaignId = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const keepWorkdir = args.includes('--keep-workdir');
const allSilver = args.includes('--all-silver');
const includeLambda = !args.includes('--silver-only');
const forceOverwriteDiamond = args.includes('--force-overwrite-diamond');
const MIN_LINKABLE_BUILDING_AREA_SQM = Number(readFlag('min-building-area-sqm') ?? '30');
const MAX_NEARBY_BUILDING_METERS = Number(readFlag('max-nearby-meters') ?? '55');
const DEFAULT_MINZOOM = Number(readFlag('minzoom') ?? '13');
const DEFAULT_MAXZOOM = Number(readFlag('maxzoom') ?? '18');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket =
  process.env.WHITE_GOLD_GEOMETRY_BUCKET ||
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
const overtureCli = process.env.OVERTUREMAPS_BIN || 'uvx overturemaps';

if (!campaignId && !allSilver) {
  console.error('Usage: npx tsx scripts/build-white-gold-pmtiles.ts <campaign-id> [--dry-run] [--keep-workdir]');
  console.error('   or: npx tsx scripts/build-white-gold-pmtiles.ts --all-silver [--dry-run]');
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
      }
    : undefined,
});

main().catch((error) => {
  console.error('❌ White Gold PMTiles build failed:', error);
  process.exit(1);
});

async function main() {
  if (allSilver) {
    const ids = await loadSilverCampaignIds();
    console.log(`⚪️🟡 Converting ${ids.length} Silver campaign(s) into White Gold artifacts`);
    for (const id of ids) {
      await buildWhiteGoldForCampaign(id);
    }
    return;
  }

  await buildWhiteGoldForCampaign(campaignId!);
}

async function buildWhiteGoldForCampaign(id: string) {
  const workdir = await mkdtemp(path.join(tmpdir(), `flyr-white-gold-${id}-`));
  console.log(`⚪️🟡 Building White Gold PMTiles artifact for campaign ${id}`);
  console.log(`   Workdir: ${workdir}`);

  try {
    const { campaign, snapshot } = await loadCampaignContext(id);
    if (isDiamondSnapshot(snapshot) && !forceOverwriteDiamond) {
      console.log('💎 Existing Diamond artifact detected; skipping White Gold overwrite.');
      return;
    }

    const addresses = await loadCampaignAddresses(id);
    if (addresses.length === 0) {
      throw new Error('No campaign addresses found. White Gold needs address points for join IDs.');
    }

    const bounds =
      normalizeBounds(campaign.bbox) ??
      calculateGeometryBounds(campaign.territory_boundary) ??
      calculateAddressBounds(addresses);
    if (!bounds) {
      throw new Error('Unable to resolve campaign bounds for Overture CLI download.');
    }

    const rawBuildingsPath = path.join(workdir, 'overture-buildings.raw.geojson');
    await downloadOvertureBuildings(bounds, rawBuildingsPath);

    const rawBuildings = normalizeFeatureCollection(JSON.parse(await readFile(rawBuildingsPath, 'utf8')));
    const campaignPolygon = parsePolygon(campaign.territory_boundary);
    const buildings = normalizeOvertureBuildings(rawBuildings, campaignPolygon);
    if (buildings.length === 0) {
      throw new Error('No Overture building polygons were found for this campaign.');
    }

    const matches = matchAddressesToBuildings(addresses, buildings);
    const { buildingFeatures, addressFeatures, linkFeatures } = buildWhiteGoldLayers(buildings, matches);
    const version = nextGeometryVersion(snapshot);
    const prefix = `campaigns/${id}/white-gold/v${version}`;
    const pmtilesKey = `${prefix}/map.pmtiles`;
    const tilejsonKey = `${prefix}/map.json`;
    const buildingsGeojsonKey = `${prefix}/buildings.geojson.gz`;
    const addressesGeojsonKey = `${prefix}/addresses.geojson.gz`;
    const linksGeojsonKey = `${prefix}/address-building-links.geojson.gz`;
    const manifestKey = `${prefix}/white-gold-manifest.json`;

    const buildingsPath = path.join(workdir, 'buildings.geojson');
    const addressesPath = path.join(workdir, 'addresses.geojson');
    const linksPath = path.join(workdir, 'address-building-links.geojson');
    const pmtilesPath = path.join(workdir, 'map.pmtiles');
    const tilejsonPath = path.join(workdir, 'map.json');
    const manifestPath = path.join(workdir, 'white-gold-manifest.json');

    const buildingsCollection = featureCollection(buildingFeatures);
    const addressesCollection = featureCollection(addressFeatures);
    const linksCollection = featureCollection(linkFeatures);
    await writeFile(buildingsPath, JSON.stringify(buildingsCollection));
    await writeFile(addressesPath, JSON.stringify(addressesCollection));
    await writeFile(linksPath, JSON.stringify(linksCollection));

    await runTippecanoe({
      buildingsPath,
      addressesPath,
      linksPath: linkFeatures.length > 0 ? linksPath : null,
      outputPath: pmtilesPath,
      minzoom: DEFAULT_MINZOOM,
      maxzoom: DEFAULT_MAXZOOM,
    });

    const pmtilesBytes = await readFile(pmtilesPath);
    const pmtilesHash = sha256(pmtilesBytes);
    const pmtilesSize = await stat(pmtilesPath);
    const tilejson = buildTileJSON({
      campaignId: id,
      bounds,
      minzoom: DEFAULT_MINZOOM,
      maxzoom: DEFAULT_MAXZOOM,
      pmtilesKey,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256: pmtilesHash,
    });
    const manifest = buildManifest({
      campaignId: id,
      bounds,
      version,
      pmtilesKey,
      tilejsonKey,
      buildingsGeojsonKey,
      addressesGeojsonKey,
      linksGeojsonKey,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256: pmtilesHash,
      buildingsCount: buildingFeatures.length,
      addressesCount: addressFeatures.length,
      linkedAddressCount: matches.filter((match) => match.buildingId).length,
    });
    await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const linkedAddressCount = matches.filter((match) => match.buildingId).length;
    console.log(`✅ Exported ${buildingFeatures.length} Overture building feature(s)`);
    console.log(`✅ Exported ${addressFeatures.length} Netsyms address feature(s)`);
    console.log(`✅ Linked ${linkedAddressCount}/${addressFeatures.length} address(es)`);
    console.log(`✅ Wrote PMTiles (${(pmtilesSize.size / 1024 / 1024).toFixed(2)} MB)`);

    if (dryRun) {
      console.log('🧪 Dry run: skipping S3 upload and campaign_snapshots update.');
      return;
    }

    const pmtilesEtag = await uploadArtifact(pmtilesKey, pmtilesBytes, 'application/vnd.pmtiles');
    await uploadArtifact(tilejsonKey, await readFile(tilejsonPath), 'application/json; charset=utf-8');
    await uploadArtifact(manifestKey, await readFile(manifestPath), 'application/json; charset=utf-8');
    await uploadArtifact(buildingsGeojsonKey, gzipSync(JSON.stringify(buildingsCollection)), 'application/geo+json', 'gzip');
    await uploadArtifact(addressesGeojsonKey, gzipSync(JSON.stringify(addressesCollection)), 'application/geo+json', 'gzip');
    await uploadArtifact(linksGeojsonKey, gzipSync(JSON.stringify(linksCollection)), 'application/geo+json', 'gzip');

    const latest = await loadExistingSnapshot(id);
    if (isDiamondSnapshot(latest) && !forceOverwriteDiamond) {
      console.log('💎 Diamond artifact appeared during build; uploaded White Gold assets but left manifest on Diamond.');
      return;
    }

    await upsertCampaignSnapshot({
      campaignId: id,
      snapshot: latest ?? snapshot,
      prefix,
      pmtilesKey,
      tilejsonKey,
      buildingsGeojsonKey,
      addressesGeojsonKey,
      linksGeojsonKey,
      manifestKey,
      buildingsCount: buildingFeatures.length,
      addressesCount: addressFeatures.length,
      linkedAddressCount,
      geometryVersion: version,
      pmtilesEtag,
      pmtilesSha256: pmtilesHash,
      bounds,
      minzoom: DEFAULT_MINZOOM,
      maxzoom: DEFAULT_MAXZOOM,
      pmtilesSizeBytes: pmtilesSize.size,
    });

    console.log('🚀 White Gold artifact is live.');
    console.log(`   PMTiles: s3://${bucket}/${pmtilesKey}`);
    console.log(`   Manifest: s3://${bucket}/${manifestKey}`);
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

async function loadSilverCampaignIds(): Promise<string[]> {
  const sources = includeLambda ? ['silver', 'lambda'] : ['silver'];
  const rows = await fetchAllPages<{ id: string }>((from, to) =>
    supabase
      .from('campaigns')
      .select('id')
      .in('provision_source', sources)
      .order('created_at', { ascending: true })
      .range(from, to)
  );
  return rows.map((row) => row.id);
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

  const snapshot = await loadExistingSnapshot(id);
  return { campaign: campaign as CampaignContext, snapshot };
}

async function loadExistingSnapshot(id: string): Promise<ExistingSnapshot | null> {
  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, addresses_key, roads_key, metadata_key, buildings_count, addresses_count, roads_count, tile_metrics')
    .eq('campaign_id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load existing campaign snapshot: ${error.message}`);
  }
  return data as ExistingSnapshot | null;
}

async function loadCampaignAddresses(id: string): Promise<CampaignAddressRow[]> {
  const rows = await fetchAllPages<CampaignAddressRow>((from, to) =>
    supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, locality, postal_code, source, source_id, gers_id, building_id, building_gers_id, geom')
      .eq('campaign_id', id)
      .order('id', { ascending: true })
      .range(from, to)
  );

  return rows.filter((row) => parsePoint(row.geom) !== null);
}

async function downloadOvertureBuildings(bounds: Bounds, outputPath: string) {
  const bbox = bounds.join(',');
  const commandArgs = [
    'download',
    `--bbox=${bbox}`,
    '-f',
    'geojson',
    '--type=building',
    '-o',
    outputPath,
  ];

  const cliParts = splitCommand(overtureCli);
  const executable = cliParts[0];
  const fullArgs = [...cliParts.slice(1), ...commandArgs];

  console.log(`🛠️  ${executable} ${fullArgs.join(' ')}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, fullArgs, { stdio: 'inherit' });
    child.on('error', (error) => {
      reject(
        new Error(
          `Failed to run Overture CLI (${overtureCli}). Install overturemaps or set OVERTUREMAPS_BIN. ${error.message}`
        )
      );
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`overturemaps exited with code ${code}`));
    });
  });
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function normalizeOvertureBuildings(
  collection: GeoJSON.FeatureCollection,
  campaignPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): BuildingFeature[] {
  const buildings: BuildingFeature[] = [];
  const seen = new Set<string>();

  for (const feature of collection.features) {
    if (!isPolygonLike(feature.geometry)) continue;
    const building = feature as BuildingFeature;
    if (campaignPolygon && !turf.booleanIntersects(building, turf.feature(campaignPolygon))) continue;

    const properties = asRecord(building.properties);
    const id =
      stringValue(feature.id) ||
      stringValue(properties.id) ||
      stringValue(properties.gers_id) ||
      stringValue(properties.source_id) ||
      `overture:${sha1(JSON.stringify(building.geometry))}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const areaSqm = turf.area(building);
    const buildingType =
      stringValue(properties.building_type) ||
      stringValue(properties.subtype) ||
      stringValue(properties.class) ||
      stringValue(properties.type);
    if (!isLinkableBuilding(areaSqm, buildingType)) continue;

    buildings.push({
      type: 'Feature',
      id,
      geometry: building.geometry,
      properties: {
        building_id: id,
        gers_id: id,
        source: 'overture',
        area_sqm: Math.round(areaSqm * 10) / 10,
        height: normalizeHeight(properties, areaSqm),
        height_m: normalizeHeight(properties, areaSqm),
        floors: numberValue(properties.num_floors) ?? numberValue(properties.floors),
        building_type: buildingType,
        subtype: stringValue(properties.subtype),
      },
    });
  }

  return buildings;
}

function matchAddressesToBuildings(
  addresses: CampaignAddressRow[],
  buildings: BuildingFeature[]
): AddressMatch[] {
  const buildingCentroids = new Map<string, [number, number]>();
  for (const building of buildings) {
    buildingCentroids.set(buildingId(building), turf.centroid(building).geometry.coordinates as [number, number]);
  }

  const usedNearbyBuildingIds = new Set<string>();
  const matches: AddressMatch[] = [];

  for (const address of addresses) {
    const point = parsePoint(address.geom);
    if (!point) continue;
    const pointFeature = turf.point(point);

    const containing = buildings
      .filter((building) => turf.booleanPointInPolygon(pointFeature, building))
      .sort((a, b) => turf.area(b) - turf.area(a));

    if (containing.length > 0) {
      matches.push({
        address,
        point,
        buildingId: buildingId(containing[0]),
        confidence: 'inside',
        distanceMeters: 0,
      });
      continue;
    }

    let nearest: { building: BuildingFeature; distanceMeters: number } | null = null;
    for (const building of buildings) {
      const id = buildingId(building);
      if (usedNearbyBuildingIds.has(id)) continue;
      const centroid = buildingCentroids.get(id);
      if (!centroid) continue;
      const distanceMeters = turf.distance(pointFeature, turf.point(centroid), { units: 'kilometers' }) * 1000;
      if (distanceMeters > MAX_NEARBY_BUILDING_METERS) continue;
      if (!nearest || distanceMeters < nearest.distanceMeters) {
        nearest = { building, distanceMeters };
      }
    }

    if (nearest) {
      const id = buildingId(nearest.building);
      usedNearbyBuildingIds.add(id);
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

function buildWhiteGoldLayers(buildings: BuildingFeature[], matches: AddressMatch[]) {
  const matchesByBuilding = new Map<string, AddressMatch[]>();
  for (const match of matches) {
    if (!match.buildingId) continue;
    const group = matchesByBuilding.get(match.buildingId) ?? [];
    group.push(match);
    matchesByBuilding.set(match.buildingId, group);
  }

  const buildingFeatures = buildings.map((building) => {
    const id = buildingId(building);
    const linkedMatches = matchesByBuilding.get(id) ?? [];
    const primaryMatch = linkedMatches[0] ?? null;
    return {
      ...building,
      properties: {
        ...building.properties,
        address_id: linkedMatches.length === 1 ? primaryMatch?.address.id ?? '' : '',
        address_ids: linkedMatches.map((match) => match.address.id).join(','),
        address_count: linkedMatches.length,
        confidence: primaryMatch?.confidence ?? null,
      },
    };
  });

  const addressFeatures: AddressFeature[] = matches.map((match) => ({
    type: 'Feature',
    id: match.address.id,
    geometry: {
      type: 'Point',
      coordinates: match.point,
    },
    properties: {
      address_id: match.address.id,
      building_id: match.buildingId,
      confidence: match.confidence,
      distance_m: match.distanceMeters,
      source: 'netsyms',
      original_source: match.address.source,
      source_id: match.address.source_id ?? match.address.gers_id,
      formatted: match.address.formatted,
      house_number: match.address.house_number,
      street_name: match.address.street_name,
      locality: match.address.locality,
      postal_code: match.address.postal_code,
    },
  }));

  const buildingsById = new Map(buildings.map((building) => [buildingId(building), building]));
  const linkFeatures: LinkFeature[] = matches.flatMap((match) => {
    if (!match.buildingId) return [];
    const building = buildingsById.get(match.buildingId);
    if (!building) return [];
    const centroid = turf.centroid(building).geometry.coordinates as [number, number];
    return [{
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [match.point, centroid],
      },
      properties: {
        address_id: match.address.id,
        building_id: match.buildingId,
        confidence: match.confidence,
        distance_m: match.distanceMeters,
        source: 'white_gold_linker',
      },
    }];
  });

  return { buildingFeatures, addressFeatures, linkFeatures };
}

async function runTippecanoe(options: {
  buildingsPath: string;
  addressesPath: string;
  linksPath: string | null;
  outputPath: string;
  minzoom: number;
  maxzoom: number;
}) {
  const tippecanoe = process.env.TIPPECANOE_BIN || 'tippecanoe';
  const commandArgs = [
    '--force',
    '--output',
    options.outputPath,
    '--minimum-zoom',
    String(options.minzoom),
    '--maximum-zoom',
    String(options.maxzoom),
    '--buffer',
    '8',
    '--no-clipping',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `buildings:${options.buildingsPath}`,
    '--named-layer',
    `addresses:${options.addressesPath}`,
  ];

  if (options.linksPath && existsSync(options.linksPath)) {
    commandArgs.push('--named-layer', `address_building_links:${options.linksPath}`);
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
  bounds: Bounds;
  minzoom: number;
  maxzoom: number;
  pmtilesKey: string;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
}) {
  return {
    tilejson: '3.0.0',
    name: `FLYR White Gold ${options.campaignId}`,
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
          confidence: 'String',
          source: 'String',
          height: 'Number',
          area_sqm: 'Number',
          address_count: 'Number',
        },
      },
      {
        id: 'addresses',
        fields: {
          address_id: 'String',
          building_id: 'String',
          confidence: 'String',
          source: 'String',
        },
      },
      {
        id: 'address_building_links',
        fields: {
          address_id: 'String',
          building_id: 'String',
          confidence: 'String',
          distance_m: 'Number',
        },
      },
    ],
    bounds: options.bounds,
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    attribution: 'FLYR, Overture Maps, Netsyms',
    metadata: {
      artifact_type: 'white_gold',
      pmtiles_key: options.pmtilesKey,
      pmtiles_size_bytes: options.pmtilesSizeBytes,
      pmtiles_sha256: options.pmtilesSha256,
    },
  };
}

function buildManifest(options: {
  campaignId: string;
  bounds: Bounds;
  version: number;
  pmtilesKey: string;
  tilejsonKey: string;
  buildingsGeojsonKey: string;
  addressesGeojsonKey: string;
  linksGeojsonKey: string;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  buildingsCount: number;
  addressesCount: number;
  linkedAddressCount: number;
}) {
  return {
    campaign_id: options.campaignId,
    map_status: 'ready',
    artifact_type: 'white_gold',
    geometry_provider: 'pmtiles_zxy',
    pmtiles_url: `s3://${bucket}/${options.pmtilesKey}`,
    version: options.version,
    join_key: 'address_id',
    sources: {
      buildings: 'overture',
      addresses: 'netsyms',
    },
    layers: {
      buildings: 'buildings',
      addresses: 'addresses',
      address_building_links: 'address_building_links',
    },
    bbox: options.bounds,
    created_at: new Date().toISOString(),
    state_source: 'supabase',
    state_cursor: null,
    s3: {
      bucket,
      pmtiles_key: options.pmtilesKey,
      tilejson_key: options.tilejsonKey,
      buildings_geojson_key: options.buildingsGeojsonKey,
      addresses_geojson_key: options.addressesGeojsonKey,
      links_geojson_key: options.linksGeojsonKey,
    },
    counts: {
      buildings: options.buildingsCount,
      addresses: options.addressesCount,
      linked_addresses: options.linkedAddressCount,
    },
    checksums: {
      pmtiles_sha256: options.pmtilesSha256,
      pmtiles_size_bytes: options.pmtilesSizeBytes,
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
  prefix: string;
  pmtilesKey: string;
  tilejsonKey: string;
  buildingsGeojsonKey: string;
  addressesGeojsonKey: string;
  linksGeojsonKey: string;
  manifestKey: string;
  buildingsCount: number;
  addressesCount: number;
  linkedAddressCount: number;
  geometryVersion: number;
  pmtilesEtag: string | null;
  pmtilesSha256: string;
  bounds: Bounds;
  minzoom: number;
  maxzoom: number;
  pmtilesSizeBytes: number;
}) {
  const existingMetrics = options.snapshot?.tile_metrics ?? {};
  const tileMetrics = {
    ...existingMetrics,
    artifact_type: 'white_gold',
    map_status: 'ready',
    geometry_provider: 'pmtiles_zxy',
    geometry_version: options.geometryVersion,
    pmtiles_key: options.pmtilesKey,
    pmtiles_version: options.geometryVersion,
    pmtiles_etag: options.pmtilesEtag,
    pmtiles_sha256: options.pmtilesSha256,
    pmtiles_size_bytes: options.pmtilesSizeBytes,
    tilejson_key: options.tilejsonKey,
    manifest_key: options.manifestKey,
    buildings_geojson_key: options.buildingsGeojsonKey,
    addresses_geojson_key: options.addressesGeojsonKey,
    address_building_links_geojson_key: options.linksGeojsonKey,
    source_layers: {
      buildings: 'buildings',
      addresses: 'addresses',
      address_building_links: 'address_building_links',
    },
    promote_ids: {
      buildings: 'building_id',
      addresses: 'address_id',
      address_building_links: 'address_id',
    },
    join_key: 'address_id',
    sources: {
      buildings: 'overture',
      addresses: 'netsyms',
    },
    minzoom: options.minzoom,
    maxzoom: options.maxzoom,
    bounds: options.bounds,
    linked_address_count: options.linkedAddressCount,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('campaign_snapshots')
    .upsert(
      {
        campaign_id: options.campaignId,
        bucket,
        prefix: options.prefix,
        buildings_key: options.pmtilesKey,
        addresses_key: options.addressesGeojsonKey,
        roads_key: options.snapshot?.roads_key ?? null,
        metadata_key: options.tilejsonKey,
        buildings_url: null,
        addresses_url: null,
        metadata_url: null,
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

function isDiamondSnapshot(snapshot: ExistingSnapshot | null) {
  const metrics = snapshot?.tile_metrics;
  return (
    metrics?.artifact_type === 'diamond' ||
    metrics?.diamond_mode === true ||
    (typeof metrics?.geometry_provider === 'string' &&
      metrics.geometry_provider.includes('pmtiles') &&
      typeof snapshot?.buildings_key === 'string' &&
      !snapshot.buildings_key.includes('/white-gold/'))
  );
}

function featureCollection<T extends GeoJSON.Geometry>(
  features: Array<GeoJSON.Feature<T, Properties>>
): GeoJSON.FeatureCollection<T, Properties> {
  return { type: 'FeatureCollection', features };
}

function normalizeFeatureCollection(value: unknown): GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') {
    return { type: 'FeatureCollection', features: [] };
  }
  if (Array.isArray(value)) {
    return { type: 'FeatureCollection', features: value as GeoJSON.Feature[] };
  }
  const collection = value as Partial<GeoJSON.FeatureCollection>;
  return {
    type: 'FeatureCollection',
    features: Array.isArray(collection.features) ? collection.features : [],
  };
}

function parsePoint(value: unknown): [number, number] | null {
  const geometry = parseGeometry(value);
  if (geometry?.type === 'Point') {
    const [lon, lat] = geometry.coordinates;
    return pointFromLonLat(Number(lon), Number(lat));
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const wktMatch = trimmed.match(/(?:SRID=\d+;)?POINT\s*\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
  if (wktMatch) {
    return pointFromLonLat(Number(wktMatch[1]), Number(wktMatch[2]));
  }

  return pointFromWkbHex(trimmed);
}

function pointFromLonLat(lon: number, lat: number): [number, number] | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

function pointFromWkbHex(value: string): [number, number] | null {
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

function parsePolygon(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const geometry = parseGeometry(value);
  return isPolygonLike(geometry) ? geometry : null;
}

function parseGeometry(value: unknown): AnyGeometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as AnyGeometry;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as AnyGeometry;
  return null;
}

function isPolygonLike(geometry: GeoJSON.Geometry | null | undefined): geometry is PolygonGeometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeHeight(properties: Record<string, unknown>, areaSqm: number): number {
  const explicitHeight = numberValue(properties.height) ?? numberValue(properties.height_m);
  if (explicitHeight && explicitHeight > 0) return explicitHeight;

  const floors = numberValue(properties.num_floors) ?? numberValue(properties.floors);
  if (floors && floors > 0) return Math.max(floors * 3, 3);

  if (areaSqm >= 1000) return 14;
  if (areaSqm >= 450) return 12;
  if (areaSqm >= 220) return 10;
  if (areaSqm >= 90) return 8;
  return 6;
}

function isLinkableBuilding(areaSqm: number, buildingType: string | null): boolean {
  if (Number.isFinite(areaSqm) && areaSqm > 0 && areaSqm < MIN_LINKABLE_BUILDING_AREA_SQM) return false;
  const normalizedType = buildingType?.toLowerCase().trim();
  return !normalizedType || !NON_LINKABLE_BUILDING_TYPES.has(normalizedType);
}

function buildingId(feature: BuildingFeature): string {
  return String(feature.properties.building_id ?? feature.id);
}

function calculateAddressBounds(addresses: CampaignAddressRow[]): Bounds | null {
  const points = addresses.map((address) => parsePoint(address.geom)).filter((point): point is [number, number] => !!point);
  if (points.length === 0) return null;
  return expandBounds(pointsToBounds(points), 0.00075);
}

function calculateGeometryBounds(value: unknown): Bounds | null {
  const geometry = parseGeometry(value);
  if (!geometry || !('coordinates' in geometry)) return null;
  const points: Array<[number, number]> = [];
  visitPositions(geometry.coordinates, (position) => points.push(position));
  return points.length > 0 ? pointsToBounds(points) : null;
}

function pointsToBounds(points: Array<[number, number]>): Bounds {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}

function expandBounds(bounds: Bounds, paddingDegrees: number): Bounds {
  return [
    bounds[0] - paddingDegrees,
    bounds[1] - paddingDegrees,
    bounds[2] + paddingDegrees,
    bounds[3] + paddingDegrees,
  ];
}

function normalizeBounds(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const bounds = value.slice(0, 4).map(Number);
  return bounds.every(Number.isFinite) ? bounds as Bounds : null;
}

function visitPositions(value: unknown, visitor: (position: [number, number]) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor([value[0], value[1]]);
    return;
  }
  for (const child of value) {
    visitPositions(child, visitor);
  }
}

function nextGeometryVersion(snapshot: ExistingSnapshot | null) {
  const current =
    numberValue(snapshot?.tile_metrics?.geometry_version) ??
    numberValue(snapshot?.tile_metrics?.pmtiles_version) ??
    0;
  return current + 1;
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha1(text: string) {
  return createHash('sha1').update(text).digest('hex');
}
