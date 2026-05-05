#!/usr/bin/env tsx
/**
 * Convert the LandRecords/Regrid nationwide parcel GeoPackage into the
 * state-level NDJSON layout consumed by ParcelEnrichmentService.
 *
 * Example:
 *   npx tsx scripts/export-landgrid-parcels-to-s3.ts --states=OH --limit=1000
 *   npx tsx scripts/export-landgrid-parcels-to-s3.ts --states=OH --upload
 *   npx tsx scripts/export-landgrid-parcels-to-s3.ts --all --upload
 */

import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import regionBounds from './regions.json';

type StateConfig = {
  code: string;
  name: string;
  fips: string;
};

type Options = {
  all: boolean;
  bucket: string;
  datePart: string;
  dryRun: boolean;
  duckdbBin: string;
  forceUpload: boolean;
  gpkgPath: string;
  gzipUpload: boolean;
  limit: number | null;
  noExport: boolean;
  outDir: string;
  overwrite: boolean;
  states: string[];
  upload: boolean;
  uploadConcurrency: number;
};

const DEFAULT_GPKG_PATH =
  '/Volumes/Samsung SSD/municipal_data/kagglehub_cache/datasets/landrecordsus/us-parcel-layer/versions/1/LR_PARCEL_NATIONWIDE_FILE_US_2026_Q1.gpkg';
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
        },
      ];
    })
    .filter(([, state]) => Boolean(state.fips))
);

main().catch((error) => {
  console.error('Landgrid parcel export failed:', error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedStates = resolveStates(options);

  if (!existsSync(options.gpkgPath)) {
    throw new Error(`GeoPackage not found: ${options.gpkgPath}`);
  }

  if (options.dryRun) {
    console.log('Dry run; no files will be written or uploaded.');
  }

  console.log('Landgrid parcel export');
  console.log(`  GeoPackage: ${options.gpkgPath}`);
  console.log(`  Output dir: ${options.outDir}`);
  console.log(`  S3 bucket:  ${options.bucket}`);
  console.log(`  Date part:  ${options.datePart}`);
  console.log(`  States:     ${selectedStates.map((state) => state.code).join(', ')}`);
  if (options.limit !== null) console.log(`  Limit:      ${options.limit.toLocaleString()} row(s) per state`);
  if (options.upload) console.log('  Upload:     enabled');

  await mkdir(options.outDir, { recursive: true });

  if (options.all) {
    await exportAllStates(selectedStates, options);
    return;
  }

  for (const state of selectedStates) {
    await exportState(state, options);
  }
}

async function exportAllStates(states: StateConfig[], options: Options) {
  const outputs = states.map((state) => stateOutput(state, options));
  const existingOutput = outputs.find((output) => existsSync(output.outputPath));
  if (existingOutput && !options.overwrite && !options.noExport && !options.dryRun) {
    throw new Error(`Output already exists: ${existingOutput.outputPath}. Use --overwrite to regenerate.`);
  }

  console.log('\nAll states single-pass export');
  for (const output of outputs) {
    console.log(`  ${output.state.code}: ${output.outputPath}`);
  }

  const sql = buildAllStatesCopySql(states, options);
  if (options.dryRun) {
    console.log('  SQL:');
    console.log(indent(sql, 4));
    return;
  }

  let writtenStates = new Set<string>();
  let rowCounts = new Map<string, number>();

  if (options.noExport) {
    writtenStates = new Set(outputs.filter((output) => existsSync(output.outputPath)).map((output) => output.state.code));
    console.log(`  Export: skipped; using ${writtenStates.size.toLocaleString()} existing file(s).`);
  } else {
    for (const output of outputs) {
      await mkdir(path.dirname(output.outputPath), { recursive: true });
    }

    const routed = await runDuckDbStateRouter(options.duckdbBin, sql, new Map(
      outputs.map((output) => [output.state.code, output.outputPath])
    ));
    writtenStates = routed.writtenStates;
    rowCounts = routed.rowCounts;
  }

  for (const output of outputs) {
    if (!writtenStates.has(output.state.code)) continue;
    const stats = await stat(output.outputPath);
    const rows = rowCounts.get(output.state.code);
    console.log(
      rows === undefined
        ? `  ${output.state.code}: existing ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GiB`
        : `  ${output.state.code}: exported ${rows.toLocaleString()} row(s), ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GiB`
    );
  }

  if (options.upload) {
    await uploadOutputs(outputs.filter((output) => writtenStates.has(output.state.code)), options);
  }
}

async function exportState(state: StateConfig, options: Options) {
  const { sourceId, outputPath, s3Key } = stateOutput(state, options);

  console.log(`\n${state.code} ${state.name}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  S3:     s3://${options.bucket}/${s3Key}`);

  if (!options.dryRun) {
    await mkdir(path.dirname(outputPath), { recursive: true });
  }

  const fileExists = existsSync(outputPath);
  if (options.noExport) {
    console.log('  Export: skipped; using existing local file.');
  } else if (fileExists && !options.overwrite) {
    console.log('  Export: skipped; output exists. Use --overwrite to regenerate.');
  } else {
    const sql = buildCopySql(state, options, outputPath);
    if (options.dryRun) {
      console.log('  SQL:');
      console.log(indent(sql, 4));
    } else {
      await runDuckDb(options.duckdbBin, sql);
      const stats = await stat(outputPath);
      console.log(`  Exported ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GiB`);
    }
  }

  if (options.upload) {
    if (options.dryRun) {
      console.log('  Upload: dry-run skipped');
    } else {
      await uploadFile({
        bucket: options.bucket,
        key: s3Key,
        path: outputPath,
        state,
        sourceId,
        datePart: options.datePart,
        gzip: options.gzipUpload,
        force: options.forceUpload,
      });
    }
  }
}

async function uploadOutputs(outputs: ReturnType<typeof stateOutput>[], options: Options) {
  let nextIndex = 0;
  const workerCount = Math.min(options.uploadConcurrency, outputs.length);
  console.log(`  Upload concurrency: ${workerCount}`);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < outputs.length) {
        const output = outputs[nextIndex];
        nextIndex += 1;
        await uploadFile({
          bucket: options.bucket,
          key: output.s3Key,
          path: output.outputPath,
          state: output.state,
          sourceId: output.sourceId,
          datePart: options.datePart,
          gzip: options.gzipUpload,
          force: options.forceUpload,
        });
      }
    })
  );
}

