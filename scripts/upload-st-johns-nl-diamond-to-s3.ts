#!/usr/bin/env tsx
/**
 * Build and upload St. John's, NL address and parcel Diamond layers to S3.
 *
 * S3 prefixes:
 *   diamond/addresses/canada/nl/st-johns/
 *   diamond/parcels/canada/nl/st-johns/
 *   diamond/canada/nl/st-johns/diamond-city-manifest.json
 *
 * Usage:
 *   npm run diamond:st-johns-nl
 *   npm run diamond:st-johns-nl -- --dry-run --keep-workdir
 *   npm run diamond:st-johns-nl -- --reuse-existing
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Bounds = [number, number, number, number];
type LayerName = 'addresses' | 'parcels';
type Geometry = GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Feature = GeoJSON.Feature<Geometry, Record<string, unknown>>;
type FeatureCollection = GeoJSON.FeatureCollection<Geometry, Record<string, unknown>>;

type ArcGISFeature = {
  attributes?: Record<string, unknown>;
  geometry?: {
    x?: number;
    y?: number;
    rings?: number[][][];
  };
};

type ArcGISResponse = {
  error?: { message?: string; details?: string[] };
  count?: number;
  objectIds?: number[];
  features?: ArcGISFeature[];
  exceededTransferLimit?: boolean;
};

type LayerConfig = {
  layer: LayerName;
  sourceName: string;
  sourceDataset: string;
  sourceUrl: string;
  itemUrl: string;
  minzoom: number;
  maxzoom: number;
  pageSize: number;
  promoteId: string;
  fields: Record<string, string>;
  normalizeFeature: (feature: ArcGISFeature) => Feature | null;
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepWorkdir = args.includes('--keep-workdir');
const reuseExisting = args.includes('--reuse-existing');
const defaultPmtilesBin = existsSync('/opt/homebrew/bin/pmtiles') ? '/opt/homebrew/bin/pmtiles' : 'pmtiles';
const pmtilesBin = readFlag('pmtiles-bin') ?? process.env.PMTILES_BIN ?? defaultPmtilesBin;
const outputRoot = path.resolve(
  readFlag('output-root') ?? '../municipal_data/diamond/canada/nl/st-johns'
);

const country = 'canada';
const region = 'nl';
const municipality = 'st-johns';
const bucket =
  process.env.DIAMOND_GEOMETRY_BUCKET ||
  process.env.FLYR_SNAPSHOTS_BUCKET ||
  process.env.AWS_BUCKET_NAME ||
  'flyr-pro-addresses-2025';
const awsRegion = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';

const s3 = new S3Client({
  region: awsRegion,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const layers: LayerConfig[] = [
  {
    layer: 'addresses',
    sourceName: "City of St. John's Address",
    sourceDataset: 'Mapcentre/Reference/MapServer/0',
    sourceUrl: 'https://map.stjohns.ca/mapsrv/rest/services/Mapcentre/Reference/MapServer/0',
    itemUrl: 'https://www.stjohns.ca/en/city-hall/maps.aspx',
    minzoom: 10,
    maxzoom: 16,
    pageSize: 100,
    promoteId: 'address_id',
    fields: {
      address_id: 'String',
      full_address: 'String',
      street_address: 'String',
      street_number: 'String',
      street_name: 'String',
      street_type: 'String',
      unit: 'String',
      postal_code: 'String',
      p_id: 'String',
      building_id: 'String',
      source_id: 'String',
      source: 'String',
      source_dataset: 'String',
      municipality: 'String',
      region: 'String',
      province: 'String',
      country: 'String',
    },
    normalizeFeature: normalizeAddressFeature,
  },
  {
    layer: 'parcels',
    sourceName: "City of St. John's Parcels",
    sourceDataset: 'Mapcentre/Reference/MapServer/2',
    sourceUrl: 'https://map.stjohns.ca/mapsrv/rest/services/Mapcentre/Reference/MapServer/2',
    itemUrl: 'https://www.stjohns.ca/en/city-hall/maps.aspx',
    minzoom: 10,
    maxzoom: 16,
    pageSize: 100,
    promoteId: 'parcel_id',
    fields: {
      parcel_id: 'String',
      pid: 'String',
      source_id: 'String',
      roll: 'String',
      tax_map: 'String',
      tax_map_formatted: 'String',
      ward: 'String',
      zone1: 'String',
      lot: 'String',
      subdivision: 'String',
      source: 'String',
      source_dataset: 'String',
      municipality: 'String',
      region: 'String',
      province: 'String',
      country: 'String',
      area_sqm: 'Number',
      shape_length_m: 'Number',
    },
    normalizeFeature: normalizeParcelFeature,
  },
];

main().catch((error) => {
  console.error("St. John's Diamond upload failed:", error);
  process.exit(1);
});

async function main() {
  const workdir = path.join(tmpdir(), `flyr-st-johns-nl-diamond-${Date.now()}`);
  const generatedAt = new Date().toISOString();

  console.log("Building St. John's Diamond municipal layers");
  console.log(`  Bucket: s3://${bucket}`);
  console.log(`  Output: ${outputRoot}`);
  console.log(`  Workdir: ${workdir}`);

  await mkdir(workdir, { recursive: true });
  await mkdir(outputRoot, { recursive: true });

  const manifests: Record<LayerName, Record<string, unknown>> = {} as Record<LayerName, Record<string, unknown>>;

  try {
    for (const layer of layers) {
      manifests[layer.layer] = await buildLayer(layer, generatedAt, workdir);
    }

    const cityManifest = {
      diamond_mode: true,
      scope: 'municipal_base',
      country,
      region,
      municipality,
      bucket,
      generated_at: generatedAt,
      layers: manifests,
    };
    const cityManifestPath = path.join(outputRoot, 'diamond-city-manifest.json');
    await writeFile(cityManifestPath, JSON.stringify(cityManifest, null, 2));

    if (!dryRun) {
      await uploadFile(
        `diamond/${country}/${region}/${municipality}/diamond-city-manifest.json`,
        cityManifestPath,
        'application/json; charset=utf-8'
      );
    }

    console.log("St. John's Diamond municipal layers are ready.");
    if (dryRun) {
      console.log('Dry run: skipped S3 upload.');
    } else {
      console.log(`Uploaded city manifest: s3://${bucket}/diamond/${country}/${region}/${municipality}/diamond-city-manifest.json`);
    }
  } finally {
    if (keepWorkdir) {
      console.log(`Kept workdir: ${workdir}`);
    } else {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

async function buildLayer(config: LayerConfig, generatedAt: string, workdir: string) {
  const layerDir = path.join(outputRoot, config.layer);
  await mkdir(layerDir, { recursive: true });

  const geojsonPath = path.join(layerDir, `${config.layer}.geojson`);
  const gzipPath = path.join(layerDir, `${config.layer}.geojson.gz`);
  const pmtilesPath = path.join(layerDir, `${config.layer}.pmtiles`);
  const tilejsonPath = path.join(layerDir, `${config.layer}.json`);
  const manifestPath = path.join(layerDir, 'diamond-manifest.json');

  let collection: FeatureCollection;
  if (reuseExisting && await hasUsableLayerArtifacts(geojsonPath, gzipPath, pmtilesPath)) {
    console.log(`Reusing existing ${config.layer} GeoJSON, gzip, and PMTiles artifacts`);
    collection = JSON.parse(await readFile(geojsonPath, 'utf8')) as FeatureCollection;
  } else {
    collection = await fetchArcGISLayer(config);
    const geojson = JSON.stringify(collection);
    await writeFile(geojsonPath, geojson);
    await writeFile(gzipPath, gzipSync(geojson));
    await runTippecanoe(config, geojsonPath, pmtilesPath);
  }

  if (collection.features.length === 0) {
    throw new Error(`No ${config.layer} features were loaded.`);
  }

  const bounds = calculateBounds(collection.features);

  const pmtilesInfo = await fileInfo(pmtilesPath);
  const gzipInfo = await fileInfo(gzipPath);

  const s3Prefix = `diamond/${config.layer}/${country}/${region}/${municipality}`;
  const tilejson = buildTileJSON(config, bounds, collection.features.length, pmtilesInfo, generatedAt, s3Prefix);
  const manifest = buildManifest(config, bounds, collection.features.length, pmtilesInfo, gzipInfo, generatedAt, s3Prefix, {
    pmtiles: geoRelative(pmtilesPath),
    tilejson: geoRelative(tilejsonPath),
    geojson_gzip: geoRelative(gzipPath),
    source_geojson: geoRelative(geojsonPath),
  });

  await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Prepared ${collection.features.length} ${config.layer} feature(s)`);
  console.log(`  Bounds: ${bounds.join(', ')}`);
  console.log(`  PMTiles: ${(pmtilesInfo.size / 1024 / 1024).toFixed(2)} MB`);

  if (!dryRun) {
    await uploadFile(`${s3Prefix}/${config.layer}.pmtiles`, pmtilesPath, 'application/vnd.pmtiles');
    await uploadFile(`${s3Prefix}/${config.layer}.geojson.gz`, gzipPath, 'application/geo+json', 'gzip');
    await uploadFile(`${s3Prefix}/${config.layer}.json`, tilejsonPath, 'application/json; charset=utf-8');
    await uploadFile(`${s3Prefix}/diamond-manifest.json`, manifestPath, 'application/json; charset=utf-8');
  }

  return manifest;
}

async function fetchArcGISLayer(config: LayerConfig): Promise<FeatureCollection> {
  const countResponse = await queryArcGIS(config.sourceUrl, {
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json',
  });
  const count = countResponse.count ?? 0;

  const idsResponse = await queryArcGIS(config.sourceUrl, {
    where: '1=1',
    returnIdsOnly: 'true',
    f: 'json',
  });
  const objectIds = (idsResponse.objectIds ?? []).sort((a, b) => a - b);
  if (count !== objectIds.length) {
    console.warn(`Expected ${count} ${config.layer}; received ${objectIds.length} object id(s).`);
  }

  const features: Feature[] = [];
  for (let offset = 0; offset < objectIds.length; offset += config.pageSize) {
    const chunk = objectIds.slice(offset, offset + config.pageSize);
    const response = await queryArcGIS(config.sourceUrl, {
      objectIds: chunk.join(','),
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    });

    for (const feature of response.features ?? []) {
      const normalized = config.normalizeFeature(feature);
      if (normalized) features.push(normalized);
    }

    console.log(`  ${config.layer}: ${Math.min(offset + chunk.length, objectIds.length)}/${objectIds.length}`);
  }

  return { type: 'FeatureCollection', features };
}

async function queryArcGIS(url: string, params: Record<string, string>, attempt = 1): Promise<ArcGISResponse> {
  const body = new URLSearchParams(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${url}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'FLYR Diamond municipal uploader',
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`ArcGIS HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text) as ArcGISResponse;
    if (json.error) {
      throw new Error(`${json.error.message ?? 'ArcGIS error'} ${json.error.details?.join(' ') ?? ''}`.trim());
    }
    return json;
  } catch (error) {
    if (attempt < 3) {
      await sleep(1000 * attempt);
      return queryArcGIS(url, params, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAddressFeature(feature: ArcGISFeature): Feature | null {
  const attributes = feature.attributes ?? {};
  const geometry = feature.geometry;
  if (!geometry || typeof geometry.x !== 'number' || typeof geometry.y !== 'number') return null;

  const objectId = stringValue(attributes.OBJECTID);
  if (!objectId) return null;

  const fullAddress = stringValue(attributes.FORMATTED_ADDR);
  const streetNumber = stringValue(attributes.CIVIC) ?? stringValue(attributes.STREETNUM);
  const streetName = stringValue(attributes.STREET);
  const streetType = stringValue(attributes.SUFFIX);
  const unit = stringValue(attributes.UNIT);
  const streetAddress = fullAddress ?? [streetNumber, streetName, streetType].filter(Boolean).join(' ');

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [geometry.x, geometry.y],
    },
    properties: cleanProperties({
      address_id: `st_johns_nl_addresses:${objectId}`,
      full_address: fullAddress ?? streetAddress,
      street_address: streetAddress,
      street_number: streetNumber,
      street_name: streetName,
      street_type: streetType,
      unit,
      postal_code: stringValue(attributes.ZIP_POSTAL),
      p_id: stringValue(attributes.P_ID),
      building_id: stringValue(attributes.BLDG_ID),
      source_id: objectId,
      source: 'st_johns_nl_addresses',
      source_dataset: 'Mapcentre/Reference/MapServer/0',
      municipality: "St. John's",
      region: 'Newfoundland and Labrador',
      province: 'NL',
      country: 'CA',
    }),
  };
}

function normalizeParcelFeature(feature: ArcGISFeature): Feature | null {
  const attributes = feature.attributes ?? {};
  const polygon = arcGisPolygonToGeoJSON(feature.geometry);
  if (!polygon) return null;

  const objectId = stringValue(attributes.OBJECTID);
  const pid = stringValue(attributes.Parcel_ID) ?? stringValue(attributes.P_ID);
  const parcelId = pid ? `st_johns_nl_parcels:${pid}` : objectId ? `st_johns_nl_parcels:${objectId}` : null;
  if (!parcelId) return null;

  return {
    type: 'Feature',
    geometry: polygon,
    properties: cleanProperties({
      parcel_id: parcelId,
      pid,
      source_id: objectId,
      roll: stringValue(attributes.ROLL),
      tax_map: stringValue(attributes.TAX_MAP),
      tax_map_formatted: stringValue(attributes.TAX_MAP_UFMT),
      ward: stringValue(attributes.WARD),
      zone1: stringValue(attributes.ZONE1),
      lot: stringValue(attributes.LOT),
      subdivision: stringValue(attributes.SUBDIVISION),
      source: 'st_johns_nl_parcels',
      source_dataset: 'Mapcentre/Reference/MapServer/2',
      municipality: "St. John's",
      region: 'Newfoundland and Labrador',
      province: 'NL',
      country: 'CA',
      area_sqm: numberValue(attributes['Shape.STArea()']),
      shape_length_m: numberValue(attributes['Shape.STLength()']),
    }),
  };
}

function arcGisPolygonToGeoJSON(geometry: ArcGISFeature['geometry']): GeoJSON.Polygon | null {
  const rings = geometry?.rings;
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const coordinates = rings
    .map((ring) => closeRing(ring))
    .filter((ring) => ring.length >= 4);
  if (coordinates.length === 0) return null;
  return { type: 'Polygon', coordinates };
}

function closeRing(ring: number[][]): number[][] {
  const cleaned = ring.filter((position) => Number.isFinite(position[0]) && Number.isFinite(position[1]));
  if (cleaned.length === 0) return cleaned;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return cleaned;
  return [...cleaned, first];
}

async function runTippecanoe(config: LayerConfig, geojsonPath: string, outputPath: string) {
  const tippecanoe = process.env.TIPPECANOE_BIN ||
    (existsSync('/opt/homebrew/Cellar/tippecanoe/2.79.0/bin/tippecanoe')
      ? '/opt/homebrew/Cellar/tippecanoe/2.79.0/bin/tippecanoe'
      : 'tippecanoe');
  const mbtilesFirst = config.layer === 'parcels';
  const tippecanoeOutputPath = mbtilesFirst ? outputPath.replace(/\.pmtiles$/, '.mbtiles') : outputPath;
  const commandArgs = [
    '--force',
    '--output',
    tippecanoeOutputPath,
    '--minimum-zoom',
    String(config.minzoom),
    '--maximum-zoom',
    String(config.maxzoom),
    ...(config.layer === 'parcels'
      ? [
          '--detect-shared-borders',
          '--coalesce-densest-as-needed',
          '--no-feature-limit',
          '--no-tile-size-limit',
        ]
      : ['--drop-densest-as-needed']),
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `${config.layer}:${geojsonPath}`,
  ];

  console.log(`${tippecanoe} ${commandArgs.join(' ')}`);
  await rm(tippecanoeOutputPath, { force: true });
  if (mbtilesFirst) await rm(outputPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tippecanoe, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited with code ${code}`));
    });
  });

  if (mbtilesFirst) {
    await runPmtiles(['convert', tippecanoeOutputPath, outputPath]);
    await runPmtiles(['verify', outputPath]);
    await rm(tippecanoeOutputPath, { force: true });
  }
}

async function runPmtiles(commandArgs: string[]) {
  console.log(`${pmtilesBin} ${commandArgs.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pmtilesBin, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pmtiles exited with code ${code}`));
    });
  });
}

async function hasUsableLayerArtifacts(geojsonPath: string, gzipPath: string, pmtilesPath: string) {
  if (!existsSync(geojsonPath) || !existsSync(gzipPath) || !existsSync(pmtilesPath)) return false;
  return isPmtiles(pmtilesPath);
}

async function isPmtiles(filePath: string) {
  const header = await readFile(filePath, { encoding: null }).then((buffer) => buffer.subarray(0, 7));
  return header.toString('utf8') === 'PMTiles';
}

function buildTileJSON(
  config: LayerConfig,
  bounds: Bounds,
  featureCount: number,
  pmtilesInfo: { size: number; sha256: string },
  generatedAt: string,
  s3Prefix: string
) {
  return {
    tilejson: '3.0.0',
    name: `FLYR Diamond ${titleCase(config.layer)} - Canada / NL / St. John's`,
    scheme: 'xyz',
    vector_layers: [
      {
        id: config.layer,
        fields: config.fields,
      },
    ],
    bounds,
    minzoom: config.minzoom,
    maxzoom: config.maxzoom,
    attribution: "FLYR / City of St. John's Mapcentre",
    metadata: {
      geometry_provider: 'pmtiles_static',
      promote_id: config.promoteId,
      join_key: config.promoteId,
      feature_count: featureCount,
      pmtiles_key: `${s3Prefix}/${config.layer}.pmtiles`,
      pmtiles_size_bytes: pmtilesInfo.size,
      pmtiles_sha256: pmtilesInfo.sha256,
      source_name: config.sourceName,
      source_url: config.itemUrl,
      source_dataset: config.sourceDataset,
      generated_at: generatedAt,
    },
  };
}

function buildManifest(
  config: LayerConfig,
  bounds: Bounds,
  featureCount: number,
  pmtilesInfo: { size: number; sha256: string },
  gzipInfo: { size: number; sha256: string },
  generatedAt: string,
  s3Prefix: string,
  localFiles: Record<string, string>
) {
  return {
    diamond_mode: true,
    scope: 'municipal_base',
    country,
    region,
    municipality,
    layer: config.layer,
    geometry_provider: 'pmtiles_static',
    geometry_url: `s3://${bucket}/${s3Prefix}/${config.layer}.pmtiles`,
    tilejson_url: `s3://${bucket}/${s3Prefix}/${config.layer}.json`,
    fallback_geojson_url: `s3://${bucket}/${s3Prefix}/${config.layer}.geojson.gz`,
    manifest_url: `s3://${bucket}/${s3Prefix}/diamond-manifest.json`,
    geometry_content_type: 'application/vnd.pmtiles',
    source_layer: config.layer,
    promote_id: config.promoteId,
    join_key: config.promoteId,
    bounds,
    minzoom: config.minzoom,
    maxzoom: config.maxzoom,
    feature_count: featureCount,
    pmtiles_size_bytes: pmtilesInfo.size,
    pmtiles_sha256: pmtilesInfo.sha256,
    geojson_gzip_size_bytes: gzipInfo.size,
    geojson_gzip_sha256: gzipInfo.sha256,
    generated_at: generatedAt,
    source: {
      name: config.sourceName,
      url: config.itemUrl,
      dataset: config.sourceDataset,
      service_url: config.sourceUrl,
    },
    local_files: localFiles,
  };
}

async function uploadFile(key: string, filePath: string, contentType: string, contentEncoding?: string) {
  const fileStats = await stat(filePath);
  console.log(`Uploading s3://${bucket}/${key} (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: fileStats.size,
    ContentType: contentType,
    ContentEncoding: contentEncoding,
    CacheControl: contentType === 'application/vnd.pmtiles' ? 'public, max-age=31536000, immutable' : undefined,
  }));
}

async function fileInfo(filePath: string) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  const bytes = await readFile(filePath);
  return {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
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

function readFlag(name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function cleanProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

function stringValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
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

function geoRelative(filePath: string) {
  return path.relative(path.resolve('..'), filePath).split(path.sep).join('/');
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
