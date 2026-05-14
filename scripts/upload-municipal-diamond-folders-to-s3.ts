#!/usr/bin/env tsx
/**
 * Build and upload municipal Diamond folders for ON, AB, and FL source data.
 *
 * S3 prefixes:
 *   diamond/<layer>/<country>/<region>/<municipality>/
 *   diamond/<country>/<region>/<municipality>/diamond-city-manifest.json
 *
 * Each layer folder contains:
 *   <layer>.geojson
 *   <layer>.geojson.gz
 *   <layer>.pmtiles
 *   <layer>.json
 *   diamond-manifest.json
 *   arcgis-url.txt when an ArcGIS/source URL is known
 */

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import wkx from 'wkx';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Bounds = [number, number, number, number];
type LayerName = 'addresses' | 'buildings' | 'parcels';
type Geometry = GeoJSON.Point | GeoJSON.MultiPoint | GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Feature = GeoJSON.Feature<Geometry, Record<string, unknown>>;
type Manifest = Record<string, unknown>;

type SourceLayer = {
  sourceId: string;
  layer: LayerName;
  country: 'canada' | 'usa';
  region: string;
  municipality: string;
  label: string;
  inputKind: 'ndjson' | 'florida-parts';
  inputPath: string;
  sourceUrl?: string;
  arcgisUrl?: string;
  sourceName?: string;
  sourceOwner?: string;
};

