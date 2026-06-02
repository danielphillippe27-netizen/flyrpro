#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles, tileIdToZxy, zxyToTileId, type Entry, type Header } from 'pmtiles';
import * as turf from '@turf/turf';
import duckdb from 'duckdb';

type Bounds = [number, number, number, number];

type CliOptions = {
  state?: string;
  all: boolean;
  version: string;
  promote: boolean;
  dryRun: boolean;
  keepWorkdir: boolean;
  maxZoom: number;
  minZoom: number;
  bucket: string;
  prefix: string;
  concurrency: number;
  workdir?: string;
  uploadExisting: boolean;
  strictMaxZoom: boolean;
  allowMissingRate: number;
  acceptedMissingReason?: string;
};

type BuildingRow = {
  building_id?: string | null;
  source_id?: string | null;
  subtype?: string | null;
  class?: string | null;
  height?: string | number | null;
  minx?: number | null;
  miny?: number | null;
  maxx?: number | null;
  maxy?: number | null;
  geometry_geojson?: string | null;
  properties_json?: string | null;
  source?: string | null;
  state?: string | null;
};

type SourceExport = {
  bounds: Bounds;
  sourceCount: number;
  sourceIdsPath: string;
  geojsonSeqPath: string;
};

type ValidationResult = {
  state: string;
  pmtilesPath: string;
  maxZoom: number;
  noDrop: boolean;
  sourceCount: number;
  pmtilesDecodedCount: number;
  missingIdsCount: number;
  extraIdsCount: number;
  missingIdsSample: string[];
  extraIdsSample: string[];
  sourceIdsHash: string;
  pmtilesIdsHash: string;
  pmtilesSizeBytes: number;
  decodedTilesWithData: number;
  maxTileFeatureCount: number;
  validationPassed: boolean;
  requiresSizeReview: boolean;
  strictMaxZoom: boolean;
  strict_max_zoom: boolean;
  accepted_lossy: boolean;
  acceptedMissingIds: boolean;
  acceptedMissingIdsCount: number;
  acceptedMissingRate: number;
  acceptedMissingRateLimit: number;
  acceptedMissingIdsSample: string[];
  acceptedMissingReason?: string;
  regressionChecks: RegressionResult[];
};

type RegressionResult = {
  name: string;
  expectedParquetBuildings: number;
  pmtilesBuildings: number;
  missingIdsCount: number;
  passed: boolean;
};

const DEFAULT_VERSION = '2026-06-buildings-z16';
const DEFAULT_BUCKET = process.env.DIAMOND_GEOMETRY_BUCKET || 'flyr-pro-addresses-2025';
const DEFAULT_PREFIX = 'bedrock/usa';
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const TIPPECANOE_BIN = process.env.TIPPECANOE_BIN || 'tippecanoe';
const PMTILES_TILE_FETCH_CONCURRENCY = Math.max(1, Number(process.env.PMTILES_VALIDATE_CONCURRENCY || 16));
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const REQUIRED_PROPERTIES = [
  'id',
  'building_id',
  'gers_id',
  'source_id',
  'height',
  'height_m',
  'subtype',
  'class',
  'source_region',
] as const;

const TEXAS_REGRESSIONS: Array<{ name: string; polygon: GeoJSON.Polygon; expected: number }> = [
  {
    name: 'Waco TX campaign polygon',
    expected: 33,
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [-97.16168409421796, 31.560202413646238],
        [-97.16244109920261, 31.561224597665742],
        [-97.16014392589851, 31.562258472936847],
        [-97.1594688007479, 31.561339463192297],
        [-97.16168409421796, 31.560202413646238],
      ]],
    },
  },
  {
    name: 'Dallas TX M Streets rectangle',
    expected: 135,
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [-96.77395, 32.82505],
        [-96.77395, 32.82745],
        [-96.77075, 32.82745],
        [-96.77075, 32.82505],
        [-96.77395, 32.82505],
      ]],
    },
  },
];

function parseArgs(): CliOptions {
  const options: CliOptions = {
    all: false,
    version: DEFAULT_VERSION,
    promote: false,
    dryRun: false,
    keepWorkdir: false,
    maxZoom: 16,
    minZoom: 12,
    bucket: DEFAULT_BUCKET,
    prefix: DEFAULT_PREFIX,
    concurrency: PMTILES_TILE_FETCH_CONCURRENCY,
    uploadExisting: false,
    strictMaxZoom: false,
    allowMissingRate: 0,
  };

  for (const arg of process.argv.slice(2)) {
    const [key, rawValue] = arg.split('=');
    const value = rawValue ?? '';
    if (key === '--state') options.state = value.toUpperCase();
    else if (key === '--all') options.all = true;
    else if (key === '--version') options.version = value;
    else if (key === '--promote') options.promote = true;
    else if (key === '--dry-run') options.dryRun = true;
    else if (key === '--keep-workdir') options.keepWorkdir = true;
    else if (key === '--max-zoom') options.maxZoom = Number(value);
    else if (key === '--min-zoom') options.minZoom = Number(value);
    else if (key === '--bucket') options.bucket = value;
    else if (key === '--prefix') options.prefix = value.replace(/^\/+|\/+$/g, '');
    else if (key === '--concurrency') options.concurrency = Math.max(1, Number(value));
    else if (key === '--workdir') options.workdir = value;
    else if (key === '--upload-existing') options.uploadExisting = true;
    else if (key === '--strict-max-zoom') options.strictMaxZoom = true;
    else if (key === '--allow-missing-rate') options.allowMissingRate = Number(value);
    else if (key === '--accepted-missing-reason') options.acceptedMissingReason = value;
    else if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.all && !options.state) throw new Error('Pass --state=TX or --all');
  if (options.all && options.state) throw new Error('Use either --state=TX or --all, not both');
  if (!Number.isFinite(options.maxZoom) || options.maxZoom < options.minZoom) {
    throw new Error(`Invalid zoom range: ${options.minZoom}-${options.maxZoom}`);
  }
  if (!Number.isFinite(options.allowMissingRate) || options.allowMissingRate < 0 || options.allowMissingRate > 1) {
    throw new Error(`Invalid --allow-missing-rate: ${options.allowMissingRate}`);
  }
  return options;
}