function stateOutput(state: StateConfig, options: Options) {
  const sourceId = `${state.code.toLowerCase()}_${SOURCE_ID_SUFFIX}`;
  const filename = `${sourceId}_gold.ndjson`;
  return {
    state,
    sourceId,
    filename,
    outputPath: path.join(options.outDir, state.code.toLowerCase(), options.datePart, filename),
    s3Key: `gold-standard/us/${state.code.toLowerCase()}/${sourceId}/${options.datePart}/${filename}`,
  };
}

function buildCopySql(state: StateConfig, options: Options, outputPath: string) {
  const limitClause = options.limit === null ? '' : `\nLIMIT ${options.limit}`;
  return `
LOAD spatial;
COPY (
  SELECT
    '${state.code}' AS state_code,
    COALESCE(
      NULLIF(parcelid, ''),
      NULLIF(parcelid2, ''),
      NULLIF(taxacctnum, ''),
      statefp || ':' || countyfp || ':' || CAST(hash(geoid, centroidx, centroidy, ST_AsGeoJSON(geom)) AS VARCHAR)
    ) AS external_id,
    json(ST_AsGeoJSON(geom)) AS geometry,
    struct_pack(
      source := '${SOURCE_LABEL}',
      source_id := '${state.code.toLowerCase()}_${SOURCE_ID_SUFFIX}',
      state := '${state.code}',
      statefp := statefp,
      countyfp := countyfp,
      geoid := geoid,
      parcelid := parcelid,
      parcelid2 := parcelid2,
      taxacctnum := taxacctnum,
      taxyear := taxyear,
      usecode := usecode,
      usedesc := usedesc,
      numbldgs := numbldgs,
      numunits := numunits,
      yearbuilt := yearbuilt,
      bldgsqft := bldgsqft,
      assdacres := assdacres,
      parceladdr := parceladdr,
      parcelcity := parcelcity,
      parcelstate := parcelstate,
      parcelzip := parcelzip,
      centroidx := centroidx,
      centroidy := centroidy,
      surfpointx := surfpointx,
      surfpointy := surfpointy,
      updated := updated,
      lrversion := lrversion
    ) AS properties
  FROM ST_Read(${sqlString(options.gpkgPath)}, layer = 'lr_parcel_us')
  WHERE statefp = '${state.fips}'
    AND geom IS NOT NULL${limitClause}
) TO ${sqlString(outputPath)} (FORMAT JSON);
`.trim();
}

