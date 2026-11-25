/**
 * Import a reviewed NOAA HRRR frame into the existing Storm Maps tile archive.
 * First run build-hrrr-wind-tiles.py for a single UTC hour and bounded area.
 * DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/archive-hrrr-wind.ts CA frame.json --publish
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { createAdminClient } from '../lib/supabase/server';
import { isStormCountry } from '../lib/storm-maps/storm-countries';
import {
  canonicalWindTime, PUBLIC_WIND_DATASET, PUBLIC_WIND_PROVIDER, WIND_ENCODING, WIND_PRODUCT,
  WIND_TILE_SIZE, WIND_ZOOM, type WindArchiveBundle,
} from '../lib/storm-maps/intelligence/wind-archive-format';
import { windArchiveStatistics, windDisplayPyramid } from '../lib/storm-maps/intelligence/wind-archive-rendering';

const frameSchema = z.object({
  time: z.iso.datetime(),
  sourceUrl: z.url().refine(value => new URL(value).origin === 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com'),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  numericTiles: z.record(z.string().regex(/^4\/(?:[0-9]|1[0-5])\/(?:[0-9]|1[0-5])$/), z.string().min(1)),
});

async function main() {
  const [country, file, operation] = process.argv.slice(2);
  if (!isStormCountry(country) || !file || (operation != null && operation !== '--publish')) {
    throw Error('Choose CA or US and a prepared NOAA wind frame, with optional --publish.');
  }
  const frame = frameSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const time = canonicalWindTime(frame.time);
  if (time !== frame.time || !Object.keys(frame.numericTiles).length) throw Error('Invalid NOAA archive frame.');
  const statistics = await windArchiveStatistics(frame.numericTiles, country);
  if (statistics.maximumGustKPH == null) throw Error('No valid wind cells fell within the selected country.');
  const bundle: WindArchiveBundle = {
    version: 1, country, time, dataset: PUBLIC_WIND_DATASET, evidence: 'gridded-wind-estimate',
    zoom: WIND_ZOOM, tileSize: WIND_TILE_SIZE, encoding: WIND_ENCODING, numericTiles: frame.numericTiles,
    displayTiles: await windDisplayPyramid(frame.numericTiles, 0, country),
  };
  const bytes = gzipSync(JSON.stringify(bundle));
  if (bytes.length > 10_000_000) throw Error('Prepared wind archive exceeds the storage limit.');
  if (operation === '--publish') {
    const admin = createAdminClient();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const path = `${PUBLIC_WIND_PROVIDER}/${WIND_PRODUCT}/${time.slice(0, 10)}/${hash}.gz`;
    const { error: uploadError } = await admin.storage.from('storm-archive').upload(path, bytes, {
      contentType: 'application/gzip', upsert: true,
    });
    if (uploadError) throw uploadError;
    const { error: recordError } = await admin.from('storm_archive_assets').upsert({
      provider: PUBLIC_WIND_PROVIDER, product: WIND_PRODUCT, content_hash: hash, source_time: time,
      byte_size: bytes.length, storage_path: path,
      metadata: {
        ...statistics, country, windMaskVersion: 2, windRegionVersion: 1, evidence: bundle.evidence,
        dataset: PUBLIC_WIND_DATASET, sourceUrl: frame.sourceUrl, sourceResolutionM: 3000,
        coverageBounds: frame.bounds, metric: 'wind-gust', units: 'm/s',
      },
    }, { onConflict: 'provider,product,content_hash' });
    if (recordError) throw recordError;
  }
  console.log(JSON.stringify({ country, time, ...statistics, bytes: bytes.length, published: operation === '--publish' }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
