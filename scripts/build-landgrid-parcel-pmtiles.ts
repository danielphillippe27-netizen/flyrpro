#!/usr/bin/env tsx
/**
 * Build state-sharded PMTiles from the LandRecords/Regrid parcel gold NDJSON.
 *
 * This script intentionally leaves gold-standard data untouched. It reads the
 * canonical NDJSON files and writes derived map artifacts beside them under a
 * separate tiles/ namespace:
 *
 *   gold-standard/us/tx/tx_parcels/20260504/tx_parcels_gold.ndjson
 *   tiles/us/tx/tx_parcels/20260504/tx_parcels.pmtiles
 *   tiles/us/tx/tx_parcels/20260504/tx_parcels.json
 *
 * Examples:
 *   npx tsx scripts/build-landgrid-parcel-pmtiles.ts --states=DC
 *   npx tsx scripts/build-landgrid-parcel-pmtiles.ts --states=TX --upload
 *   npx tsx scripts/build-landgrid-parcel-pmtiles.ts --all --upload
 */

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import regionBounds from './regions.json';

type BBox = [number, number, number, number];

type StateConfig = {
  code: string;
  name: string;
  fips: string;
  bbox: BBox;
};

type Options = {
  all: boolean;
  bucket: string;
  datePart: string;
  dryRun: boolean;
  forceUpload: boolean;
  goldDir: string;
  limit: number | null;
  maxzoom: number;
  minzoom: number;
  noBuild: boolean;
  outDir: string;
  overwrite: boolean;
  states: string[];
  tippecanoeBin: string;
  upload: boolean;
  uploadConcurrency: number;
};

type ParcelGoldRow = {
  external_id?: string | number | null;
  geometry?: GeoJSON.Geometry | string | null;
  properties?: Record<string, unknown> | null;
};

type BuildResult = ReturnType<typeof stateOutput> & {
  rowCount: number | null;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
};

const DEFAULT_ROOT =
  '/Volumes/Samsung SSD/municipal_data/kagglehub_cache/datasets/landrecordsus/us-parcel-layer/versions/1';
const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const SOURCE_ID_SUFFIX = 'parcels';
const SOURCE_LABEL = 'landrecords_us_2026_q1';

const STATE_FIPS: Record<string, string> = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  DC: '11',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56',
};

const US_STATES = new Map<string, StateConfig>(
  regionBounds
    .filter((row) => row.country === 'US')
    .map((row): [string, StateConfig] => {
      const code = row.code.trim().toUpperCase();
      return [
        code,
        {
          code,
          name: row.name,
          fips: STATE_FIPS[code],
          bbox: row.bbox as BBox,
        },
      ];
    })
    .filter(([, state]) => Boolean(state.fips))
);