function buildAllStatesCopySql(states: StateConfig[], options: Options) {
  const limitClause = options.limit === null ? '' : `\n  LIMIT ${options.limit}`;
  const fipsValues = states.map((state) => sqlString(state.fips)).join(', ');
  return `
LOAD spatial;
COPY (
  WITH parcels AS (
    SELECT
      ${stateFipsCaseSql()} AS state_code,
      *
    FROM ST_Read(${sqlString(options.gpkgPath)}, layer = 'lr_parcel_us')
    WHERE statefp IN (${fipsValues})
      AND geom IS NOT NULL${limitClause}
  )
  SELECT
    state_code,
    COALESCE(
      NULLIF(parcelid, ''),
      NULLIF(parcelid2, ''),
      NULLIF(taxacctnum, ''),
      statefp || ':' || countyfp || ':' || CAST(hash(geoid, centroidx, centroidy, ST_AsGeoJSON(geom)) AS VARCHAR)
    ) AS external_id,
    json(ST_AsGeoJSON(geom)) AS geometry,
    struct_pack(
      source := '${SOURCE_LABEL}',
      source_id := lower(state_code) || '_${SOURCE_ID_SUFFIX}',
      state := state_code,
      statefp := statefp,
      countyfp := countyfp,
      geoid := geoid,
      parcelid := parcelid,
      parcelid2 := parcelid2,
      taxacctnum := taxacctnum,
      taxyear := taxyear,
      usecode := usecode,
      usedesc := usedesc,
      numbldgs := numbldgs,
      numunits := numunits,
      yearbuilt := yearbuilt,
      bldgsqft := bldgsqft,
      assdacres := assdacres,
      parceladdr := parceladdr,
      parcelcity := parcelcity,
      parcelstate := parcelstate,
      parcelzip := parcelzip,
      centroidx := centroidx,
      centroidy := centroidy,
      surfpointx := surfpointx,
      surfpointy := surfpointy,
      updated := updated,
      lrversion := lrversion
    ) AS properties
  FROM parcels
) TO STDOUT (FORMAT JSON);
`.trim();
}

async function runDuckDb(duckdbBin: string, sql: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(duckdbBin, ['-c', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`duckdb exited with code ${code}`));
    });
  });
}

async function runDuckDbStateRouter(duckdbBin: string, sql: string, outputsByState: Map<string, string>) {
  const writers = new Map<string, WriteStream>();
  const writtenStates = new Set<string>();
  const rowCounts = new Map<string, number>();
  let routedRows = 0;
  let buffered = '';

  const child = spawn(duckdbBin, ['-c', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const exitPromise = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`duckdb exited with code ${code}`));
    });
  });

  for await (const chunk of child.stdout) {
    buffered += chunk.toString('utf8');
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      const stateCode = await routeStateLine(line, outputsByState, writers, writtenStates);
      routedRows += 1;
      rowCounts.set(stateCode, (rowCounts.get(stateCode) ?? 0) + 1);
      if (routedRows % 1_000_000 === 0) {
        console.log(`  Routed ${routedRows.toLocaleString()} parcel row(s)...`);
      }
    }
  }

  if (buffered.trim()) {
    const stateCode = await routeStateLine(buffered.trim(), outputsByState, writers, writtenStates);
    routedRows += 1;
    rowCounts.set(stateCode, (rowCounts.get(stateCode) ?? 0) + 1);
  }

  await exitPromise;
  await closeWriters(writers);
  console.log(`  Routed ${routedRows.toLocaleString()} parcel row(s) total.`);
  return { writtenStates, rowCounts };
}