function printHelp() {
  console.log(`
Usage:
  npx tsx scripts/rebuild-bedrock-us-building-pmtiles.ts --state=TX [--promote]
  npx tsx scripts/rebuild-bedrock-us-building-pmtiles.ts --all --version=2026-06-buildings-z16

Options:
  --state=TX       Rebuild one state.
  --all            Rebuild every region in scripts/regions.json.
  --version=NAME   Version prefix under bedrock/usa/<version>.
  --promote        Copy passing artifacts into bedrock/usa/current.
  --dry-run        Count source buildings only; do not write PMTiles.
  --keep-workdir   Keep local temp files after completion.
  --workdir=PATH   Reuse an existing workdir containing STATE-source-ids.raw.txt and STATE-buildings.geojsonseq.
  --upload-existing
                  Upload STATE-validation.json + referenced PMTiles from --workdir without rebuilding.
  --strict-max-zoom
                  Retry only the requested --max-zoom, using no-drop as the final attempt.
  --allow-missing-rate=0.001
                  Treat missingIdsCount/sourceCount at or below this rate as accepted validation.
  --accepted-missing-reason=TEXT
                  Reason recorded in validation JSON when missing IDs are accepted.
`);
}

function jsonStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2
  );
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeProperty(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function normalizeFeature(row: BuildingRow): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (!row.geometry_geojson?.trim()) return null;

  let geometry: GeoJSON.Geometry;
  try {
    geometry = JSON.parse(row.geometry_geojson) as GeoJSON.Geometry;
  } catch {
    return null;
  }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return null;

  let properties: Record<string, unknown> = {};
  if (row.properties_json?.trim()) {
    try {
      properties = JSON.parse(row.properties_json) as Record<string, unknown>;
    } catch {
      properties = {};
    }
  }

  const buildingId = String(
    row.building_id ??
    properties.building_id ??
    properties.gers_id ??
    properties.id ??
    row.source_id ??
    ''
  ).trim();
  if (!buildingId) return null;

  const height = Math.max(
    numeric(row.height) ?? numeric(properties.height) ?? numeric(properties.height_m) ?? 10,
    10
  );

  const normalizedProperties: Record<string, unknown> = {
    id: buildingId,
    building_id: buildingId,
    gers_id: buildingId,
    source_id: safeProperty(row.source_id ?? properties.source_id),
    source: safeProperty(row.source ?? properties.source ?? 'Overture Maps Buildings'),
    source_region: safeProperty(row.state ?? properties.source_region ?? properties.state),
    subtype: safeProperty(row.subtype ?? properties.subtype),
    class: safeProperty(row.class ?? properties.class),
    height,
    height_m: height,
  };

  for (const key of REQUIRED_PROPERTIES) {
    if (!(key in normalizedProperties)) normalizedProperties[key] = null;
  }

  return {
    type: 'Feature',
    id: buildingId,
    geometry,
    properties: normalizedProperties,
  };
}

function parquetKeyForState(options: CliOptions, state: string) {
  return `${options.prefix}/current/buildings/parquet_by_state/state=${state}/buildings.spatial.parquet`;
}

function versionedStatePrefix(options: CliOptions, state: string) {
  return `${options.prefix}/${options.version}/buildings/pmtiles_by_state/state=${state}`;
}

function currentStatePrefix(options: CliOptions, state: string) {
  return `${options.prefix}/current/buildings/pmtiles_by_state/state=${state}`;
}

function s3Path(bucket: string, key: string) {
  return `s3://${bucket}/${key}`;
}