type BuildResult = {
  manifest: Manifest;
  sourceLayer: SourceLayer;
  featureCount: number;
  s3Prefix: string;
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepLocalGeojson = args.includes('--keep-geojson');
const reuseExisting = args.includes('--reuse-existing');
const skipExistingS3 = args.includes('--skip-existing-s3');
const cleanOnly = args.includes('--clean-only');
const uploadConcurrency = Number(readFlag('upload-concurrency') ?? '4');
const wantedRegions = new Set((readFlag('regions') ?? 'on,ab,fl').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
const onlySources = new Set((readFlag('only') ?? '').split(',').map((item) => item.trim()).filter(Boolean));
const BUILDING_TILE_BUFFER_UNITS = Number(process.env.BUILDING_TILE_BUFFER_UNITS ?? 127);
const BUILDING_BOUNDS_BUFFER_METERS = Number(process.env.BUILDING_BOUNDS_BUFFER_METERS ?? 128);
const limit = Number(readFlag('limit') ?? '0');
const outputRoot = path.resolve(readFlag('output-root') ?? '../municipal_data/diamond');
const cleanRoot = path.resolve(readFlag('clean-root') ?? '../municipal_data/clean');
const floridaRawRoot = path.resolve(readFlag('florida-raw-root') ?? '../municipal_data/florida_data/raw/20260504');
const arcgisConfigPath = path.resolve(readFlag('arcgis-config') ?? '../municipal_data/arcgis_endpoints.json');
const minzoomOverride = readFlag('minzoom');
const maxzoomOverride = readFlag('maxzoom');

const bucket =
  process.env.DIAMOND_GEOMETRY_BUCKET ||
  process.env.FLYR_SNAPSHOTS_BUCKET ||
  process.env.AWS_BUCKET_NAME ||
  'flyr-pro-addresses-2025';
const awsRegion = process.env.AWS_S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';
const tippecanoe = readFlag('tippecanoe-bin') ?? process.env.TIPPECANOE_BIN ?? 'tippecanoe';
const tippecanoeTempDir = readFlag('tippecanoe-temp-dir') ?? process.env.TIPPECANOE_TEMP_DIR ?? process.env.TMPDIR;
const skippedSources: string[] = [];

const s3 = new S3Client({
  region: awsRegion,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
    : undefined,
});

const regionOverrides: Record<string, string> = {
  airdrie: 'ab',
  calgary: 'ab',
  cochrane: 'ab',
  edmonton: 'ab',
  strathcona: 'ab',
  ajax: 'on',
  barrie: 'on',
  brampton: 'on',
  burlington: 'on',
  clarington: 'on',
  cobourg: 'on',
  durham: 'on',
  guelph: 'on',
  hamilton: 'on',
  london: 'on',
  milton: 'on',
  mississauga: 'on',
  niagara: 'on',
  'niagara-falls-property': 'on',
  'niagara-falls': 'on',
  oshawa: 'on',
  ottawa: 'on',
  peel: 'on',
  'peel-caledon': 'on',
  pickering: 'on',
  'st-catharines': 'on',
  toronto: 'on',
  waterloo: 'on',
  windsor: 'on',
  york: 'on',
  'york-region': 'on',
};
const municipalityOverrides: Record<string, string> = {
  fl_jacksonville_overture_buildings: 'jacksonville',
  fl_miami_dade_pa_property_points: 'miami-dade-property-points',
  peel_caledon_parcels: 'caledon',
  peel_caledon_buildings: 'caledon',
  peel_parcels: 'peel-region',
  york_region_parcels: 'york-region',
};
const layerOverrides: Record<string, LayerName> = {
  fl_marion_parcel_centroids: 'addresses',
  fl_miami_dade_pa_property_points: 'addresses',
};

main().catch((error) => {
  console.error('Municipal Diamond folder upload failed:', error);
  process.exit(1);
});

async function main() {
  console.log('Building municipal Diamond folders');
  console.log(`  Bucket: s3://${bucket}`);
  console.log(`  Regions: ${[...wantedRegions].join(', ')}`);
  console.log(`  Output: ${outputRoot}`);

  const arcgisUrls = await loadArcgisUrlIndex();
  const sources = await discoverSources(arcgisUrls);
  const selected = sources
    .filter((source) => wantedRegions.has(source.region))
    .filter((source) => onlySources.size === 0 || onlySources.has(source.sourceId) || onlySources.has(`${source.region}/${source.municipality}/${source.layer}`))
    .slice(0, limit > 0 ? limit : undefined);

  if (selected.length === 0) {
    throw new Error('No matching municipal sources found.');
  }

  console.log(`  Sources: ${selected.length}`);

  const byCity = new Map<string, BuildResult[]>();
  for (const source of selected) {
    const key = `${source.country}/${source.region}/${source.municipality}`;
    if (!byCity.has(key)) byCity.set(key, []);

    if (skipExistingS3 && await layerExistsInS3(source)) {
      console.log(`Skipping existing S3 layer: ${source.sourceId}`);
      const existing = await readExistingLocalResult(source);
      if (existing) byCity.get(key)!.push(existing);
      continue;
    }

    const result = await buildLayer(source);
    if (result) byCity.get(key)!.push(result);
  }

  for (const [cityKey, results] of byCity) {
    if (results.length === 0) continue;
    await writeCityManifest(cityKey, results);
  }

  console.log('Municipal Diamond folders are ready.');
  if (skippedSources.length > 0) {
    console.log(`Skipped empty/non-geometry layer(s): ${skippedSources.join(', ')}`);
  }
}

function readFlag(name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function loadArcgisUrlIndex() {
  const index = new Map<string, { layerUrl?: string; sourcePage?: string; label?: string }>();
  if (!existsSync(arcgisConfigPath)) return index;

  const payload = JSON.parse(await readFile(arcgisConfigPath, 'utf8')) as { endpoints?: Record<string, unknown>[] };
  for (const endpoint of payload.endpoints ?? []) {
    const slug = stringValue(endpoint.slug);
    if (!slug) continue;
    index.set(slug, {
      layerUrl: stringValue(endpoint.layer_url) ?? undefined,
      sourcePage: stringValue(endpoint.source_page) ?? undefined,
      label: stringValue(endpoint.label) ?? undefined,
    });
  }
  return index;
}

async function discoverSources(arcgisUrls: Map<string, { layerUrl?: string; sourcePage?: string; label?: string }>) {
  const sources: SourceLayer[] = [];
  sources.push(...await discoverCleanSources(arcgisUrls));
  if (wantedRegions.has('fl') && !cleanOnly) {
    sources.push(...await discoverFloridaSources());
  }
  return sources.sort((a, b) => `${a.region}/${a.municipality}/${a.layer}/${a.sourceId}`.localeCompare(`${b.region}/${b.municipality}/${b.layer}/${b.sourceId}`));
}

async function discoverCleanSources(arcgisUrls: Map<string, { layerUrl?: string; sourcePage?: string; label?: string }>) {
  const sources: SourceLayer[] = [];
  if (!existsSync(cleanRoot)) return sources;

  for (const dirent of await readdir(cleanRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(cleanRoot, dirent.name);
    const files = (await readdir(dir)).filter((file) => file.endsWith('_gold.ndjson') || file.endsWith('_v2_gold.ndjson'));
    const file = files.sort()[0];
    if (!file) continue;

    const layer = inferLayer(dirent.name);
    if (!layer) continue;

    const firstRow = await readFirstNdjsonRow(path.join(dir, file));
    const baseMunicipality = municipalityFromSourceId(dirent.name);
    const region = normalizeRegion(stringValue(firstRow?.province) ?? regionOverrides[baseMunicipality]);
    if (!region || !wantedRegions.has(region)) continue;

    const sourceId = dirent.name;
    const endpoint = arcgisUrls.get(sourceId);
    const sourceUrl = stringValue(firstRow?.source_url) ?? endpoint?.sourcePage;
    const arcgisUrl = endpoint?.layerUrl ?? (sourceUrl && /arcgis/i.test(sourceUrl) ? sourceUrl : undefined);
    const municipality = municipalityOverrides[sourceId] ?? (region === 'fl' ? normalizeMunicipality(stringValue(firstRow?.municipality) ?? floridaMunicipalityFromSourceId(sourceId)) : baseMunicipality);
    const country = normalizeCountry(stringValue(firstRow?.country));

    sources.push({
      sourceId,
      layer,
      country,
      region,
      municipality,
      label: endpoint?.label ?? titleCase(sourceId.replace(/_/g, ' ')),
      inputKind: 'ndjson',
      inputPath: path.join(dir, file),
      sourceUrl,
      arcgisUrl,
      sourceName: stringValue(firstRow?.source_file) ?? endpoint?.label,
    });
  }

  return sources;
}

async function discoverFloridaSources() {
  const manifestPath = path.join(floridaRawRoot, 'download_manifest.json');
  if (!existsSync(manifestPath)) return [];

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>[];
  const sources: SourceLayer[] = [];

  for (const item of manifest) {
    const sourceId = stringValue(item.source_id);
    const rawType = stringValue(item.dataset_type);
    if (!sourceId || !rawType) continue;
    const layer = floridaLayer(rawType);
    if (!layer) continue;

    const partsDir = path.join(floridaRawRoot, sourceId, 'parts');
    if (!existsSync(partsDir)) continue;

    sources.push({
      sourceId,
      layer,
      country: 'usa',
      region: 'fl',
      municipality: floridaMunicipalityFromSourceId(sourceId),
      label: stringValue(item.source_name) ?? titleCase(sourceId.replace(/_/g, ' ')),
      inputKind: 'florida-parts',
      inputPath: partsDir,
      sourceUrl: stringValue(item.source_url) ?? undefined,
      arcgisUrl: arcgisLike(stringValue(item.layer_url)) ?? arcgisLike(stringValue(item.source_url)),
      sourceName: stringValue(item.source_name) ?? undefined,
      sourceOwner: stringValue(item.source_owner) ?? undefined,
    });
  }

  return sources;
}

async function buildLayer(source: SourceLayer): Promise<BuildResult | null> {
  const layerDir = path.join(outputRoot, source.country, source.region, source.municipality, source.layer);
  await mkdir(layerDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const geojsonPath = path.join(layerDir, `${source.layer}.geojson`);
  const gzipPath = path.join(layerDir, `${source.layer}.geojson.gz`);
  const pmtilesPath = path.join(layerDir, `${source.layer}.pmtiles`);
  const tilejsonPath = path.join(layerDir, `${source.layer}.json`);
  const manifestPath = path.join(layerDir, 'diamond-manifest.json');
  const arcgisUrlPath = path.join(layerDir, 'arcgis-url.txt');
  const s3Prefix = `diamond/${source.layer}/${source.country}/${source.region}/${source.municipality}`;

  console.log(`\n=== ${source.sourceId} -> ${s3Prefix}/ ===`);

  let exportResult: { featureCount: number; bounds: Bounds };
  if (reuseExisting && existsSync(geojsonPath)) {
    exportResult = await scanGeojsonBounds(geojsonPath);
    console.log(`  reusing ${exportResult.featureCount.toLocaleString()} feature(s)`);
  } else if (source.inputKind === 'ndjson') {
    exportResult = await exportNdjsonLayer(source, geojsonPath);
  } else {
    exportResult = await exportFloridaPartsLayer(source, geojsonPath);
  }

  if (exportResult.featureCount === 0) {
    console.log(`  skipped: no usable ${source.layer} geometries`);
    skippedSources.push(source.sourceId);
    await rm(geojsonPath, { force: true });
    return null;
  }

  await gzipFile(geojsonPath, gzipPath);
  await runTippecanoe(source, geojsonPath, pmtilesPath);

  const pmtilesSize = await stat(pmtilesPath);
  const gzipSize = await stat(gzipPath);
  const pmtilesSha256 = await sha256File(pmtilesPath);
  const gzipSha256 = await sha256File(gzipPath);
  const minzoom = layerMinzoom(source.layer);
  const maxzoom = layerMaxzoom(source.layer);

  const tilejson = {
    tilejson: '3.0.0',
    name: `FLYR Diamond ${titleCase(source.layer)} - ${source.country}/${source.region}/${source.municipality}`,
    scheme: 'xyz',
    vector_layers: [
      {
        id: source.layer,
        fields: fieldsForLayer(source.layer),
      },
    ],
    bounds: exportResult.bounds,
    minzoom,
    maxzoom,
    attribution: source.sourceOwner ? `FLYR / ${source.sourceOwner}` : 'FLYR municipal open data',
    metadata: {
      geometry_provider: 'pmtiles_static',
      promote_id: promoteIdForLayer(source.layer),
      join_key: promoteIdForLayer(source.layer),
      feature_count: exportResult.featureCount,
      pmtiles_key: `${s3Prefix}/${source.layer}.pmtiles`,
      pmtiles_size_bytes: pmtilesSize.size,
      pmtiles_sha256: pmtilesSha256,
      generated_at: generatedAt,
      source_id: source.sourceId,
      arcgis_url: source.arcgisUrl ?? null,
    },
  };
  await writeFile(tilejsonPath, JSON.stringify(tilejson, null, 2));

  if (source.arcgisUrl) {
    await writeFile(arcgisUrlPath, `${source.arcgisUrl}\n`);
  } else if (existsSync(arcgisUrlPath)) {
    await rm(arcgisUrlPath, { force: true });
  }

  const manifest = buildManifest({
    source,
    s3Prefix,
    bounds: exportResult.bounds,
    featureCount: exportResult.featureCount,
    pmtilesSizeBytes: pmtilesSize.size,
    pmtilesSha256,
    geojsonGzipSizeBytes: gzipSize.size,
    geojsonGzipSha256: gzipSha256,
    generatedAt,
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`  exported ${exportResult.featureCount.toLocaleString()} feature(s)`);
  console.log(`  pmtiles ${(pmtilesSize.size / 1024 / 1024).toFixed(2)} MB`);

  if (!dryRun) {
    await uploadFile(`${s3Prefix}/${source.layer}.pmtiles`, pmtilesPath, 'application/vnd.pmtiles');
    await uploadFile(`${s3Prefix}/${source.layer}.json`, tilejsonPath, 'application/json; charset=utf-8');
    await uploadFile(`${s3Prefix}/${source.layer}.geojson.gz`, gzipPath, 'application/geo+json', 'gzip');
    await uploadFile(`${s3Prefix}/diamond-manifest.json`, manifestPath, 'application/json; charset=utf-8');
    if (source.arcgisUrl) {
      await uploadFile(`${s3Prefix}/arcgis-url.txt`, arcgisUrlPath, 'text/plain; charset=utf-8');
    }
  }

  if (!keepLocalGeojson) {
    await rm(geojsonPath, { force: true });
  }

  return {
    manifest,
    sourceLayer: source,
    featureCount: exportResult.featureCount,
    s3Prefix,
  };
}

async function exportNdjsonLayer(source: SourceLayer, outputPath: string) {
  const writer = createWriteStream(outputPath, { encoding: 'utf8' });
  writer.write('{"type":"FeatureCollection","features":[');

  let first = true;
  let scanned = 0;
  let written = 0;
  const bounds = emptyBounds();
  const reader = createInterface({
    input: createReadStream(source.inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    scanned += 1;
    const row = parseNdjsonLine(line) as Record<string, unknown>;
    const feature = normalizeNdjsonFeature(source, row, scanned);
    if (!feature) continue;

    if (!first) writer.write(',');
    writer.write(JSON.stringify(feature));
    first = false;
    written += 1;
    extendBounds(bounds, feature.geometry);
  }

  writer.write(']}');
  await closeWriter(writer);
  console.log(`  scanned ${scanned.toLocaleString()} row(s)`);
  if (written === 0) return { featureCount: 0, bounds: [0, 0, 0, 0] as Bounds };
  return { featureCount: written, bounds: finalizeBounds(bounds) };
}

async function exportFloridaPartsLayer(source: SourceLayer, outputPath: string) {
  const writer = createWriteStream(outputPath, { encoding: 'utf8' });
  writer.write('{"type":"FeatureCollection","features":[');

  let first = true;
  let written = 0;
  const bounds = emptyBounds();
  const files = (await readdir(source.inputPath)).filter((file) => file.endsWith('.geojson')).sort();

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(source.inputPath, file), 'utf8')) as GeoJSON.FeatureCollection;
    for (const rawFeature of payload.features ?? []) {
      const feature = normalizeGeojsonFeature(source, rawFeature as GeoJSON.Feature, written + 1);
      if (!feature) continue;
      if (!first) writer.write(',');
      writer.write(JSON.stringify(feature));
      first = false;
      written += 1;
      extendBounds(bounds, feature.geometry);
    }
    if (written > 0 && written % 100000 < 2000) {
      console.log(`  exported ${written.toLocaleString()} feature(s)`);
    }
  }

  writer.write(']}');
  await closeWriter(writer);
  if (written === 0) return { featureCount: 0, bounds: [0, 0, 0, 0] as Bounds };
  return { featureCount: written, bounds: finalizeBounds(bounds) };
}

function normalizeNdjsonFeature(source: SourceLayer, row: Record<string, unknown>, sequence: number): Feature | null {
  const parsedGeometry = parseGeometry(row.geom);
  if (!parsedGeometry || !isLayerGeometry(source.layer, parsedGeometry)) return null;
  const geometry = normalizeGeometryForSource(source, parsedGeometry);
  const sourceId = stringValue(row.source_id) ?? source.sourceId;
  const externalId =
    stringValue(row.external_id) ??
    stringValue(row.parcel_id) ??
    stringValue(row.roll_number) ??
    stringValue(row.street_number) ??
    `${sequence}`;

  if (source.layer === 'addresses') {
    const addressId = `${sourceId}:${externalId}:${sequence}`;
    const streetNumber = stringValue(row.street_number);
    const streetName = stringValue(row.street_name);
    return {
      type: 'Feature',
      geometry,
      properties: compactObject({
        address_id: addressId,
        source_id: externalId,
        source: sourceId,
        municipality: source.municipality,
        region: source.region,
        province: source.region.toUpperCase(),
        country: source.country === 'canada' ? 'CA' : 'US',
        street_number: streetNumber,
        street_name: streetName,
        unit: stringValue(row.unit),
        postal_code: stringValue(row.zip) ?? stringValue(row.postal_code),
        full_address: [streetNumber, streetName].filter(Boolean).join(' ') || null,
        precision: stringValue(row.precision),
        address_type: stringValue(row.address_type),
      }),
    };
  }

  if (source.layer === 'buildings') {
    const buildingId = `${sourceId}:${externalId}`;
    return {
      type: 'Feature',
      geometry,
      properties: compactObject({
        building_id: buildingId,
        gers_id: buildingId,
        source_id: externalId,
        source: sourceId,
        municipality: source.municipality,
        region: source.region,
        province: source.region.toUpperCase(),
        country: source.country === 'canada' ? 'CA' : 'US',
        height: numberValue(row.height_m),
        floors: numberValue(row.floors),
        building_type: stringValue(row.building_type),
        subtype: stringValue(row.subtype),
        area_sqm: numberValue(row.area_sqm),
      }),
    };
  }

  const parcelId = stringValue(row.parcel_id) ?? `${sourceId}:${externalId}`;
  return {
    type: 'Feature',
    geometry,
    properties: compactObject({
      parcel_id: parcelId,
      source_id: externalId,
      source: sourceId,
      municipality: source.municipality,
      region: source.region,
      province: source.region.toUpperCase(),
      country: source.country === 'canada' ? 'CA' : 'US',
      address: stringValue(row.address),
      street_number: stringValue(row.street_number),
      street_name: stringValue(row.street_name),
      postal_code: stringValue(row.postal_code),
      zoning: stringValue(row.zoning),
      area_sqm: numberValue(row.area_sqm),
    }),
  };
}

function normalizeGeojsonFeature(source: SourceLayer, rawFeature: GeoJSON.Feature, sequence: number): Feature | null {
  const geometry = rawFeature.geometry as Geometry | null;
  if (!geometry || !isLayerGeometry(source.layer, geometry)) return null;

  const properties = rawFeature.properties ?? {};
  const rawId =
    stringValue(rawFeature.id) ??
    stringValue(properties.OBJECTID) ??
    stringValue(properties.ObjectID) ??
    stringValue(properties.FID) ??
    stringValue(properties.PARCELID) ??
    stringValue(properties.PARID) ??
    stringValue(properties.PIN) ??
    `${sequence}`;

  if (source.layer === 'addresses') {
    const addressId = `${source.sourceId}:${rawId}`;
    return {
      type: 'Feature',
      geometry,
      properties: compactObject({
        address_id: addressId,
        source_id: rawId,
        source: source.sourceId,
        municipality: source.municipality,
        region: 'fl',
        province: 'FL',
        country: 'US',
        full_address: pickString(properties, ['FULLADDR', 'FULL_ADDRESS', 'FULL_ADDRE', 'ADDRESS', 'SITUS', 'SITE_ADDR']),
        street_number: pickString(properties, ['ADDRNUM', 'ADDRESS_NUMBER', 'STREET_NUM', 'HOUSE_NUM']),
        street_name: pickString(properties, ['STREETNAME', 'STREET_NAME', 'ROADNAME', 'ST_NAME']),
        postal_code: pickString(properties, ['ZIP', 'ZIPCODE', 'POSTALCODE']),
      }),
    };
  }

  if (source.layer === 'buildings') {
    const buildingId = `${source.sourceId}:${rawId}`;
    return {
      type: 'Feature',
      geometry,
      properties: compactObject({
        building_id: buildingId,
        gers_id: buildingId,
        source_id: rawId,
        source: source.sourceId,
        municipality: source.municipality,
        region: 'fl',
        province: 'FL',
        country: 'US',
        height: pickNumber(properties, ['BuildingHeight', 'HEIGHT', 'HEIGHT_M', 'BLDGHEIGHT']),
        building_type: pickString(properties, ['FEATURE_SUBTYPE', 'TYPE', 'BLDG_TYPE']),
        area_sqm: pickNumber(properties, ['Shape__Area', 'SHAPEAREA', 'AREA_SQM']),
      }),
    };
  }

  const parcelId = pickString(properties, ['PARCELID', 'PARID', 'PIN', 'FOLIO', 'STRAP', 'ALTKEY']) ?? `${source.sourceId}:${rawId}`;
  return {
    type: 'Feature',
    geometry,
    properties: compactObject({
      parcel_id: parcelId,
      source_id: rawId,
      source: source.sourceId,
      municipality: source.municipality,
      region: 'fl',
      province: 'FL',
      country: 'US',
      address: pickString(properties, ['SITUS', 'SITE_ADDR', 'PROPERTY_ADDRESS', 'ADDRESS']),
      postal_code: pickString(properties, ['ZIP', 'ZIPCODE']),
      area_sqm: pickNumber(properties, ['Shape__Area', 'SHAPEAREA', 'AREA_SQM']),
    }),
  };
}

async function runTippecanoe(source: SourceLayer, geojsonPath: string, outputPath: string) {
  const commandArgs = [
    '--force',
    '--quiet',
    '--output',
    outputPath,
    '--minimum-zoom',
    String(layerMinzoom(source.layer)),
    '--maximum-zoom',
    String(layerMaxzoom(source.layer)),
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--named-layer',
    `${source.layer}:${geojsonPath}`,
  ];

  if (tippecanoeTempDir) {
    commandArgs.splice(2, 0, '--temporary-directory', tippecanoeTempDir);
  }

  if (source.layer === 'buildings' || source.layer === 'parcels') {
    const dropArgIndex = commandArgs.indexOf('--drop-densest-as-needed');
    commandArgs.splice(
      dropArgIndex,
      0,
      // Avoid visible seams where polygon features cross tile boundaries.
      '--buffer',
      String(BUILDING_TILE_BUFFER_UNITS),
      '--no-clipping'
    );
  }

  console.log(`  ${tippecanoe} ${commandArgs.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tippecanoe, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited with code ${code}`));
    });
  });
}