async function routeStateLine(
  line: string,
  outputsByState: Map<string, string>,
  writers: Map<string, WriteStream>,
  writtenStates: Set<string>
) {
  const match = line.match(/"state_code":"([A-Z]{2})"/);
  const stateCode = match?.[1];
  if (!stateCode) {
    throw new Error(`Could not route parcel row without state_code: ${line.slice(0, 160)}`);
  }

  const outputPath = outputsByState.get(stateCode);
  if (!outputPath) return stateCode;

  let writer = writers.get(stateCode);
  if (!writer) {
    writer = createWriteStream(outputPath);
    writers.set(stateCode, writer);
  }

  writtenStates.add(stateCode);
  if (!writer.write(`${line}\n`)) {
    await once(writer, 'drain');
  }

  return stateCode;
}

async function closeWriters(writers: Map<string, WriteStream>) {
  await Promise.all(
    Array.from(writers.values()).map(
      (writer) =>
        new Promise<void>((resolve, reject) => {
          writer.on('error', reject);
          writer.end(resolve);
        })
    )
  );
}

async function uploadFile(input: {
  bucket: string;
  key: string;
  path: string;
  state: StateConfig;
  sourceId: string;
  datePart: string;
  gzip: boolean;
  force: boolean;
}) {
  const stats = await stat(input.path);
  const client = new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2',
  });

  if (!input.force) {
    const existing = await getExistingObject(client, input.bucket, input.key);
    if (
      existing?.Metadata?.original_size_bytes === String(stats.size) &&
      (input.gzip ? existing.ContentEncoding === 'gzip' : existing.ContentEncoding !== 'gzip')
    ) {
      console.log(`  ${input.state.code}: upload skipped; matching S3 object already exists`);
      return;
    }
  }

  console.log(
    `  ${input.state.code}: uploading ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GiB${input.gzip ? ' with gzip content-encoding' : ''}...`
  );

  const upload = new Upload({
    client,
    params: {
      Bucket: input.bucket,
      Key: input.key,
      Body: input.gzip
        ? createReadStream(input.path).pipe(createGzip({ level: 1 }))
        : createReadStream(input.path),
      ...(input.gzip ? { ContentEncoding: 'gzip' } : { ContentLength: stats.size }),
      ContentType: 'application/x-ndjson',
      Metadata: {
        source: SOURCE_LABEL,
        source_id: input.sourceId,
        state: input.state.code,
        state_fips: input.state.fips,
        generated_date: input.datePart,
        original_size_bytes: String(stats.size),
      },
    },
    queueSize: input.gzip ? 2 : 4,
    partSize: input.gzip ? 16 * 1024 * 1024 : 64 * 1024 * 1024,
  });

  let lastLoggedBytes = 0;
  upload.on('httpUploadProgress', (progress) => {
    if (!progress.loaded) return;
    if (progress.loaded - lastLoggedBytes < 64 * 1024 * 1024 && progress.loaded !== progress.total) return;
    lastLoggedBytes = progress.loaded;
    if (progress.total) {
      const pct = ((progress.loaded / progress.total) * 100).toFixed(1);
      console.log(`  ${input.state.code}: upload ${pct}%`);
      return;
    }
    console.log(`  ${input.state.code}: upload ${(progress.loaded / 1024 / 1024 / 1024).toFixed(2)} GiB compressed sent`);
  });

  await upload.done();
  console.log(`  ${input.state.code}: upload complete`);
}