main().catch((error) => {
  console.error('Parcel PMTiles build failed:', error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedStates = resolveStates(options);

  console.log('Landgrid parcel PMTiles build');
  console.log(`  Gold dir:   ${options.goldDir}`);
  console.log(`  Tiles dir:  ${options.outDir}`);
  console.log(`  S3 bucket:  ${options.bucket}`);
  console.log(`  Date part:  ${options.datePart}`);
  console.log(`  Zooms:      ${options.minzoom}-${options.maxzoom}`);
  console.log(`  States:     ${selectedStates.map((state) => state.code).join(', ')}`);
  if (options.limit !== null) console.log(`  Limit:      ${options.limit.toLocaleString()} row(s) per state`);
  if (options.upload) console.log('  Upload:     enabled');
  if (options.dryRun) console.log('  Dry run:    enabled');

  const outputs: BuildResult[] = [];
  for (const state of selectedStates) {
    outputs.push(await buildStateTiles(state, options));
  }

  if (options.upload) {
    await uploadOutputs(outputs, options);
  }
}

async function buildStateTiles(state: StateConfig, options: Options): Promise<BuildResult> {
  const output = stateOutput(state, options);

  console.log(`\n${state.code} ${state.name}`);
  console.log(`  Gold:    ${output.goldPath}`);
  console.log(`  PMTiles: ${output.pmtilesPath}`);
  console.log(`  S3:      s3://${options.bucket}/${output.pmtilesKey}`);

  if (!existsSync(output.goldPath)) {
    throw new Error(`Missing gold NDJSON for ${state.code}: ${output.goldPath}`);
  }

  if (options.dryRun) {
    return {
      ...output,
      rowCount: null,
      pmtilesSizeBytes: 0,
      pmtilesSha256: '',
    };
  }

  await mkdir(path.dirname(output.pmtilesPath), { recursive: true });

  let rowCount: number | null = null;
  if (options.noBuild) {
    if (!existsSync(output.pmtilesPath)) {
      throw new Error(`--no-build requested but PMTiles does not exist: ${output.pmtilesPath}`);
    }
    console.log('  Build: skipped; using existing PMTiles.');
  } else if (existsSync(output.pmtilesPath) && !options.overwrite) {
    console.log('  Build: skipped; output exists. Use --overwrite to rebuild.');
  } else {
    rowCount = await runTippecanoeFromGold(output.goldPath, output.pmtilesPath, state, options);
  }

  const pmtilesStats = await stat(output.pmtilesPath);
  const pmtilesSha256 = await sha256File(output.pmtilesPath);
  await writeFile(
    output.tilejsonPath,
    JSON.stringify(
      buildTileJSON({
        state,
        sourceId: output.sourceId,
        pmtilesKey: output.pmtilesKey,
        pmtilesSizeBytes: pmtilesStats.size,
        pmtilesSha256,
        minzoom: options.minzoom,
        maxzoom: options.maxzoom,
      }),
      null,
      2
    )
  );

  console.log(`  Wrote ${(pmtilesStats.size / 1024 / 1024).toFixed(2)} MiB`);

  return {
    ...output,
    rowCount,
    pmtilesSizeBytes: pmtilesStats.size,
    pmtilesSha256,
  };
}

async function runTippecanoeFromGold(
  goldPath: string,
  pmtilesPath: string,
  state: StateConfig,
  options: Options
) {
  const args = [
    '--force',
    '--output',
    pmtilesPath,
    '--layer',
    'parcels',
    '--minimum-zoom',
    String(options.minzoom),
    '--maximum-zoom',
    String(options.maxzoom),
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '--detect-shared-borders',
    '--coalesce-densest-as-needed',
    '--no-feature-limit',
    '--no-tile-size-limit',
    '/dev/stdin',
  ];

  console.log(`  tippecanoe ${args.join(' ')}`);
  const child = spawn(options.tippecanoeBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const exitPromise = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tippecanoe exited with code ${code}`));
    });
  });

  const lines = createInterface({
    input: createReadStream(goldPath),
    crlfDelay: Infinity,
  });

  let rowCount = 0;
  let skipped = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (options.limit !== null && rowCount >= options.limit) break;

      const feature = parcelGoldLineToFeature(line, state);
      if (!feature) {
        skipped += 1;
        continue;
      }

      rowCount += 1;
      if (!child.stdin.write(`${JSON.stringify(feature)}\n`)) {
        await once(child.stdin, 'drain');
      }

      if (rowCount % 1_000_000 === 0) {
        console.log(`  Streamed ${rowCount.toLocaleString()} parcel feature(s)...`);
      }
    }
  } finally {
    lines.close();
    child.stdin.end();
  }

  await exitPromise;
  console.log(`  Streamed ${rowCount.toLocaleString()} parcel feature(s), skipped ${skipped.toLocaleString()}.`);
  return rowCount;
}

function parcelGoldLineToFeature(line: string, state: StateConfig): GeoJSON.Feature | null {
  const row = JSON.parse(line) as ParcelGoldRow;
  const geometry = normalizeGeometry(row.geometry);
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;

  const props = row.properties ?? {};
  const externalId = stringValue(row.external_id) ?? stringValue(props.parcelid) ?? stringValue(props.parcelid2);
  if (!externalId) return null;

  return {
    type: 'Feature',
    geometry,
    properties: pruneEmptyProperties({
      parcel_id: externalId,
      external_id: externalId,
      source: SOURCE_LABEL,
      source_id: `${state.code.toLowerCase()}_${SOURCE_ID_SUFFIX}`,
      state: state.code,
      statefp: stringValue(props.statefp) ?? state.fips,
      countyfp: stringValue(props.countyfp),
      geoid: stringValue(props.geoid),
      usecode: stringValue(props.usecode),
      usedesc: stringValue(props.usedesc),
      numbldgs: numberValue(props.numbldgs),
      numunits: numberValue(props.numunits),
      yearbuilt: numberValue(props.yearbuilt),
      bldgsqft: numberValue(props.bldgsqft),
      assdacres: numberValue(props.assdacres),
      parceladdr: stringValue(props.parceladdr),
      parcelcity: stringValue(props.parcelcity),
      parcelzip: stringValue(props.parcelzip),
      taxyear: stringValue(props.taxyear),
      updated: stringValue(props.updated),
    }),
  };
}

function normalizeGeometry(value: ParcelGoldRow['geometry']): GeoJSON.Geometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as GeoJSON.Geometry;
    } catch {
      return null;
    }
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pruneEmptyProperties(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function uploadOutputs(outputs: BuildResult[], options: Options) {
  let nextIndex = 0;
  const workerCount = Math.min(options.uploadConcurrency, outputs.length);
  console.log(`\nUpload concurrency: ${workerCount}`);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < outputs.length) {
        const output = outputs[nextIndex];
        nextIndex += 1;
        await uploadState(output, options);
      }
    })
  );
}

async function uploadState(output: BuildResult, options: Options) {
  const client = new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2',
  });

  const existing = options.forceUpload
    ? null
    : await getExistingObject(client, options.bucket, output.pmtilesKey);
  if (existing?.Metadata?.pmtiles_sha256 === output.pmtilesSha256) {
    console.log(`  ${output.state.code}: PMTiles upload skipped; matching object exists.`);
  } else {
    console.log(`  ${output.state.code}: uploading PMTiles ${(output.pmtilesSizeBytes / 1024 / 1024).toFixed(2)} MiB...`);
    const upload = new Upload({
      client,
      params: {
        Bucket: options.bucket,
        Key: output.pmtilesKey,
        Body: createReadStream(output.pmtilesPath),
        ContentType: 'application/vnd.pmtiles',
        ContentLength: output.pmtilesSizeBytes,
        CacheControl: 'public, max-age=31536000, immutable',
        Metadata: artifactMetadata(output, options),
      },
      queueSize: 4,
      partSize: 64 * 1024 * 1024,
    });
    await upload.done();
    console.log(`  ${output.state.code}: PMTiles upload complete.`);
  }

  await client.send(new PutObjectCommand({
    Bucket: options.bucket,
    Key: output.tilejsonKey,
    Body: await readFile(output.tilejsonPath),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'public, max-age=3600',
    Metadata: artifactMetadata(output, options),
  }));
  console.log(`  ${output.state.code}: TileJSON upload complete.`);
}

function artifactMetadata(output: BuildResult, options: Options) {
  return {
    source: SOURCE_LABEL,
    source_id: output.sourceId,
    state: output.state.code,
    state_fips: output.state.fips,
    generated_date: options.datePart,
    gold_key: output.goldKey,
    pmtiles_sha256: output.pmtilesSha256,
    row_count: output.rowCount === null ? '' : String(output.rowCount),
  };
}

async function getExistingObject(client: S3Client, bucket: string, key: string) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    return null;
  }
}

function stateOutput(state: StateConfig, options: Options) {
  const sourceId = `${state.code.toLowerCase()}_${SOURCE_ID_SUFFIX}`;
  const goldFilename = `${sourceId}_gold.ndjson`;
  const pmtilesFilename = `${sourceId}.pmtiles`;
  const tilejsonFilename = `${sourceId}.json`;
  return {
    state,
    sourceId,
    goldPath: path.join(options.goldDir, state.code.toLowerCase(), options.datePart, goldFilename),
    pmtilesPath: path.join(options.outDir, state.code.toLowerCase(), options.datePart, pmtilesFilename),
    tilejsonPath: path.join(options.outDir, state.code.toLowerCase(), options.datePart, tilejsonFilename),
    goldKey: `gold-standard/us/${state.code.toLowerCase()}/${sourceId}/${options.datePart}/${goldFilename}`,
    pmtilesKey: `tiles/us/${state.code.toLowerCase()}/${sourceId}/${options.datePart}/${pmtilesFilename}`,
    tilejsonKey: `tiles/us/${state.code.toLowerCase()}/${sourceId}/${options.datePart}/${tilejsonFilename}`,
  };
}

function buildTileJSON(input: {
  state: StateConfig;
  sourceId: string;
  pmtilesKey: string;
  pmtilesSizeBytes: number;
  pmtilesSha256: string;
  minzoom: number;
  maxzoom: number;
}) {
  return {
    tilejson: '3.0.0',
    name: `FLYR parcels ${input.state.code}`,
    scheme: 'xyz',
    vector_layers: [
      {
        id: 'parcels',
        fields: {
          parcel_id: 'String',
          external_id: 'String',
          source_id: 'String',
          state: 'String',
          statefp: 'String',
          countyfp: 'String',
          geoid: 'String',
          usecode: 'String',
          usedesc: 'String',
          parceladdr: 'String',
          parcelcity: 'String',
          parcelzip: 'String',
          assdacres: 'Number',
        },
      },
    ],
    bounds: input.state.bbox,
    minzoom: input.minzoom,
    maxzoom: input.maxzoom,
    attribution: 'LandRecords/Regrid via FLYR',
    metadata: {
      source: SOURCE_LABEL,
      source_id: input.sourceId,
      pmtiles_key: input.pmtilesKey,
      pmtiles_size_bytes: input.pmtilesSizeBytes,
      pmtiles_sha256: input.pmtilesSha256,
    },
  };
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function parseArgs(args: string[]): Options {
  const datePart = todayYmd();
  const options: Options = {
    all: false,
    bucket: process.env.PARCEL_TILE_BUCKET || process.env.PARCEL_BUCKET || DEFAULT_BUCKET,
    datePart,
    dryRun: false,
    forceUpload: false,
    goldDir: path.join(DEFAULT_ROOT, 'flyr_gold_exports', datePart),
    limit: null,
    maxzoom: 15,
    minzoom: 10,
    noBuild: false,
    outDir: path.join(DEFAULT_ROOT, 'flyr_tile_exports', datePart),
    overwrite: false,
    states: [],
    tippecanoeBin: process.env.TIPPECANOE_BIN || 'tippecanoe',
    upload: false,
    uploadConcurrency: 2,
  };

  for (const arg of args) {
    if (arg === '--all') options.all = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force-upload') options.forceUpload = true;
    else if (arg === '--no-build') options.noBuild = true;
    else if (arg === '--overwrite') options.overwrite = true;
    else if (arg === '--upload') options.upload = true;
    else if (arg.startsWith('--bucket=')) options.bucket = readValue(arg);
    else if (arg.startsWith('--date=')) options.datePart = readValue(arg);
    else if (arg.startsWith('--gold-dir=')) options.goldDir = readValue(arg);
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInteger(readValue(arg), '--limit');
    else if (arg.startsWith('--maxzoom=')) options.maxzoom = parseZoom(readValue(arg), '--maxzoom');
    else if (arg.startsWith('--minzoom=')) options.minzoom = parseZoom(readValue(arg), '--minzoom');
    else if (arg.startsWith('--out-dir=')) options.outDir = readValue(arg);
    else if (arg.startsWith('--states=')) {
      options.states = readValue(arg)
        .split(',')
        .map((state) => state.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg.startsWith('--tippecanoe-bin=')) options.tippecanoeBin = readValue(arg);
    else if (arg.startsWith('--upload-concurrency=')) {
      options.uploadConcurrency = parsePositiveInteger(readValue(arg), '--upload-concurrency');
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{8}$/.test(options.datePart)) {
    throw new Error(`--date must be YYYYMMDD, received ${options.datePart}`);
  }
  if (options.minzoom > options.maxzoom) {
    throw new Error('--minzoom must be less than or equal to --maxzoom.');
  }

  const defaultGoldPrefix = path.join(DEFAULT_ROOT, 'flyr_gold_exports');
  if (options.goldDir === path.join(defaultGoldPrefix, datePart)) {
    options.goldDir = path.join(defaultGoldPrefix, options.datePart);
  }
  const defaultTilePrefix = path.join(DEFAULT_ROOT, 'flyr_tile_exports');
  if (options.outDir === path.join(defaultTilePrefix, datePart)) {
    options.outDir = path.join(defaultTilePrefix, options.datePart);
  }

  return options;
}

function resolveStates(options: Options) {
  if (options.all && options.states.length > 0) {
    throw new Error('Use either --all or --states, not both.');
  }

  const stateCodes = options.all ? Array.from(US_STATES.keys()).sort() : options.states;
  if (stateCodes.length === 0) {
    throw new Error('Choose states with --states=OH,NY or build every state with --all.');
  }

  return stateCodes.map((code) => {
    const state = US_STATES.get(code);
    if (!state) throw new Error(`Unsupported state code: ${code}`);
    return state;
  });
}

function readValue(arg: string) {
  const index = arg.indexOf('=');
  return arg.slice(index + 1).trim();
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseZoom(value: string, label: string) {
  const parsed = parsePositiveInteger(value, label);
  if (parsed > 22) throw new Error(`${label} must be <= 22.`);
  return parsed;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function printUsageAndExit(): never {
  console.log(`
Usage:
  npx tsx scripts/build-landgrid-parcel-pmtiles.ts --states=DC
  npx tsx scripts/build-landgrid-parcel-pmtiles.ts --states=TX --upload
  npx tsx scripts/build-landgrid-parcel-pmtiles.ts --all --upload

Options:
  --gold-dir=/path/out        Root containing state/date *_gold.ndjson files
  --out-dir=/path/tiles       Local PMTiles output directory
  --date=YYYYMMDD             Partition date, default today
  --states=OH,NY              Comma-separated state codes
  --all                       Build every US state plus DC
  --limit=1000                Smoke-test feature limit per state
  --minzoom=10                Minimum zoom, default 10
  --maxzoom=15                Maximum zoom, default 15
  --upload                    Upload PMTiles and TileJSON to s3://bucket/tiles/...
  --no-build                  Upload or inspect existing local PMTiles
  --force-upload              Upload even when a matching S3 object exists
  --upload-concurrency=2      Number of state artifacts to upload at once
  --bucket=name               S3 bucket, default ${DEFAULT_BUCKET}
  --tippecanoe-bin=path       Tippecanoe executable, default tippecanoe
  --overwrite                 Regenerate existing local PMTiles
  --dry-run                   Print work without building/uploading
`);
  process.exit(0);
}