function buildManifest(options: {
  source: SourceLayer;
  s3Prefix: string;
  bounds: Bounds;
  featureCount: number;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  geojsonGzipSizeBytes: number;
  geojsonGzipSha256: string;
  generatedAt: string;
}) {
  const { source, s3Prefix } = options;
  return {
    diamond_mode: true,
    scope: 'municipal_base',
    country: source.country,
    region: source.region,
    municipality: source.municipality,
    layer: source.layer,
    geometry_provider: 'pmtiles_static',
    geometry_url: `s3://${bucket}/${s3Prefix}/${source.layer}.pmtiles`,
    tilejson_url: `s3://${bucket}/${s3Prefix}/${source.layer}.json`,
    fallback_geojson_url: `s3://${bucket}/${s3Prefix}/${source.layer}.geojson.gz`,
    manifest_url: `s3://${bucket}/${s3Prefix}/diamond-manifest.json`,
    arcgis_url: source.arcgisUrl ?? null,
    arcgis_url_file: source.arcgisUrl ? `s3://${bucket}/${s3Prefix}/arcgis-url.txt` : null,
    geometry_content_type: 'application/vnd.pmtiles',
    building_bounds_buffer_meters: source.layer === 'buildings' ? BUILDING_BOUNDS_BUFFER_METERS : undefined,
    tile_buffer: source.layer === 'buildings' || source.layer === 'parcels' ? BUILDING_TILE_BUFFER_UNITS : undefined,
    source_layer: source.layer,
    promote_id: promoteIdForLayer(source.layer),
    join_key: promoteIdForLayer(source.layer),
    bounds: options.bounds,
    minzoom: layerMinzoom(source.layer),
    maxzoom: layerMaxzoom(source.layer),
    feature_count: options.featureCount,
    pmtiles_size_bytes: options.pmtilesSizeBytes,
    pmtiles_sha256: options.pmtilesSha256,
    geojson_gzip_size_bytes: options.geojsonGzipSizeBytes,
    geojson_gzip_sha256: options.geojsonGzipSha256,
    generated_at: options.generatedAt,
    source: {
      id: source.sourceId,
      name: source.sourceName ?? source.label,
      owner: source.sourceOwner ?? null,
      url: source.sourceUrl ?? null,
      arcgis_url: source.arcgisUrl ?? null,
      input_path: source.inputPath,
    },
    local_files: {
      pmtiles: path.relative(path.resolve('..'), path.join(outputRoot, source.country, source.region, source.municipality, source.layer, `${source.layer}.pmtiles`)),
      tilejson: path.relative(path.resolve('..'), path.join(outputRoot, source.country, source.region, source.municipality, source.layer, `${source.layer}.json`)),
      geojson_gzip: path.relative(path.resolve('..'), path.join(outputRoot, source.country, source.region, source.municipality, source.layer, `${source.layer}.geojson.gz`)),
    },
  };
}