async function getExistingObject(client: S3Client, bucket: string, key: string) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    return null;
  }
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    all: false,
    bucket: process.env.PARCEL_BUCKET || DEFAULT_BUCKET,
    datePart: todayYmd(),
    dryRun: false,
    duckdbBin: process.env.DUCKDB_BIN || 'duckdb',
    forceUpload: false,
    gpkgPath: process.env.LANDGRID_GPKG_PATH || DEFAULT_GPKG_PATH,
    gzipUpload: true,
    limit: null,
    noExport: false,
    outDir: '',
    overwrite: false,
    states: [],
    upload: false,
    uploadConcurrency: 4,
  };

  for (const arg of args) {
    if (arg === '--all') options.all = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-export') options.noExport = true;
    else if (arg === '--plain-upload') options.gzipUpload = false;
    else if (arg === '--overwrite') options.overwrite = true;
    else if (arg === '--force-upload') options.forceUpload = true;
    else if (arg === '--upload') options.upload = true;
    else if (arg.startsWith('--bucket=')) options.bucket = readValue(arg);
    else if (arg.startsWith('--date=')) options.datePart = readValue(arg);
    else if (arg.startsWith('--duckdb-bin=')) options.duckdbBin = readValue(arg);
    else if (arg.startsWith('--gpkg=')) options.gpkgPath = readValue(arg);
    else if (arg.startsWith('--limit=')) options.limit = parsePositiveInteger(readValue(arg), '--limit');
    else if (arg.startsWith('--out-dir=')) options.outDir = readValue(arg);
    else if (arg.startsWith('--upload-concurrency=')) {
      options.uploadConcurrency = parsePositiveInteger(readValue(arg), '--upload-concurrency');
    }
    else if (arg.startsWith('--states=')) {
      options.states = readValue(arg)
        .split(',')
        .map((state) => state.trim().toUpperCase())
        .filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{8}$/.test(options.datePart)) {
    throw new Error(`--date must be YYYYMMDD, received ${options.datePart}`);
  }

  if (!options.outDir) {
    options.outDir = path.join(path.dirname(options.gpkgPath), 'flyr_gold_exports', options.datePart);
  }

  return options;
}

function resolveStates(options: Options) {
  if (options.all && options.states.length > 0) {
    throw new Error('Use either --all or --states, not both.');
  }

  const stateCodes = options.all ? Array.from(US_STATES.keys()).sort() : options.states;
  if (stateCodes.length === 0) {
    throw new Error('Choose states with --states=OH,NY or export every state with --all.');
  }

  return stateCodes.map((code) => {
    const state = US_STATES.get(code);
    if (!state) throw new Error(`Unsupported state code: ${code}`);
    return state;
  });
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function stateFipsCaseSql() {
  const branches = Array.from(US_STATES.values())
    .map((state) => `WHEN '${state.fips}' THEN '${state.code}'`)
    .join(' ');
  return `CASE statefp ${branches} END`;
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

function todayYmd() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function indent(value: string, spaces: number) {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function printUsageAndExit(): never {
  console.log(`
Usage:
  npx tsx scripts/export-landgrid-parcels-to-s3.ts --states=OH [--upload]
  npx tsx scripts/export-landgrid-parcels-to-s3.ts --all --upload

Options:
  --gpkg=/path/file.gpkg       GeoPackage path
  --out-dir=/path/out          Local export directory
  --date=YYYYMMDD              S3 date partition, default today
  --states=OH,NY               Comma-separated state codes
  --all                        Export every US state plus DC
  --limit=1000                 Smoke-test row limit per state
  --upload                     Multipart upload each exported file to S3
  --no-export                  Upload or inspect existing local output files
  --plain-upload               Upload raw NDJSON without gzip content-encoding
  --force-upload               Upload even when a matching S3 object exists
  --upload-concurrency=4       Number of state files to upload at once
  --bucket=name                S3 bucket, default ${DEFAULT_BUCKET}
  --overwrite                  Regenerate existing local files
  --dry-run                    Print work without writing/uploading
`);
  process.exit(0);
}
