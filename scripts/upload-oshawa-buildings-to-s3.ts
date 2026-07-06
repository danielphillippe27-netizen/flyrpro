#!/usr/bin/env tsx
/**
 * Build and upload an Oshawa Diamond geometry artifact from local municipal data.
 *
 * This is intentionally campaign-scoped: Diamond iOS reads
 * s3://<bucket>/campaigns/{campaignId}/buildings.pmtiles through the ZXY tile
 * endpoint. Supabase remains the source of truth for addresses/statuses.
 *
 * Usage:
 *   npx tsx scripts/upload-oshawa-buildings-to-s3.ts <campaign-id>
 *   npx tsx scripts/upload-oshawa-buildings-to-s3.ts <campaign-id> --dry-run --keep-workdir
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as turf from '@turf/turf';
import dotenv from 'dotenv';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import wkx from 'wkx';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Bounds = [number, number, number, number];
type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Feature = GeoJSON.Feature<Geometry, Record<string, unknown>>;
type FeatureCollection = GeoJSON.FeatureCollection<Geometry, Record<string, unknown>>;

type CampaignAddress = {
  id: string;
  lon: number;
  lat: number;
  formatted: string | null;
};

type BuildingCandidate = {
  feature: Feature;
  centroid: [number, number];
  assignedAddressId: string | null;
  addressDistanceMeters: number | null;
  addressCount: number;
};

const args = process.argv.slice(2);
const campaignId = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const keepWorkdir = args.includes('--keep-workdir');
const minzoom = Number(readFlag('minzoom') ?? '13');
const maxzoom = Number(readFlag('maxzoom') ?? '18');
const BUILDING_TILE_BUFFER_UNITS = Number(process.env.BUILDING_TILE_BUFFER_UNITS ?? 127);
const BUILDING_BOUNDS_BUFFER_METERS = Number(process.env.BUILDING_BOUNDS_BUFFER_METERS ?? 128);
const paddingMeters = Number(readFlag('padding-meters') ?? '80');
const maxAddressBuildingMeters = Number(readFlag('max-address-building-meters') ?? '55');

const buildingsPath =
  readFlag('buildings-path') ??
  '/Volumes/Samsung SSD/municipal_data/clean/durham_buildings/durham_buildings_gold.ndjson';
const parcelsPath =
  readFlag('parcels-path') ??
  '/Volumes/Samsung SSD/municipal_data/clean/oshawa_parcels/oshawa_parcels_gold.ndjson';

const databaseUrl = process.env.DATABASE_URL;
const bucket =
  process.env.DIAMOND_GEOMETRY_BUCKET ||
  process.env.FLYR_SNAPSHOTS_BUCKET ||
  process.env.AWS_BUCKET_NAME ||
  'flyr-pro-addresses-2025';
const region = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';
const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://flyrpro.app'
).replace(/\/+$/, '');

if (!campaignId) {
  console.error('Usage: npx tsx scripts/upload-oshawa-buildings-to-s3.ts <campaign-id> [--dry-run] [--keep-workdir]');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!existsSync(buildingsPath)) {
  console.error(`Buildings file not found: ${buildingsPath}`);
  process.exit(1);
}
if (!existsSync(parcelsPath)) {
  console.error(`Parcels file not found: ${parcelsPath}`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 4 });
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
  console.error('❌ Oshawa Diamond upload failed:', error);
  process.exit(1);
}).finally(async () => {
  await sql.end({ timeout: 5 });
});

async function main() {
  const workdir = await mkdtemp(path.join(tmpdir(), `flyr-oshawa-diamond-${campaignId}-`));
  console.log(`💎 Building Oshawa Diamond artifact for campaign ${campaignId}`);
  console.log(`   Buildings: ${buildingsPath}`);
  console.log(`   Parcels:   ${parcelsPath}`);
  console.log(`   Workdir:   ${workdir}`);

  try {
    const campaign = await loadCampaign(campaignId!);
    const addresses = await loadCampaignAddresses(campaignId!);
    const paddedBounds = padBounds(campaign.bounds, paddingMeters);

    console.log(`   Campaign: ${campaign.title ?? campaignId}`);
    console.log(`   Bounds:   ${campaign.bounds.join(', ')}`);
    console.log(`   Padded:   ${paddedBounds.join(', ')}`);
    console.log(`   Addresses loaded for join: ${addresses.length}`);

    const buildings = await loadBuildingsFromMunicipalData(paddedBounds);
    assignAddressIds(buildings, addresses);
    const buildingFeatures = buildings.map((candidate) => {
      candidate.feature.properties.address_id = candidate.assignedAddressId;
      candidate.feature.properties.address_count = candidate.addressCount || undefined;
      candidate.feature.properties.address_distance_m = candidate.addressDistanceMeters != null
        ? Math.round(candidate.addressDistanceMeters * 10) / 10
        : undefined;
      return candidate.feature;
    });
    const parcels = await loadParcelsFromMunicipalData(paddedBounds);

    if (buildingFeatures.length === 0) {
      throw new Error('No Oshawa municipal building polygons intersected this campaign.');
    }

    const buildingsCollection: FeatureCollection = { type: 'FeatureCollection', features: buildingFeatures };
    const parcelsCollection: FeatureCollection = { type: 'FeatureCollection', features: parcels };

    const prefix = `campaigns/${campaignId}`;
    const pmtilesKey = `${prefix}/buildings.pmtiles`;
    const tilejsonKey = `${prefix}/buildings.json`;
    const geojsonKey = `${prefix}/buildings.geojson.gz`;
    const nextVersion = await nextGeometryVersion(campaignId!);

    const buildingsGeojsonPath = path.join(workdir, 'buildings.geojson');
    const parcelsGeojsonPath = path.join(workdir, 'parcels.geojson');
    const pmtilesPath = path.join(workdir, 'buildings.pmtiles');
    const tilejsonPath = path.join(workdir, 'buildings.json');

    await writeFile(buildingsGeojsonPath, JSON.stringify(buildingsCollection));
    await writeFile(parcelsGeojsonPath, JSON.stringify(parcelsCollection));
    await runTippecanoe(buildingsGeojsonPath, parcels.length > 0 ? parcelsGeojsonPath : null, pmtilesPath);

    const pmtilesBytes = await readFile(pmtilesPath);
    const pmtilesSha256 = sha256(pmtilesBytes);
    const pmtilesSize = await stat(pmtilesPath);
    const tilejson = buildTileJSON({
      campaignId: campaignId!,
      bounds: campaign.bounds,
      pmtilesKey,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256,
      hasParcels: parcels.length > 0,
    });
    await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));

    const linkedBuildings = buildings.filter((candidate) => candidate.assignedAddressId).length;
    console.log(`✅ Exported ${buildingFeatures.length} Oshawa building feature(s)`);
    console.log(`✅ Address IDs assigned to ${linkedBuildings} building feature(s)`);
    console.log(`✅ Exported ${parcels.length} Oshawa parcel feature(s)`);
    console.log(`✅ Wrote PMTiles (${(pmtilesSize.size / 1024 / 1024).toFixed(2)} MB)`);

    if (dryRun) {
      console.log('🧪 Dry run: skipping S3 upload and campaign_snapshots update.');
      return;
    }

    const pmtilesEtag = await uploadArtifact(pmtilesKey, pmtilesBytes, 'application/vnd.pmtiles');
    await uploadArtifact(tilejsonKey, await readFile(tilejsonPath), 'application/json; charset=utf-8');
    await uploadArtifact(geojsonKey, gzipSync(JSON.stringify(buildingsCollection)), 'application/geo+json', 'gzip');

    await upsertCampaignSnapshot({
      campaignId: campaignId!,
      prefix,
      pmtilesKey,
      tilejsonKey,
      geojsonKey,
      buildingsCount: buildingFeatures.length,
      parcelsCount: parcels.length,
      addressCount: addresses.length,
      linkedBuildings,
      geometryVersion: nextVersion,
      pmtilesEtag,
      pmtilesSha256,
      pmtilesSizeBytes: pmtilesSize.size,
      bounds: campaign.bounds,
    });

    console.log('🚀 Oshawa Diamond buildings are live in S3.');
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

async function loadCampaign(id: string) {
  const rows = await sql<{
    id: string;
    title: string | null;
    min_lon: number | null;
    min_lat: number | null;
    max_lon: number | null;
    max_lat: number | null;
  }[]>`
    SELECT
      c.id,
      COALESCE(c.title, c.name) AS title,
      COALESCE(ST_XMin(ST_Envelope(c.territory_boundary::geometry)), ST_XMin(ST_Extent(cp.geom::geometry))) AS min_lon,
      COALESCE(ST_YMin(ST_Envelope(c.territory_boundary::geometry)), ST_YMin(ST_Extent(cp.geom::geometry))) AS min_lat,
      COALESCE(ST_XMax(ST_Envelope(c.territory_boundary::geometry)), ST_XMax(ST_Extent(cp.geom::geometry))) AS max_lon,
      COALESCE(ST_YMax(ST_Envelope(c.territory_boundary::geometry)), ST_YMax(ST_Extent(cp.geom::geometry))) AS max_lat
    FROM campaigns c
    LEFT JOIN campaign_parcels cp ON cp.campaign_id = c.id
    WHERE c.id = ${id}
    GROUP BY c.id
  `;
  const row = rows[0];
  if (!row) throw new Error(`Campaign not found: ${id}`);
  const bounds = [row.min_lon, row.min_lat, row.max_lon, row.max_lat].map(Number);
  if (!bounds.every(Number.isFinite)) {
    throw new Error(`Campaign ${id} has no usable territory/parcels bounds.`);
  }
  return {
    id: row.id,
    title: row.title,
    bounds: bounds as Bounds,
  };
}

async function loadCampaignAddresses(id: string): Promise<CampaignAddress[]> {
  const rows = await sql<CampaignAddress[]>`
    SELECT
      id::text,
      ST_X(geom::geometry) AS lon,
      ST_Y(geom::geometry) AS lat,
      formatted
    FROM campaign_addresses
    WHERE campaign_id = ${id}
      AND geom IS NOT NULL
  `;
  return rows
    .map((row) => ({
      id: row.id,
      lon: Number(row.lon),
      lat: Number(row.lat),
      formatted: row.formatted,
    }))
    .filter((row) => Number.isFinite(row.lon) && Number.isFinite(row.lat));
}

async function nextGeometryVersion(id: string) {
  const rows = await sql<{ version: number | null }[]>`
    SELECT COALESCE(
      NULLIF(tile_metrics->>'geometry_version', '')::int,
      NULLIF(tile_metrics->>'pmtiles_version', '')::int,
      0
    ) AS version
    FROM campaign_snapshots
    WHERE campaign_id = ${id}
  `;
  return Number(rows[0]?.version ?? 0) + 1;
}

async function loadBuildingsFromMunicipalData(bounds: Bounds): Promise<BuildingCandidate[]> {
  const candidates: BuildingCandidate[] = [];
  let scanned = 0;
  const reader = createInterface({
    input: createReadStream(buildingsPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    scanned += 1;
    const row = JSON.parse(line) as Record<string, unknown>;
    const centroid = parsePoint(row.centroid);
    if (!centroid || !pointInBounds(centroid, bounds)) continue;
    const geometry = parsePolygonGeometry(row.geom);
    if (!geometry) continue;

    const externalId = stringValue(row.external_id) ?? stringValue(row.source_id) ?? `durham-${scanned}`;
    candidates.push({
      feature: {
        type: 'Feature',
        geometry,
        properties: {
          building_id: `durham_buildings:${externalId}`,
          gers_id: `durham_buildings:${externalId}`,
          source_id: externalId,
          source: 'durham_buildings',
          height: numberValue(row.height_m),
          building_type: stringValue(row.building_type),
          area_sqm: numberValue(row.area_sqm),
        },
      },
      centroid,
      assignedAddressId: null,
      addressDistanceMeters: null,
      addressCount: 0,
    });
  }

  console.log(`   Scanned ${scanned} Durham building row(s); clipped to ${candidates.length}`);
  return candidates;
}

async function loadParcelsFromMunicipalData(bounds: Bounds): Promise<Feature[]> {
  const features: Feature[] = [];
  let scanned = 0;
  const reader = createInterface({
    input: createReadStream(parcelsPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    scanned += 1;
    const row = JSON.parse(line) as Record<string, unknown>;
    const centroid = parsePoint(row.centroid);
    if (!centroid || !pointInBounds(centroid, bounds)) continue;
    const geometry = parsePolygonGeometry(row.geom);
    if (!geometry) continue;
    const parcelId = stringValue(row.parcel_id) ?? stringValue(row.external_id) ?? stringValue(row.roll_number);
    if (!parcelId) continue;

    features.push({
      type: 'Feature',
      geometry,
      properties: {
        parcel_id: parcelId,
        source_id: stringValue(row.source_id),
        source: 'oshawa_parcels',
        zoning: stringValue(row.zoning),
      },
    });
  }

  console.log(`   Scanned ${scanned} Oshawa parcel row(s); clipped to ${features.length}`);
  return features;
}

function assignAddressIds(buildings: BuildingCandidate[], addresses: CampaignAddress[]) {
  const assignedBuildingByAddress = new Map<string, BuildingCandidate>();

  for (const address of addresses) {
    const point = turf.point([address.lon, address.lat]);
    let best: BuildingCandidate | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const building of buildings) {
      const contains = turf.booleanPointInPolygon(point, building.feature);
      const distance = contains ? 0 : distanceMeters([address.lon, address.lat], building.centroid);
      if (distance < bestDistance) {
        best = building;
        bestDistance = distance;
      }
    }

    if (!best || bestDistance > maxAddressBuildingMeters) continue;
    const existing = assignedBuildingByAddress.get(address.id);
    if (existing && (existing.addressDistanceMeters ?? Infinity) <= bestDistance) continue;

    if (best.assignedAddressId && best.addressDistanceMeters != null && best.addressDistanceMeters <= bestDistance) {
      best.addressCount += 1;
      continue;
    }

    best.assignedAddressId = address.id;
    best.addressDistanceMeters = bestDistance;
    best.addressCount = Math.max(best.addressCount, 1);
    assignedBuildingByAddress.set(address.id, best);
  }
}

async function runTippecanoe(buildingsGeojsonPath: string, parcelsGeojsonPath: string | null, outputPath: string) {
  const tippecanoe = process.env.TIPPECANOE_BIN || 'tippecanoe';
  const commandArgs = [
    '--force',
    '--output',
    outputPath,
    '--minimum-zoom',
    String(minzoom),
    '--maximum-zoom',
    String(maxzoom),
    // Keep extruded building footprints from being clipped at tile edges.
    '--buffer',
    String(BUILDING_TILE_BUFFER_UNITS),
    '--no-clipping',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `buildings:${buildingsGeojsonPath}`,
  ];
  if (parcelsGeojsonPath) {
    commandArgs.push('--named-layer', `parcels:${parcelsGeojsonPath}`);
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
  pmtilesKey: string;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  hasParcels: boolean;
}) {
  return {
    tilejson: '3.0.0',
    name: `FLYR Diamond Oshawa ${options.campaignId}`,
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
          gers_id: 'String',
          source_id: 'String',
          source: 'String',
          height: 'Number',
          building_type: 'String',
          area_sqm: 'Number',
          address_count: 'Number',
          address_distance_m: 'Number',
        },
      },
      ...(options.hasParcels
        ? [{
            id: 'parcels',
            fields: {
              parcel_id: 'String',
              source_id: 'String',
              source: 'String',
              zoning: 'String',
            },
          }]
        : []),
    ],
    bounds: options.bounds,
    minzoom,
    maxzoom,
    attribution: 'FLYR / Durham Region / Oshawa municipal open data',
    metadata: {
      pmtiles_key: options.pmtilesKey,
      pmtiles_size_bytes: options.pmtilesSizeBytes,
      pmtiles_sha256: options.pmtilesSha256,
      municipal_buildings_path: buildingsPath,
      municipal_parcels_path: parcelsPath,
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
  prefix: string;
  pmtilesKey: string;
  tilejsonKey: string;
  geojsonKey: string;
  buildingsCount: number;
  parcelsCount: number;
  addressCount: number;
  linkedBuildings: number;
  geometryVersion: number;
  pmtilesEtag: string | null;
  pmtilesSha256: string;
  pmtilesSizeBytes: number;
  bounds: Bounds;
}) {
  const metrics = {
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
    tilejson_key: options.tilejsonKey,
    geojson_key: options.geojsonKey,
    source_layers: {
      buildings: 'buildings',
      parcels: 'parcels',
    },
    promote_ids: {
      buildings: 'building_id',
      parcels: 'parcel_id',
    },
    join_key: 'address_id',
    minzoom,
    maxzoom,
    bounds: options.bounds,
    source: 'municipal_oshawa_durham',
    municipal_buildings_path: buildingsPath,
    municipal_parcels_path: parcelsPath,
    buildings_count: options.buildingsCount,
    parcels_count: options.parcelsCount,
    addresses_count: options.addressCount,
    linked_buildings_count: options.linkedBuildings,
    generated_at: new Date().toISOString(),
  };

  await sql`
    INSERT INTO campaign_snapshots (
      campaign_id,
      bucket,
      prefix,
      buildings_key,
      metadata_key,
      buildings_count,
      addresses_count,
      tile_metrics,
      created_at,
      expires_at
    )
    VALUES (
      ${options.campaignId},
      ${bucket},
      ${options.prefix},
      ${options.pmtilesKey},
      ${options.tilejsonKey},
      ${options.buildingsCount},
      ${options.addressCount},
      ${sql.json(metrics)},
      now(),
      NULL
    )
    ON CONFLICT (campaign_id)
    DO UPDATE SET
      bucket = EXCLUDED.bucket,
      prefix = EXCLUDED.prefix,
      buildings_key = EXCLUDED.buildings_key,
      metadata_key = EXCLUDED.metadata_key,
      buildings_count = EXCLUDED.buildings_count,
      addresses_count = EXCLUDED.addresses_count,
      tile_metrics = EXCLUDED.tile_metrics,
      created_at = EXCLUDED.created_at,
      expires_at = NULL
  `;
}

function parsePoint(value: unknown): [number, number] | null {
  const geometry = parseWkt(value);
  if (!geometry || geometry.type !== 'Point') return null;
  const coords = geometry.coordinates;
  return Array.isArray(coords) && coords.length >= 2
    ? [Number(coords[0]), Number(coords[1])]
    : null;
}

function parsePolygonGeometry(value: unknown): Geometry | null {
  const geometry = parseWkt(value);
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
  return geometry;
}

function parseWkt(value: unknown): GeoJSON.Geometry | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return wkx.Geometry.parse(value).toGeoJSON() as GeoJSON.Geometry;
  } catch {
    return null;
  }
}

function pointInBounds(point: [number, number], bounds: Bounds) {
  return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
}

function padBounds(bounds: Bounds, meters: number): Bounds {
  const midLat = (bounds[1] + bounds[3]) / 2;
  const latPad = meters / 111_320;
  const lonPad = meters / (111_320 * Math.max(Math.cos((midLat * Math.PI) / 180), 0.1));
  return [bounds[0] - lonPad, bounds[1] - latPad, bounds[2] + lonPad, bounds[3] + latPad];
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const earthRadius = 6_371_000;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLat = ((b[1] - a[1]) * Math.PI) / 180;
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180;
  const hav =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function sha256(bytes: Buffer | Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
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