async function writeCityManifest(cityKey: string, results: BuildResult[]) {
  const [country, region, municipality] = cityKey.split('/');
  const generatedAt = new Date().toISOString();
  const cityDir = path.join(outputRoot, country, region, municipality);
  await mkdir(cityDir, { recursive: true });

  const layers: Record<string, Manifest> = {};
  for (const result of results) {
    layers[result.sourceLayer.layer] = result.manifest;
  }

  const cityManifest = {
    diamond_mode: true,
    scope: 'municipal_base',
    country,
    region,
    municipality,
    bucket,
    generated_at: generatedAt,
    layers,
  };
  const cityManifestPath = path.join(cityDir, 'diamond-city-manifest.json');
  await writeFile(cityManifestPath, JSON.stringify(cityManifest, null, 2));

  if (!dryRun) {
    await uploadFile(`diamond/${country}/${region}/${municipality}/diamond-city-manifest.json`, cityManifestPath, 'application/json; charset=utf-8');
  }
}

async function uploadFile(key: string, filePath: string, contentType: string, contentEncoding?: string) {
  const size = (await stat(filePath)).size;
  console.log(`  uploading s3://${bucket}/${key}`);
  const uploader = new Upload({
    client: s3,
    queueSize: uploadConcurrency,
    leavePartsOnError: false,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
      ContentEncoding: contentEncoding,
      ContentLength: size,
      CacheControl: 'public, max-age=31536000, immutable',
    },
  });
  await uploader.done();
}