function runCommand(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: options.env ?? process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function openDuckDb() {
  const db = new duckdb.Database(':memory:');
  const all = (sql: string) =>
    new Promise<Record<string, unknown>[]>((resolve, reject) => {
      db.all(sql, (error: Error | null, rows: Record<string, unknown>[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });
  const run = (sql: string) =>
    new Promise<void>((resolve, reject) => {
      db.run(sql, (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  return { db, all, run };
}

async function setupDuckDb(run: (sql: string) => Promise<void>) {
  await run('INSTALL httpfs');
  await run('LOAD httpfs');
  await run(`SET s3_region=${sqlString(AWS_REGION)}`);
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    await run(`SET s3_access_key_id=${sqlString(process.env.AWS_ACCESS_KEY_ID)}`);
    await run(`SET s3_secret_access_key=${sqlString(process.env.AWS_SECRET_ACCESS_KEY)}`);
    if (process.env.AWS_SESSION_TOKEN) {
      await run(`SET s3_session_token=${sqlString(process.env.AWS_SESSION_TOKEN)}`);
    }
  } else {
    await run(
      `CREATE OR REPLACE SECRET flyr_bedrock_s3 (TYPE s3, PROVIDER credential_chain, REGION ${sqlString(AWS_REGION)})`
    );
  }
}

async function exportSource(options: CliOptions, state: string, workdir: string): Promise<SourceExport> {
  const { db, all, run } = openDuckDb();
  try {
    await setupDuckDb(run);
    const parquetPath = s3Path(options.bucket, parquetKeyForState(options, state));
    const summaryRows = await all(`
      SELECT
        COUNT(*) AS source_count,
        MIN(minx) AS minx,
        MIN(miny) AS miny,
        MAX(maxx) AS maxx,
        MAX(maxy) AS maxy
      FROM read_parquet(${sqlString(parquetPath)}, union_by_name=true)
      WHERE geometry_geojson IS NOT NULL
    `);
    const summary = summaryRows[0] ?? {};
    const sourceCount = Number(summary.source_count ?? 0);
    const bounds: Bounds = [
      Number(summary.minx),
      Number(summary.miny),
      Number(summary.maxx),
      Number(summary.maxy),
    ];
    if (!sourceCount || bounds.some((value) => !Number.isFinite(value))) {
      throw new Error(`No source buildings found for ${state}`);
    }

    const sourceIdsPath = path.join(workdir, `${state}-source-ids.raw.txt`);
    const geojsonSeqPath = path.join(workdir, `${state}-buildings.geojsonseq`);
    const idsStream = createWriteStream(sourceIdsPath);
    const geojsonStream = createWriteStream(geojsonSeqPath);

    let exported = 0;
    const query = `
      SELECT building_id, source_id, subtype, class, height, minx, miny, maxx, maxy,
        geometry_geojson, properties_json, source, state
      FROM read_parquet(${sqlString(parquetPath)}, union_by_name=true)
      WHERE geometry_geojson IS NOT NULL
    `;

    for await (const row of db.stream(query) as AsyncIterable<BuildingRow>) {
      const feature = normalizeFeature(row);
      if (!feature) continue;
      const id = String(feature.id ?? feature.properties?.building_id);
      idsStream.write(`${id}\n`);
      geojsonStream.write(`${JSON.stringify(feature)}\n`);
      exported += 1;
      if (exported % 250_000 === 0) console.log(`[${state}] exported ${exported.toLocaleString()} buildings`);
    }

    await Promise.all([
      new Promise<void>((resolve) => idsStream.end(resolve)),
      new Promise<void>((resolve) => geojsonStream.end(resolve)),
    ]);

    console.log(`[${state}] source buildings exported: ${exported.toLocaleString()}`);
    return { bounds, sourceCount: exported, sourceIdsPath, geojsonSeqPath };
  } finally {
    db.close();
  }
}

async function sourceSummary(options: CliOptions, state: string) {
  const { db, all, run } = openDuckDb();
  try {
    await setupDuckDb(run);
    const parquetPath = s3Path(options.bucket, parquetKeyForState(options, state));
    const rows = await all(`
      SELECT COUNT(*) AS source_count, MIN(minx) AS minx, MIN(miny) AS miny, MAX(maxx) AS maxx, MAX(maxy) AS maxy
      FROM read_parquet(${sqlString(parquetPath)}, union_by_name=true)
      WHERE geometry_geojson IS NOT NULL
    `);
    return rows[0] ?? {};
  } finally {
    db.close();
  }
}

async function buildPmtiles(options: CliOptions, source: SourceExport, state: string, workdir: string, maxZoom: number, noDrop: boolean) {
  const outputPath = path.join(workdir, `${state}-buildings-z${maxZoom}${noDrop ? '-nodrop' : ''}.pmtiles`);
  const tippecanoeTempDir = process.env.TIPPECANOE_TEMP_DIR || process.env.TMPDIR || workdir;
  const args = [
    '--force',
    '--output',
    outputPath,
    '--temporary-directory',
    tippecanoeTempDir,
    '--minimum-zoom',
    String(options.minZoom),
    '--maximum-zoom',
    String(maxZoom),
    '--buffer',
    '8',
    '--no-clipping',
    '--layer',
    'buildings',
  ];

  if (noDrop) {
    args.push('--no-feature-limit', '--no-tile-size-limit');
  } else {
    args.push('--drop-densest-as-needed', '--extend-zooms-if-still-dropping');
  }

  args.push(source.geojsonSeqPath);
  await runCommand(TIPPECANOE_BIN, args);
  return outputPath;
}

class LocalRangeSource {
  private fileHandle: Promise<FileHandle> | null = null;
  constructor(private readonly filePath: string) {}
  getKey() {
    return this.filePath;
  }
  async getBytes(offset: number, length: number) {
    if (!this.fileHandle) this.fileHandle = open(this.filePath, 'r');
    const handle = await this.fileHandle;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const usable = buffer.subarray(0, bytesRead);
    return {
      data: usable.buffer.slice(usable.byteOffset, usable.byteOffset + usable.byteLength),
      etag: undefined,
    };
  }
  async close() {
    if (!this.fileHandle) return;
    const handle = await this.fileHandle;
    this.fileHandle = null;
    await handle.close();
  }
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const clampedLat = Math.max(Math.min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function tileRangeForBounds(bounds: Bounds, z: number) {
  const nw = lonLatToTile(bounds[0], bounds[3], z);
  const se = lonLatToTile(bounds[2], bounds[1], z);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y),
  };
}

async function forEachWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function decodePmtilesIds(options: CliOptions, pmtilesPath: string, bounds: Bounds, maxZoom: number, outputPath: string) {
  const source = new LocalRangeSource(pmtilesPath);
  const archive = new PMTiles(source as never);
  try {
    const header = await archive.getHeader();
    const decodeZoom = Math.min(maxZoom, header.maxZoom);
    if (header.specVersion >= 3) {
      return await decodePmtilesIdsFromDirectory(options, source, archive, header, decodeZoom, outputPath);
    }

    const range = tileRangeForBounds(bounds, decodeZoom);
    const tileCoords: Array<{ x: number; y: number }> = [];
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        tileCoords.push({ x, y });
      }
    }

    const ids = createWriteStream(outputPath);
    let decodedTilesWithData = 0;
    let maxTileFeatureCount = 0;
    let checked = 0;

    await forEachWithConcurrency(tileCoords, options.concurrency, async ({ x, y }) => {
      const tile = await archive.getZxy(decodeZoom, x, y);
      checked += 1;
      if (checked % 5_000 === 0) {
        console.log(`decoded ${checked.toLocaleString()}/${tileCoords.length.toLocaleString()} z${decodeZoom} tiles`);
      }
      if (!tile?.data) return;
      decodedTilesWithData += 1;
      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layer = vectorTile.layers.buildings;
      if (!layer) return;
      maxTileFeatureCount = Math.max(maxTileFeatureCount, layer.length);
      for (let index = 0; index < layer.length; index += 1) {
        const properties = layer.feature(index).properties ?? {};
        const id = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
        if (id) ids.write(`${id}\n`);
      }
    });

    await new Promise<void>((resolve) => ids.end(resolve));
    return { decodedTilesWithData, maxTileFeatureCount };
  } finally {
    await source.close();
  }
}

function tileEntryTouchesZoom(entry: Entry, zoom: number) {
  const zoomStart = zxyToTileId(zoom, 0, 0);
  const zoomEnd = zoomStart + (2 ** zoom) ** 2 - 1;
  const entryStart = entry.tileId;
  const entryEnd = entry.tileId + Math.max(1, entry.runLength) - 1;
  return entryStart <= zoomEnd && entryEnd >= zoomStart;
}

async function collectPmtilesDataEntries(archive: PMTiles, header: Header, zoom: number) {
  const dataEntries: Entry[] = [];
  const visitedDirectories = new Set<string>();

  async function visitDirectory(offset: number, length: number) {
    const key = `${offset}:${length}`;
    if (visitedDirectories.has(key)) return;
    visitedDirectories.add(key);

    const directory = await archive.cache.getDirectory(archive.source, offset, length, header);
    for (const entry of directory) {
      if (entry.runLength === 0) {
        await visitDirectory(header.leafDirectoryOffset + entry.offset, entry.length);
        continue;
      }
      if (tileEntryTouchesZoom(entry, zoom)) {
        dataEntries.push(entry);
      }
    }
  }

  await visitDirectory(header.rootDirectoryOffset, header.rootDirectoryLength);
  return dataEntries;
}

async function decodePmtilesIdsFromDirectory(
  options: CliOptions,
  source: LocalRangeSource,
  archive: PMTiles,
  header: Header,
  decodeZoom: number,
  outputPath: string,
) {
  const tileEntries = await collectPmtilesDataEntries(archive, header, decodeZoom);
  console.log(`decoding ${tileEntries.length.toLocaleString()} z${decodeZoom} PMTiles data entries`);

  const ids = createWriteStream(outputPath);
  let decodedTilesWithData = 0;
  let maxTileFeatureCount = 0;
  let checked = 0;

  await forEachWithConcurrency(tileEntries, options.concurrency, async (entry) => {
    const [entryZoom] = tileIdToZxy(entry.tileId);
    if (entryZoom !== decodeZoom && !tileEntryTouchesZoom(entry, decodeZoom)) return;

    const tile = await source.getBytes(header.tileDataOffset + entry.offset, entry.length);
    checked += 1;
    if (checked % 1_000 === 0) {
      console.log(`decoded ${checked.toLocaleString()}/${tileEntries.length.toLocaleString()} z${decodeZoom} PMTiles data entries`);
    }

    const decompressed = await archive.decompress(tile.data, header.tileCompression);
    decodedTilesWithData += 1;
    const vectorTile = new VectorTile(new Pbf(Buffer.from(decompressed)));
    const layer = vectorTile.layers.buildings;
    if (!layer) return;
    maxTileFeatureCount = Math.max(maxTileFeatureCount, layer.length);
    for (let index = 0; index < layer.length; index += 1) {
      const properties = layer.feature(index).properties ?? {};
      const id = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
      if (id) ids.write(`${id}\n`);
    }
  });

  await new Promise<void>((resolve) => ids.end(resolve));
  return { decodedTilesWithData, maxTileFeatureCount };
}

async function sortUnique(input: string, output: string) {
  await runCommand('sort', ['-u', input, '-o', output], { env: { ...process.env, LC_ALL: 'C' } });
}

async function diffFiles(left: string, right: string, output: string, mode: '-23' | '-13') {
  const out = createWriteStream(output);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('comm', [mode, left, right], {
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.pipe(out);
    child.on('error', reject);
    child.on('exit', (code) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`comm exited with code ${code}`));
    });
  });
}

async function fileSha256(filePath: string) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function countLines(filePath: string) {
  let count = 0;
  const stream = createReadStream(filePath, 'utf8');
  for await (const chunk of stream) {
    count += String(chunk).split('\n').length - 1;
  }
  return count;
}

async function readSample(filePath: string, limit = 25) {
  const text = await readFile(filePath, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).slice(0, limit);
}

async function validatePmtiles(
  options: CliOptions,
  state: string,
  source: SourceExport,
  pmtilesPath: string,
  workdir: string,
  maxZoom: number,
  noDrop: boolean
): Promise<ValidationResult> {
  const sourceSorted = path.join(workdir, `${state}-source-ids.sorted.txt`);
  const pmtilesRaw = path.join(workdir, `${state}-pmtiles-ids.raw.txt`);
  const pmtilesSorted = path.join(workdir, `${state}-pmtiles-ids.sorted.txt`);
  const missingPath = path.join(workdir, `${state}-missing-ids.txt`);
  const extraPath = path.join(workdir, `${state}-extra-ids.txt`);

  await sortUnique(source.sourceIdsPath, sourceSorted);
  const decodeStats = await decodePmtilesIds(options, pmtilesPath, source.bounds, maxZoom, pmtilesRaw);
  await sortUnique(pmtilesRaw, pmtilesSorted);
  await diffFiles(sourceSorted, pmtilesSorted, missingPath, '-23');
  await diffFiles(pmtilesSorted, sourceSorted, extraPath, '-23');

  const [sourceCount, pmtilesDecodedCount, missingIdsCount, extraIdsCount, sourceIdsHash, pmtilesIdsHash, pmtilesFile] =
    await Promise.all([
      countLines(sourceSorted),
      countLines(pmtilesSorted),
      countLines(missingPath),
      countLines(extraPath),
      fileSha256(sourceSorted),
      fileSha256(pmtilesSorted),
      stat(pmtilesPath),
    ]);

  const regressionChecks = state === 'TX'
    ? await runTexasRegressions(pmtilesPath, maxZoom)
    : [];
  const acceptedMissingRate = sourceCount > 0 ? missingIdsCount / sourceCount : 0;
  const acceptedMissingIds = missingIdsCount > 0
    && options.allowMissingRate > 0
    && acceptedMissingRate <= options.allowMissingRate;
  const regressionChecksPassed = regressionChecks.every((check) => check.passed);
  const validationPassed = (missingIdsCount === 0 || acceptedMissingIds) && regressionChecksPassed;
  const missingIdsSample = await readSample(missingPath);
  const acceptedMissingReason = acceptedMissingIds
    ? options.acceptedMissingReason || `accepted z18 building miss rate <= ${options.allowMissingRate}`
    : undefined;

  return {
    state,
    pmtilesPath,
    maxZoom,
    noDrop,
    sourceCount,
    pmtilesDecodedCount,
    missingIdsCount,
    extraIdsCount,
    missingIdsSample,
    extraIdsSample: await readSample(extraPath),
    sourceIdsHash,
    pmtilesIdsHash,
    pmtilesSizeBytes: pmtilesFile.size,
    decodedTilesWithData: decodeStats.decodedTilesWithData,
    maxTileFeatureCount: decodeStats.maxTileFeatureCount,
    validationPassed,
    requiresSizeReview: noDrop && missingIdsCount === 0 && !options.strictMaxZoom,
    strictMaxZoom: options.strictMaxZoom,
    strict_max_zoom: options.strictMaxZoom,
    accepted_lossy: acceptedMissingIds,
    acceptedMissingIds,
    acceptedMissingIdsCount: acceptedMissingIds ? missingIdsCount : 0,
    acceptedMissingRate,
    acceptedMissingRateLimit: options.allowMissingRate,
    acceptedMissingIdsSample: acceptedMissingIds ? missingIdsSample : [],
    acceptedMissingReason,
    regressionChecks,
  };
}

async function runTexasRegressions(pmtilesPath: string, maxZoom: number): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];
  for (const regression of TEXAS_REGRESSIONS) {
    const bbox = turf.bbox(regression.polygon) as Bounds;
    const ids = await idsFromPmtilesPolygon(pmtilesPath, bbox, regression.polygon, maxZoom);
    results.push({
      name: regression.name,
      expectedParquetBuildings: regression.expected,
      pmtilesBuildings: ids.size,
      missingIdsCount: Math.max(0, regression.expected - ids.size),
      passed: ids.size === regression.expected,
    });
  }
  return results;
}

