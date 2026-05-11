#!/usr/bin/env tsx
/**
 * Create the reusable Oshawa Diamond municipal geometry folder in S3.
 *
 * This uploads static geometry only. It deliberately does not include campaign
 * statuses, visits, leads, notes, assignments, or customer state.
 *
 * S3 prefix:
 *   diamond/buildings/canada/on/oshawa/
 *
 * Usage:
 *   npm run diamond:oshawa-folder
 *   npm run diamond:oshawa-folder -- --dry-run --keep-workdir
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
import wkx from 'wkx';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Bounds = [number, number, number, number];
type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Feature = GeoJSON.Feature<Geometry, Record<string, unknown>>;
type FeatureCollection = GeoJSON.FeatureCollection<Geometry, Record<string, unknown>>;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepWorkdir = args.includes('--keep-workdir');
const minzoom = Number(readFlag('minzoom') ?? '12');
const maxzoom = Number(readFlag('maxzoom') ?? '18');
const paddingMeters = Number(readFlag('padding-meters') ?? '80');

const s3Prefix = (readFlag('prefix') ?? 'diamond/buildings/canada/on/oshawa').replace(/^\/+|\/+$/g, '');
const buildingsPath =
  readFlag('buildings-path') ??
  '/Volumes/Samsung SSD/municipal_data/clean/durham_buildings/durham_buildings_gold.ndjson';
const parcelsPath =
  readFlag('parcels-path') ??
  '/Volumes/Samsung SSD/municipal_data/clean/oshawa_parcels/oshawa_parcels_gold.ndjson';

const bucket =
  process.env.DIAMOND_GEOMETRY_BUCKET ||
  process.env.FLYR_SNAPSHOTS_BUCKET ||
  process.env.AWS_BUCKET_NAME ||
  'flyr-pro-addresses-2025';
const region = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';

if (!existsSync(buildingsPath)) {
  console.error(`Buildings file not found: ${buildingsPath}`);
  process.exit(1);
}
if (!existsSync(parcelsPath)) {
  console.error(`Parcels file not found: ${parcelsPath}`);
  process.exit(1);
}

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
  console.error('❌ Oshawa Diamond folder upload failed:', error);
  process.exit(1);
});

async function main() {
  const workdir = await mkdtemp(path.join(tmpdir(), 'flyr-oshawa-diamond-folder-'));
  console.log('💎 Creating Oshawa Diamond municipal geometry folder');
  console.log(`   S3 prefix: s3://${bucket}/${s3Prefix}/`);
  console.log(`   Buildings: ${buildingsPath}`);
  console.log(`   Parcels:   ${parcelsPath}`);
  console.log(`   Workdir:   ${workdir}`);

  try {
    const parcels = await loadOshawaParcels();
    if (parcels.features.length === 0) {
      throw new Error('No Oshawa parcel features were loaded.');
    }

    const bounds = padBounds(calculateBounds(parcels.features), paddingMeters);
    const buildings = await loadDurhamBuildingsWithin(bounds);
    if (buildings.features.length === 0) {
      throw new Error('No Durham building features intersected Oshawa bounds.');
    }

    const buildingsPathOut = path.join(workdir, 'buildings.geojson');
    const parcelsPathOut = path.join(workdir, 'parcels.geojson');
    const pmtilesPath = path.join(workdir, 'buildings.pmtiles');
    const tilejsonPath = path.join(workdir, 'buildings.json');
    const manifestPath = path.join(workdir, 'diamond-manifest.json');

    await writeFile(buildingsPathOut, JSON.stringify(buildings));
    await writeFile(parcelsPathOut, JSON.stringify(parcels));
    await runTippecanoe(buildingsPathOut, parcelsPathOut, pmtilesPath);

    const pmtilesBytes = await readFile(pmtilesPath);
    const pmtilesSize = await stat(pmtilesPath);
    const pmtilesSha256 = sha256(pmtilesBytes);
    const generatedAt = new Date().toISOString();

    const tilejson = buildTileJSON({
      bounds,
      buildingCount: buildings.features.length,
      parcelCount: parcels.features.length,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256,
      generatedAt,
    });
    const manifest = buildManifest({
      bounds,
      buildingCount: buildings.features.length,
      parcelCount: parcels.features.length,
      pmtilesSizeBytes: pmtilesSize.size,
      pmtilesSha256,
      generatedAt,
    });

    await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Prepared ${buildings.features.length} static building feature(s)`);
    console.log(`✅ Prepared ${parcels.features.length} static parcel feature(s)`);
    console.log(`✅ Wrote PMTiles (${(pmtilesSize.size / 1024 / 1024).toFixed(2)} MB)`);

    if (dryRun) {
      console.log('🧪 Dry run: skipping S3 upload.');
      return;
    }

    await uploadArtifact(`${s3Prefix}/buildings.pmtiles`, pmtilesBytes, 'application/vnd.pmtiles');
    await uploadArtifact(`${s3Prefix}/buildings.json`, await readFile(tilejsonPath), 'application/json; charset=utf-8');
    await uploadArtifact(`${s3Prefix}/diamond-manifest.json`, await readFile(manifestPath), 'application/json; charset=utf-8');
    await uploadArtifact(
      `${s3Prefix}/buildings.geojson.gz`,
      gzipSync(JSON.stringify(buildings)),
      'application/geo+json',
      'gzip'
    );
    await uploadArtifact(
      `${s3Prefix}/parcels.geojson.gz`,
      gzipSync(JSON.stringify(parcels)),
      'application/geo+json',
      'gzip'
    );

    console.log('🚀 Oshawa Diamond municipal folder is live.');
    console.log(`   s3://${bucket}/${s3Prefix}/`);
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

async function loadOshawaParcels(): Promise<FeatureCollection> {
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
        municipality: 'Oshawa',
        region: 'Durham Region',
        province: 'ON',
        country: 'CA',
        zoning: stringValue(row.zoning),
      },
    });
  }

  console.log(`   Scanned ${scanned} Oshawa parcel row(s); loaded ${features.length}`);
  return { type: 'FeatureCollection', features };
}

async function loadDurhamBuildingsWithin(bounds: Bounds): Promise<FeatureCollection> {
  const features: Feature[] = [];
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
    const externalId = stringValue(row.external_id) ?? `${scanned}`;

    features.push({
      type: 'Feature',
      geometry,
      properties: {
        building_id: `durham_buildings:${externalId}`,
        gers_id: `durham_buildings:${externalId}`,
        source_id: externalId,
        source: 'durham_buildings',
        municipality: 'Oshawa',
        region: 'Durham Region',
        province: 'ON',
        country: 'CA',
        height: numberValue(row.height_m),
        building_type: stringValue(row.building_type),
        area_sqm: numberValue(row.area_sqm),
      },
    });
  }

  console.log(`   Scanned ${scanned} Durham building row(s); clipped to ${features.length}`);
  return { type: 'FeatureCollection', features };
}

async function runTippecanoe(buildingsGeojsonPath: string, parcelsGeojsonPath: string, outputPath: string) {
  const tippecanoe = process.env.TIPPECANOE_BIN || 'tippecanoe';
  const commandArgs = [
    '--force',
    '--output',
    outputPath,
    '--minimum-zoom',
    String(minzoom),
    '--maximum-zoom',
    String(maxzoom),
    '--buffer',
    '8',
    '--no-clipping',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `buildings:${buildingsGeojsonPath}`,
    '--named-layer',
    `parcels:${parcelsGeojsonPath}`,
  ];
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
  bounds: Bounds;
  buildingCount: number;
  parcelCount: number;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  generatedAt: string;
}) {
  return {
    tilejson: '3.0.0',
    name: 'FLYR Diamond Buildings - Canada / ON / Oshawa',
    scheme: 'xyz',
    vector_layers: [
      {
        id: 'buildings',
        fields: {
          building_id: 'String',
          gers_id: 'String',
          source_id: 'String',
          source: 'String',
          municipality: 'String',
          region: 'String',
          province: 'String',
          country: 'String',
          height: 'Number',
          building_type: 'String',
          area_sqm: 'Number',
        },
      },
      {
        id: 'parcels',
        fields: {
          parcel_id: 'String',
          source_id: 'String',
          source: 'String',
          municipality: 'String',
          region: 'String',
          province: 'String',
          country: 'String',
          zoning: 'String',
        },
      },
    ],
    bounds: options.bounds,
    minzoom,
    maxzoom,
    attribution: 'FLYR / Durham Region / Oshawa municipal open data',
    metadata: {
      geometry_provider: 'pmtiles_static',
      promote_id: 'building_id',
      join_key: 'building_id',
      building_count: options.buildingCount,
      parcel_count: options.parcelCount,
      pmtiles_key: `${s3Prefix}/buildings.pmtiles`,
      pmtiles_size_bytes: options.pmtilesSizeBytes,
      pmtiles_sha256: options.pmtilesSha256,
      generated_at: options.generatedAt,
    },
  };
}

function buildManifest(options: {
  bounds: Bounds;
  buildingCount: number;
  parcelCount: number;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  generatedAt: string;
}) {
  return {
    diamond_mode: true,
    scope: 'municipal_base',
    country: 'canada',
    region: 'on',
    municipality: 'oshawa',
    geometry_provider: 'pmtiles_static',
    geometry_url: `s3://${bucket}/${s3Prefix}/buildings.pmtiles`,
    tilejson_url: `s3://${bucket}/${s3Prefix}/buildings.json`,
    fallback_geojson_url: `s3://${bucket}/${s3Prefix}/buildings.geojson.gz`,
    parcel_geojson_url: `s3://${bucket}/${s3Prefix}/parcels.geojson.gz`,
    geometry_content_type: 'application/vnd.pmtiles',
    source_layers: {
      buildings: 'buildings',
      parcels: 'parcels',
    },
    promote_ids: {
      buildings: 'building_id',
      parcels: 'parcel_id',
    },
    join_key: 'building_id',
    state_source: 'supabase_campaign_addresses',
    live_state_baked_into_geometry: false,
    bounds: options.bounds,
    minzoom,
    maxzoom,
    building_count: options.buildingCount,
    parcel_count: options.parcelCount,
    pmtiles_size_bytes: options.pmtilesSizeBytes,
    pmtiles_sha256: options.pmtilesSha256,
    generated_at: options.generatedAt,
    source_files: {
      buildings: buildingsPath,
      parcels: parcelsPath,
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
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentEncoding: contentEncoding,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

function parsePoint(value: unknown): [number, number] | null {
  const geometry = parseWkt(value);
  if (!geometry || geometry.type !== 'Point') return null;
  return [Number(geometry.coordinates[0]), Number(geometry.coordinates[1])];
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

function calculateBounds(features: Feature[]): Bounds {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const feature of features) {
    visitPositions(feature.geometry.coordinates, ([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
  }
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    throw new Error('Unable to calculate bounds.');
  }
  return [minLon, minLat, maxLon, maxLat];
}

function visitPositions(value: unknown, visitor: (position: [number, number]) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor([value[0], value[1]]);
    return;
  }
  for (const child of value) visitPositions(child, visitor);
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