async function layerExistsInS3(source: SourceLayer) {
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: `diamond/${source.layer}/${source.country}/${source.region}/${source.municipality}/${source.layer}.pmtiles`,
    }));
    return true;
  } catch {
    return false;
  }
}

async function readExistingLocalResult(source: SourceLayer): Promise<BuildResult | null> {
  const manifestPath = path.join(outputRoot, source.country, source.region, source.municipality, source.layer, 'diamond-manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  return {
    manifest,
    sourceLayer: source,
    featureCount: Number(manifest.feature_count ?? 0),
    s3Prefix: `diamond/${source.layer}/${source.country}/${source.region}/${source.municipality}`,
  };
}

async function readFirstNdjsonRow(filePath: string) {
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    reader.close();
    return parseNdjsonLine(line) as Record<string, unknown>;
  }
  return null;
}

function parseNdjsonLine(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    return JSON.parse(line.replace(/\bNaN\b/g, 'null'));
  }
}

async function gzipFile(sourcePath: string, gzipPath: string) {
  await pipeline(createReadStream(sourcePath), createGzip({ level: 6 }), createWriteStream(gzipPath));
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function scanGeojsonBounds(filePath: string) {
  const payload = JSON.parse(await readFile(filePath, 'utf8')) as GeoJSON.FeatureCollection;
  const bounds = emptyBounds();
  let featureCount = 0;
  for (const feature of payload.features ?? []) {
    if (!feature.geometry) continue;
    featureCount += 1;
    extendBounds(bounds, feature.geometry as Geometry);
  }
  return { featureCount, bounds: finalizeBounds(bounds) };
}

function parseGeometry(value: unknown): Geometry | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const geometry = wkx.Geometry.parse(value).toGeoJSON() as Geometry;
    return geometry;
  } catch {
    return null;
  }
}