async function idsFromPmtilesPolygon(pmtilesPath: string, bbox: Bounds, polygon: GeoJSON.Polygon, maxZoom: number) {
  const source = new LocalRangeSource(pmtilesPath);
  const archive = new PMTiles(source as never);
  try {
    const header = await archive.getHeader();
    const z = Math.min(maxZoom, header.maxZoom);
    const range = tileRangeForBounds(bbox, z);
    const ids = new Set<string>();
    const polygonFeature = turf.feature(polygon);

    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const tile = await archive.getZxy(z, x, y);
        if (!tile?.data) continue;
        const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
        const layer = vectorTile.layers.buildings;
        if (!layer) continue;
        for (let index = 0; index < layer.length; index += 1) {
          const vectorFeature = layer.feature(index);
          const feature = vectorFeature.toGeoJSON(x, y, z) as GeoJSON.Feature;
          if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
          if (!turf.booleanIntersects(feature as GeoJSON.Feature<GeoJSON.Geometry>, polygonFeature)) continue;
          const properties = feature.properties ?? {};
          const id = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
          if (id) ids.add(id);
        }
      }
    }
    return ids;
  } finally {
    await source.close();
  }
}

function tileJsonForState(options: CliOptions, state: string, maxZoom: number) {
  const key = `${versionedStatePrefix(options, state)}/buildings.pmtiles`;
  return {
    tilejson: '3.0.0',
    name: `Bedrock USA Buildings ${state}`,
    scheme: 'xyz',
    minzoom: options.minZoom,
    maxzoom: maxZoom,
    vector_layers: [
      {
        id: 'buildings',
        fields: Object.fromEntries(REQUIRED_PROPERTIES.map((property) => [property, 'String'])),
      },
    ],
    metadata: {
      geometry_provider: 'pmtiles_static',
      pmtiles_key: key,
      source_parquet_key: parquetKeyForState(options, state),
      generated_at: new Date().toISOString(),
    },
  };
}

