#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIAMOND_ROOT = path.resolve(SCRIPT_DIR, '../../municipal_data/diamond');
const SEAM_POLICY = Object.freeze({
  buffer: 127,
  no_clipping: true,
  no_tile_size_limit: true,
  no_feature_limit: true,
  drop_densest_as_needed: false,
});

const args = process.argv.slice(2);
const diamondRoot = path.resolve(readFlag('diamond-root') ?? DEFAULT_DIAMOND_ROOT);
const buildDate = readFlag('date') ?? new Date().toISOString().slice(0, 10).replaceAll('-', '');
const only = new Set(
  (readFlag('only') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const manifestsOnly = args.includes('--manifests-only');
const tippecanoe = readFlag('tippecanoe-bin') ?? process.env.TIPPECANOE_BIN ?? 'tippecanoe';
const bucket = process.env.DIAMOND_GEOMETRY_BUCKET ?? 'flyr-pro-addresses-2025';

function readFlag(name) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function findParcelDirectories(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const child = path.join(directory, entry.name);
    if (entry.name === 'parcels') {
      try {
        await stat(path.join(child, 'parcels.geojson'));
        matches.push(child);
      } catch {
        // A source-gap directory has no parcel data to rebuild.
      }
      continue;
    }
    matches.push(...(await findParcelDirectories(child)));
  }
  return matches;
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeArtifactPath(filePath) {
  return path.relative(path.dirname(path.dirname(diamondRoot)), filePath);
}

async function rebuild(parcelDir) {
  const relativeDir = path.relative(diamondRoot, parcelDir);
  const [country, region, municipality, layer] = relativeDir.split(path.sep);
  if (country !== 'new-zealand' || layer !== 'parcels') {
    throw new Error(`Unexpected New Zealand parcel directory: ${parcelDir}`);
  }

  const datasetKey = `${region}/${municipality}`;
  if (only.size && !only.has(datasetKey) && !only.has(municipality)) return;

  const geojsonPath = path.join(parcelDir, 'parcels.geojson');
  const tilejsonPath = path.join(parcelDir, 'parcels.json');
  const manifestPath = path.join(parcelDir, 'diamond-manifest.json');
  const cityManifestPath = path.join(parcelDir, '..', 'diamond-city-manifest.json');
  const stablePath = path.join(parcelDir, 'parcels.pmtiles');
  const versionedName = `parcels-${buildDate}-seamsafe.pmtiles`;
  const versionedPath = path.join(parcelDir, versionedName);
  // Tippecanoe selects the archive format from the final extension.
  const temporaryOutput = path.join(parcelDir, `.${versionedName}.tmp.pmtiles`);
  const tilejson = await readJson(tilejsonPath);

  if (!manifestsOnly) {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), `wolfgrid-${municipality}-`));
    console.log(`\nRebuilding ${datasetKey}`);
    try {
      await run(tippecanoe, [
        '--force',
        '--quiet',
        '--temporary-directory',
        temporaryDirectory,
        '--output',
        temporaryOutput,
        '--minimum-zoom',
        String(tilejson.minzoom ?? 10),
        '--maximum-zoom',
        String(tilejson.maxzoom ?? 16),
        '--buffer',
        String(SEAM_POLICY.buffer),
        '--no-clipping',
        '--no-tile-size-limit',
        '--no-feature-limit',
        '--named-layer',
        `parcels:${geojsonPath}`,
      ]);

      await rename(temporaryOutput, versionedPath);
      await copyFile(versionedPath, stablePath);
    } finally {
      await rm(temporaryOutput, { force: true });
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    await stat(versionedPath);
    await stat(stablePath);
  }

  const generatedAt = new Date().toISOString();
  const size = (await stat(versionedPath)).size;
  const digest = await sha256(versionedPath);
  const s3Prefix = `diamond/parcels/${country}/${region}/${municipality}`;
  const versionedKey = `${s3Prefix}/${versionedName}`;
  const stableKey = `${s3Prefix}/parcels.pmtiles`;
  const geometryUrl = `s3://${bucket}/${versionedKey}`;

  tilejson.metadata = {
    ...tilejson.metadata,
    pmtiles_key: versionedKey,
    pmtiles_size_bytes: size,
    pmtiles_sha256: digest,
    generated_at: generatedAt,
    stable_pmtiles_key: stableKey,
    seam_safe: true,
    tippecanoe_policy: SEAM_POLICY,
  };
  tilejson.tiles = [geometryUrl];
  await writeJson(tilejsonPath, tilejson);

  const manifest = await readJson(manifestPath);
  Object.assign(manifest, {
    geometry_url: geometryUrl,
    pmtiles_size_bytes: size,
    pmtiles_sha256: digest,
    generated_at: generatedAt,
    seam_safe: true,
    tippecanoe_policy: SEAM_POLICY,
  });
  manifest.local_files = {
    ...manifest.local_files,
    pmtiles: relativeArtifactPath(versionedPath),
    stable_pmtiles: relativeArtifactPath(stablePath),
    tilejson: relativeArtifactPath(tilejsonPath),
    geojson_gzip: relativeArtifactPath(path.join(parcelDir, 'parcels.geojson.gz')),
  };
  await writeJson(manifestPath, manifest);

  const cityManifest = await readJson(cityManifestPath);
  cityManifest.layers.parcels = manifest;
  cityManifest.generated_at = generatedAt;
  await writeJson(cityManifestPath, cityManifest);

  console.log(`Completed ${datasetKey}: ${size.toLocaleString()} bytes, sha256 ${digest}`);
}

const parcelRoot = path.join(diamondRoot, 'new-zealand');
const parcelDirectories = (await findParcelDirectories(parcelRoot)).sort();
for (const parcelDir of parcelDirectories) await rebuild(parcelDir);

console.log('\nNew Zealand seam-safe parcel rebuild complete.');