function normalizeGeometryForSource(source: SourceLayer, geometry: Geometry): Geometry {
  if (source.sourceId !== 'windsor_parcels') return geometry;
  return mapGeometryPositions(geometry, ([easting, northing]) => utmZone17NToLonLat(easting, northing));
}

function mapGeometryPositions<T extends Geometry>(geometry: T, mapper: (position: [number, number]) => [number, number]): T {
  const mapCoordinates = (value: unknown): unknown => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      return mapper([value[0], value[1]]);
    }
    if (Array.isArray(value)) return value.map(mapCoordinates);
    return value;
  };
  return {
    ...geometry,
    coordinates: mapCoordinates(geometry.coordinates),
  } as T;
}

function utmZone17NToLonLat(easting: number, northing: number): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lonOrigin = -81 * Math.PI / 180;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = easting - 500000;
  const y = northing;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const phi1 =
    mu +
    (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) +
    (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) +
    (151 * e1 ** 3 / 96) * Math.sin(6 * mu) +
    (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sinPhi1 ** 2);
  const r1 = a * (1 - e2) / (1 - e2 * sinPhi1 ** 2) ** 1.5;
  const t1 = tanPhi1 ** 2;
  const c1 = ep2 * cosPhi1 ** 2;
  const d = x / (n1 * k0);

  const lat =
    phi1 -
    (n1 * tanPhi1 / r1) *
      (d ** 2 / 2 -
        (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24 +
        (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720);
  const lon =
    lonOrigin +
    (d -
      (1 + 2 * t1 + c1) * d ** 3 / 6 +
      (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) /
      cosPhi1;

  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

function inferLayer(sourceId: string): LayerName | null {
  if (layerOverrides[sourceId]) return layerOverrides[sourceId];
  if (sourceId.endsWith('_addresses')) return 'addresses';
  if (sourceId.endsWith('_buildings')) return 'buildings';
  if (sourceId.endsWith('_parcels') || sourceId.includes('_parcel')) return 'parcels';
  return null;
}

function floridaLayer(datasetType: string): LayerName | null {
  if (datasetType === 'address' || datasetType === 'property_point') return 'addresses';
  if (datasetType === 'building') return 'buildings';
  if (datasetType === 'parcel_property') return 'parcels';
  return null;
}

function municipalityFromSourceId(sourceId: string) {
  return normalizeMunicipality(sourceId
    .replace(/_v2$/, '')
    .replace(/_addresses$/, '')
    .replace(/_buildings$/, '')
    .replace(/_parcels$/, '')
    .replace(/_parcel_fabric_public$/, '')
    .replace(/_property_parcels$/, '')
    .replace(/_property$/, ''));
}

function floridaMunicipalityFromSourceId(sourceId: string) {
  return normalizeMunicipality(sourceId
    .replace(/^fl_/, '')
    .replace(/_addresses_gdb$/, '')
    .replace(/_addresses$/, '')
    .replace(/_buildings$/, '')
    .replace(/_parcels_property_appraiser$/, '')
    .replace(/_parcels_taxroll$/, '')
    .replace(/_parcel_boundary$/, '')
    .replace(/_parcel_centroids$/, '')
    .replace(/_parcels$/, '')
    .replace(/_property_points$/, '')
    .replace(/_situs_addresses$/, '')
    .replace(/_pao$/, '')
    .replace(/_bcpa$/, '')
    .replace(/_ocpa$/, '')
    .replace(/_pa$/, ''));
}

function normalizeMunicipality(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeRegion(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ontario') return 'on';
  if (normalized === 'alberta') return 'ab';
  if (normalized === 'florida') return 'fl';
  return normalized;
}

function normalizeCountry(value: string | null | undefined): 'canada' | 'usa' {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'us' || normalized === 'usa' || normalized === 'united states' ? 'usa' : 'canada';
}

function layerMinzoom(layer: LayerName) {
  if (minzoomOverride) return Number(minzoomOverride);
  return layer === 'buildings' ? 12 : 10;
}

function layerMaxzoom(layer: LayerName) {
  if (maxzoomOverride) return Number(maxzoomOverride);
  return layer === 'buildings' ? 18 : 16;
}

function promoteIdForLayer(layer: LayerName) {
  if (layer === 'addresses') return 'address_id';
  if (layer === 'buildings') return 'building_id';
  return 'parcel_id';
}

function fieldsForLayer(layer: LayerName) {
  if (layer === 'addresses') {
    return {
      address_id: 'String',
      source_id: 'String',
      source: 'String',
      municipality: 'String',
      region: 'String',
      province: 'String',
      country: 'String',
      full_address: 'String',
      street_number: 'String',
      street_name: 'String',
      unit: 'String',
      postal_code: 'String',
      precision: 'String',
      address_type: 'String',
    };
  }
  if (layer === 'buildings') {
    return {
      building_id: 'String',
      gers_id: 'String',
      source_id: 'String',
      source: 'String',
      municipality: 'String',
      region: 'String',
      province: 'String',
      country: 'String',
      height: 'Number',
      floors: 'Number',
      building_type: 'String',
      subtype: 'String',
      area_sqm: 'Number',
    };
  }
  return {
    parcel_id: 'String',
    source_id: 'String',
    source: 'String',
    municipality: 'String',
    region: 'String',
    province: 'String',
    country: 'String',
    address: 'String',
    street_number: 'String',
    street_name: 'String',
    postal_code: 'String',
    zoning: 'String',
    area_sqm: 'Number',
  };
}

function isLayerGeometry(layer: LayerName, geometry: GeoJSON.Geometry): geometry is Geometry {
  if (layer === 'addresses') return geometry.type === 'Point' || geometry.type === 'MultiPoint';
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
}

function emptyBounds() {
  return {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  };
}

function extendBounds(bounds: ReturnType<typeof emptyBounds>, geometry: Geometry) {
  visitPositions(geometry.coordinates, ([lon, lat]) => {
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
  });
}

function finalizeBounds(bounds: ReturnType<typeof emptyBounds>): Bounds {
  if (![bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].every(Number.isFinite)) {
    throw new Error('Unable to calculate bounds.');
  }
  return [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat];
}

function visitPositions(value: unknown, visitor: (position: [number, number]) => void) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor([value[0], value[1]]);
    return;
  }
  for (const child of value) visitPositions(child, visitor);
}

async function closeWriter(writer: ReturnType<typeof createWriteStream>) {
  await new Promise<void>((resolve, reject) => {
    writer.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
  ) as T;
}

function pickString(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(properties[key]);
    if (value) return value;
  }
  return null;
}

function pickNumber(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = numberValue(properties[key]);
    if (value !== null) return value;
  }
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
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

function arcgisLike(value: string | null) {
  return value && /arcgis|featureserver|mapserver/i.test(value) ? value : undefined;
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