const S3_SINGLE_PUT_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const S3_MULTIPART_PART_BYTES = 128 * 1024 * 1024;
const S3_MULTIPART_UPLOAD_CONCURRENCY = Math.max(
  1,
  Number(process.env.S3_MULTIPART_UPLOAD_CONCURRENCY || 4)
);
const S3_MULTIPART_UPLOAD_RETRIES = Math.max(
  1,
  Number(process.env.S3_MULTIPART_UPLOAD_RETRIES || 5)
);

async function uploadArtifact(client: S3Client, bucket: string, key: string, filePath: string, contentType: string) {
  const { size } = await stat(filePath);
  if (size >= S3_SINGLE_PUT_LIMIT_BYTES) {
    await uploadArtifactMultipart(client, bucket, key, filePath, contentType, size);
    return;
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: contentType,
  }));
  console.log(`uploaded s3://${bucket}/${key}`);
}

async function uploadArtifactMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
  size: number
) {
  const createResult = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  }));
  const uploadId = createResult.UploadId;
  if (!uploadId) throw new Error(`S3 did not return an upload ID for s3://${bucket}/${key}`);

  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  const totalParts = Math.ceil(size / S3_MULTIPART_PART_BYTES);
  console.log(
    `multipart upload s3://${bucket}/${key} (${totalParts} parts, ${size} bytes, concurrency=${S3_MULTIPART_UPLOAD_CONCURRENCY})`
  );

  try {
    let nextPartIndex = 0;
    let completedParts = 0;
    const workerCount = Math.min(S3_MULTIPART_UPLOAD_CONCURRENCY, totalParts);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextPartIndex < totalParts) {
        const index = nextPartIndex;
        nextPartIndex += 1;
        const partNumber = index + 1;
        const start = index * S3_MULTIPART_PART_BYTES;
        const end = Math.min(start + S3_MULTIPART_PART_BYTES, size) - 1;
        const result = await uploadPartWithRetry(client, bucket, key, uploadId, partNumber, filePath, start, end);
        if (!result.ETag) throw new Error(`S3 did not return an ETag for part ${partNumber}`);
        parts.push({ ETag: result.ETag, PartNumber: partNumber });
        completedParts += 1;
        if (completedParts === 1 || completedParts === totalParts || completedParts % 10 === 0) {
          console.log(`uploaded ${completedParts}/${totalParts} parts for s3://${bucket}/${key}`);
        }
      }
    }));

    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
    }));
    console.log(`uploaded s3://${bucket}/${key}`);
  } catch (error) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    })).catch((abortError) => {
      console.warn(`failed to abort multipart upload for s3://${bucket}/${key}`, abortError);
    });
    throw error;
  }
}

async function uploadPartWithRetry(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  filePath: string,
  start: number,
  end: number
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= S3_MULTIPART_UPLOAD_RETRIES; attempt += 1) {
    try {
      return await client.send(new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: createReadStream(filePath, { start, end }),
      }));
    } catch (error) {
      lastError = error;
      if (attempt === S3_MULTIPART_UPLOAD_RETRIES) break;
      const delayMs = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      console.warn(
        `retrying part ${partNumber} for s3://${bucket}/${key} after ${delayMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promoteArtifact(client: S3Client, bucket: string, fromKey: string, toKey: string, contentType?: string) {
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: fromKey }));
  const size = Number(head.ContentLength ?? 0);
  if (size > 5 * 1024 * 1024 * 1024) {
    await multipartCopyArtifact(client, bucket, fromKey, toKey, size, contentType);
    return;
  }

  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: toKey,
    CopySource: `${bucket}/${fromKey}`,
    ContentType: contentType,
    MetadataDirective: contentType ? 'REPLACE' : undefined,
  }));
  console.log(`promoted s3://${bucket}/${fromKey} -> s3://${bucket}/${toKey}`);
}

async function multipartCopyArtifact(
  client: S3Client,
  bucket: string,
  fromKey: string,
  toKey: string,
  size: number,
  contentType?: string
) {
  const totalParts = Math.ceil(size / S3_MULTIPART_PART_BYTES);
  const createResult = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: toKey,
    ContentType: contentType,
  }));
  if (!createResult.UploadId) throw new Error(`S3 did not return an upload id for multipart copy s3://${bucket}/${toKey}`);

  const uploadId = createResult.UploadId;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  let completedParts = 0;
  console.log(
    `multipart copy s3://${bucket}/${fromKey} -> s3://${bucket}/${toKey} (${totalParts} parts, ${size} bytes, concurrency=${S3_MULTIPART_UPLOAD_CONCURRENCY})`
  );

  try {
    const workerCount = Math.min(S3_MULTIPART_UPLOAD_CONCURRENCY, totalParts);
    let nextPartIndex = 0;
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextPartIndex < totalParts) {
        const index = nextPartIndex;
        nextPartIndex += 1;
        const partNumber = index + 1;
        const start = index * S3_MULTIPART_PART_BYTES;
        const end = Math.min(start + S3_MULTIPART_PART_BYTES, size) - 1;
        const result = await uploadPartCopyWithRetry(client, bucket, fromKey, toKey, uploadId, partNumber, start, end);
        const etag = result.CopyPartResult?.ETag;
        if (!etag) throw new Error(`S3 did not return an ETag for copied part ${partNumber}`);
        parts.push({ ETag: etag, PartNumber: partNumber });
        completedParts += 1;
        if (completedParts === 1 || completedParts === totalParts || completedParts % 10 === 0) {
          console.log(`copied ${completedParts}/${totalParts} parts for s3://${bucket}/${toKey}`);
        }
      }
    }));

    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: toKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
    }));
    console.log(`promoted s3://${bucket}/${fromKey} -> s3://${bucket}/${toKey}`);
  } catch (error) {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: toKey,
      UploadId: uploadId,
    })).catch((abortError) => {
      console.warn(`failed to abort multipart copy for s3://${bucket}/${toKey}`, abortError);
    });
    throw error;
  }
}

async function uploadPartCopyWithRetry(
  client: S3Client,
  bucket: string,
  fromKey: string,
  toKey: string,
  uploadId: string,
  partNumber: number,
  start: number,
  end: number
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= S3_MULTIPART_UPLOAD_RETRIES; attempt += 1) {
    try {
      return await client.send(new UploadPartCopyCommand({
        Bucket: bucket,
        Key: toKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        CopySource: `${bucket}/${fromKey}`,
        CopySourceRange: `bytes=${start}-${end}`,
      }));
    } catch (error) {
      lastError = error;
      if (attempt === S3_MULTIPART_UPLOAD_RETRIES) break;
      const delayMs = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      console.warn(
        `retrying copied part ${partNumber} for s3://${bucket}/${toKey} after ${delayMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function uploadAndMaybePromote(
  options: CliOptions,
  state: string,
  validation: ValidationResult,
  workdir: string
) {
  if (!validation.validationPassed) {
    console.warn(`[${state}] validation failed; skipping upload/promote`);
    return;
  }

  const client = new S3Client({ region: AWS_REGION });
  const versionPrefix = versionedStatePrefix(options, state);
  const currentPrefix = currentStatePrefix(options, state);
  const pmtilesKey = `${versionPrefix}/buildings.pmtiles`;
  const validationKey = `${versionPrefix}/buildings.validation.json`;
  const tileJsonKey = `${versionPrefix}/buildings.json`;
  const validationPath = path.join(workdir, `${state}-validation.json`);
  const tileJsonPath = path.join(workdir, `${state}-buildings.json`);

  await writeFile(validationPath, JSON.stringify(validation, null, 2));
  await writeFile(tileJsonPath, JSON.stringify(tileJsonForState(options, state, validation.maxZoom), null, 2));
  await uploadArtifact(client, options.bucket, pmtilesKey, validation.pmtilesPath, 'application/vnd.pmtiles');
  await uploadArtifact(client, options.bucket, validationKey, validationPath, 'application/json');
  await uploadArtifact(client, options.bucket, tileJsonKey, tileJsonPath, 'application/json');

  if (validation.requiresSizeReview) {
    console.warn(`[${state}] no-drop PMTiles passed ID validation but requires size review; skipping promotion`);
    return;
  }

  if (options.promote) {
    await promoteArtifact(client, options.bucket, pmtilesKey, `${currentPrefix}/buildings.pmtiles`, 'application/vnd.pmtiles');
    await promoteArtifact(client, options.bucket, validationKey, `${currentPrefix}/buildings.validation.json`, 'application/json');
    await promoteArtifact(client, options.bucket, tileJsonKey, `${currentPrefix}/buildings.json`, 'application/json');
  }
}

async function rebuildState(options: CliOptions, state: string) {
  const workdir = await createWorkdir(options, state);
  console.log(`[${state}] workdir: ${workdir}`);
  try {
    if (options.dryRun) {
      const summary = await sourceSummary(options, state);
      console.log(jsonStringify({ state, dryRun: true, source: summary }));
      return { state, dryRun: true, source: summary };
    }

    if (options.uploadExisting) {
      if (!options.workdir) throw new Error('--upload-existing requires --workdir=PATH');
      const validationPath = path.join(workdir, `${state}-validation.json`);
      const validation = JSON.parse(await readFile(validationPath, 'utf8')) as ValidationResult;
      console.log(`[${state}] uploading existing validated artifact ${validation.pmtilesPath}`);
      await uploadAndMaybePromote(options, state, validation, workdir);
      return validation;
    }

    const source = options.workdir
      ? await sourceFromWorkdir(options, state, workdir)
      : await exportSource(options, state, workdir);
    const attempts = options.strictMaxZoom
      ? [
          { maxZoom: options.maxZoom, noDrop: false },
          { maxZoom: options.maxZoom, noDrop: true },
        ]
      : [
          { maxZoom: options.maxZoom, noDrop: false },
          { maxZoom: Math.max(options.maxZoom + 1, 17), noDrop: false },
          { maxZoom: Math.max(options.maxZoom + 1, 17), noDrop: true },
        ];

    let finalValidation: ValidationResult | null = null;
    for (const attempt of attempts) {
      console.log(`[${state}] building PMTiles z${attempt.maxZoom}${attempt.noDrop ? ' no-drop' : ''}`);
      const pmtilesPath = await buildPmtiles(options, source, state, workdir, attempt.maxZoom, attempt.noDrop);
      const validation = await validatePmtiles(options, state, source, pmtilesPath, workdir, attempt.maxZoom, attempt.noDrop);
      console.log(`[${state}] validation`, {
        maxZoom: validation.maxZoom,
        noDrop: validation.noDrop,
        sourceCount: validation.sourceCount,
        pmtilesDecodedCount: validation.pmtilesDecodedCount,
        missingIdsCount: validation.missingIdsCount,
        regressionChecks: validation.regressionChecks,
        validationPassed: validation.validationPassed,
      });
      finalValidation = validation;
      if (validation.validationPassed) break;
    }

    if (!finalValidation) throw new Error(`No validation result produced for ${state}`);
    await uploadAndMaybePromote(options, state, finalValidation, workdir);
    if (!finalValidation.validationPassed) {
      throw new Error(`${state} PMTiles validation failed; missing IDs: ${finalValidation.missingIdsCount}`);
    }
    return finalValidation;
  } finally {
    if (!options.keepWorkdir && !options.workdir) await rm(workdir, { recursive: true, force: true });
  }
}

async function createWorkdir(options: CliOptions, state: string) {
  if (options.workdir) {
    await mkdir(options.workdir, { recursive: true });
    return options.workdir;
  }
  const dir = path.join(
    os.tmpdir(),
    `bedrock-us-buildings-${options.version}-${state}-${Date.now()}`
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function sourceFromWorkdir(options: CliOptions, state: string, workdir: string): Promise<SourceExport> {
  const sourceIdsPath = path.join(workdir, `${state}-source-ids.raw.txt`);
  const geojsonSeqPath = path.join(workdir, `${state}-buildings.geojsonseq`);
  await Promise.all([stat(sourceIdsPath), stat(geojsonSeqPath)]);
  const summary = await sourceSummary(options, state);
  const bounds: Bounds = [
    Number(summary.minx),
    Number(summary.miny),
    Number(summary.maxx),
    Number(summary.maxy),
  ];
  if (bounds.some((value) => !Number.isFinite(value))) {
    throw new Error(`Could not resolve source bounds for ${state}`);
  }
  const sourceCount = Number(summary.source_count ?? await countLines(sourceIdsPath));
  console.log(`[${state}] reusing exported source from ${workdir}`);
  return { bounds, sourceCount, sourceIdsPath, geojsonSeqPath };
}

async function statesForOptions(options: CliOptions) {
  if (options.state) return [options.state];
  const regionsPath = path.join(process.cwd(), 'scripts', 'regions.json');
  const regions = JSON.parse(await readFile(regionsPath, 'utf8')) as Array<{ code: string }>;
  return regions.map((region) => region.code.toUpperCase());
}

async function main() {
  const options = parseArgs();
  const states = await statesForOptions(options);
  const results = [];
  for (const state of states) {
    try {
      results.push(await rebuildState(options, state));
    } catch (error) {
      console.error(`[${state}] failed`, error instanceof Error ? error.message : error);
      results.push({ state, error: error instanceof Error ? error.message : String(error) });
      if (!options.all) process.exitCode = 1;
    }
  }

  const manifest = {
    version: options.version,
    generatedAt: new Date().toISOString(),
    bucket: options.bucket,
    prefix: options.prefix,
    promote: options.promote,
    dryRun: options.dryRun,
    states: results,
  };
  console.log(jsonStringify(manifest));
  if (results.some((result) => 'error' in result)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
