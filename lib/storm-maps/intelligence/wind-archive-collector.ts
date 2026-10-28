import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/server';
import { availableWindTimes, WIND_COUNTRIES, WIND_DATASET, WIND_ENCODING, WIND_PRODUCT, WIND_TILE_SIZE, WIND_ZOOM, validateWindResponse, windCountryTiles, type WindArchiveBundle, type WindCountry } from './wind-archive-format';

import { windDisplayPyramid, windArchiveStatistics } from './wind-archive-rendering';
export { windDisplayPyramid } from './wind-archive-rendering';
const ORIGIN = 'https://prod.v1.mapsgl.api.xweather.com';
async function parallel<T>(values: T[], work: (value: T) => Promise<void>, concurrency = 8) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) await work(values[next++]);
  }));
}

export async function collectWindArchive(now = new Date(), runTag = 'scheduled', maximumFrames = 2, backfillShard?: number) {
  const admin = createAdminClient(), window = `wind-run:${now.toISOString().slice(0, 16)}:${runTag}`;
  const { error: claim } = await admin.from('storm_collection_runs').insert({ window_key: window });
  if (claim) { if (claim.code === '23505') return { status: 'already_attempted', window }; throw Error('Wind collection ledger unavailable.'); }
  try {
    const id = process.env.XWEATHER_CLIENT_ID, secret = process.env.XWEATHER_CLIENT_SECRET;
    if (!id || !secret) throw Error('Wind provider credentials unavailable.');
    const auth = await fetch(`${ORIGIN}/auth/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!auth.ok) throw Error('Wind authentication failed.');
    const session = await auth.json();
    if (typeof session.access_token !== 'string') throw Error('Wind authentication failed.');
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const url = new URL(`${ORIGIN}/tile`); url.searchParams.set('data-set-ids', WIND_DATASET); url.searchParams.set('details', 'true');
    const metadata = await fetch(url, { headers, signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!metadata.ok) throw Error('Wind timeline unavailable.');
    const body = await metadata.json(), dataset = body[WIND_DATASET];
    if (dataset?.maxZoom !== WIND_ZOOM) throw Error('Wind provider resolution changed; review archive settings.');
    const available = availableWindTimes(dataset.validTimes, now), saved = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from('storm_archive_assets').select('source_time,metadata').eq('provider', 'xweather').eq('product', WIND_PRODUCT).gte('source_time', available[0]).order('id').range(offset, offset + 999);
      if (error) throw Error('Wind archive lookup unavailable.');
      for (const row of data ?? []) saved.add(`${row.metadata.country}:${new Date(row.source_time).toISOString()}`);
      if ((data?.length ?? 0) < 1000) break;
    }
    const countries = (Object.keys(WIND_COUNTRIES) as WindCountry[]).filter(country=>country!=='NZ');
    if (backfillShard != null && (!Number.isInteger(backfillShard) || backfillShard < 0 || backfillShard > 2)) throw Error('Invalid backfill partition.');
    const missing = available.filter(time => countries.some(country => !saved.has(`${country}:${time}`)) && (backfillShard == null || Date.parse(time) / 3600000 % 3 === backfillShard));
    // Keep the newest hour current, then rescue the oldest frames before their rolling window expires.
    const selected = [...new Set([missing.at(-1), ...missing].filter((value): value is string => !!value))].slice(0, Math.max(1, Math.min(8, maximumFrames)));
    let assetsStored = 0, bytesStored = 0; const failures: string[] = [], deadline = Date.now() + 240000;
    const frameTiles = new Map(selected.map(time => [time, {} as Record<string, string>]));
    const failedTiles = new Set<string>();
    const neededCountries = countries.filter(country => selected.some(time => !saved.has(`${country}:${time}`)));
    // Pack several historical hours into each upstream request, then retain each hour independently.
    await parallel([...new Set(neededCountries.flatMap(windCountryTiles))], async key => {
      try {
        const response = await fetch(`${ORIGIN}/tile/${key}/512x512/${selected[0]}.png`, {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20000),
          body: JSON.stringify([{ dataSetId: WIND_DATASET, dataMin: 0, dataMax: 100, outputMin: 1, outputMax: 255, outputNoDataValue: 0, validTimes: selected }]),
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw Error('Wind tile unavailable.');
        const times = validateWindResponse(response.headers.get('x-data-set-locs'), selected);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 8000000) throw Error('Wind tile exceeds budget.');
        const image = sharp(bytes), dimensions = await image.metadata();
        if (dimensions.width !== WIND_TILE_SIZE * times.length || dimensions.height !== WIND_TILE_SIZE) throw Error('Unexpected packed wind dimensions.');
        for (let index = 0; index < times.length; index++) {
          const png = times.length === 1 ? bytes : await image.clone().extract({ left: index * WIND_TILE_SIZE, top: 0, width: WIND_TILE_SIZE, height: WIND_TILE_SIZE }).png().toBuffer();
          frameTiles.get(times[index])![key] = png.toString('base64');
        }
      } catch { failedTiles.add(key); }
    });
    for (const time of selected) {
      if (Date.now() > deadline) break;
      const needed = countries.filter(country => !saved.has(`${country}:${time}`));
      const tiles = frameTiles.get(time)!;
      for (const country of needed) {
        try {
          const countryKeys = windCountryTiles(country);
          if (countryKeys.some(key => failedTiles.has(key) || !tiles[key])) throw Error('Incomplete wind frame.');
          const numericTiles = Object.fromEntries(countryKeys.map(key => [key, tiles[key]]));
          const bundle: WindArchiveBundle = { version: 1, country, time, dataset: WIND_DATASET, evidence: 'gridded-wind-estimate', zoom: WIND_ZOOM, tileSize: WIND_TILE_SIZE, encoding: WIND_ENCODING, numericTiles, displayTiles: await windDisplayPyramid(numericTiles,0,country) };
          const bytes = gzipSync(JSON.stringify(bundle));
          if (bytes.length > 9500000) throw Error('Wind frame exceeds storage budget.');
          const digest = createHash('sha256').update(bytes).digest('hex'), path = `xweather/${WIND_PRODUCT}/${time.slice(0, 10)}/${country}-${digest}.gz`;
          const { error: upload } = await admin.storage.from('storm-archive').upload(path, bytes, { contentType: 'application/gzip', upsert: true });
          if (upload) throw Error('Wind storage failed.');
          const { error } = await admin.from('storm_archive_assets').upsert({ provider: 'xweather', product: WIND_PRODUCT, content_hash: digest, storage_path: path, source_time: time, byte_size: bytes.length,
            metadata: { country, ...await windArchiveStatistics(numericTiles, country), windMaskVersion: 2, windRegionVersion: 1, evidence: bundle.evidence, dataset: WIND_DATASET, metric: 'wind-gust', units: 'm/s', zoom: WIND_ZOOM, tileSize: WIND_TILE_SIZE, bounds: WIND_COUNTRIES[country].bounds, tiles: countryKeys.length, impactGeometry: false, encoding: WIND_ENCODING } }, { onConflict: 'provider,product,content_hash' });
          if (error) throw Error('Wind archive record failed.');
          saved.add(`${country}:${time}`); assetsStored++; bytesStored += bytes.length;
        } catch { failures.push(`${country}:${time}`); }
      }
    }
    const remainingFrames = available.filter(time => countries.some(country => !saved.has(`${country}:${time}`))).length;
    const details = { assetsStored, bytesStored, framesAttempted: selected.length, failedFrames: failures.length, remainingFrames, availableFrom: available[0], latestAvailable: available.at(-1), countries, evidence: 'Gridded wind-gust estimates. Not measured gusts at every address or confirmed damage.' };
    const status = failures.length ? 'partial' : 'complete';
    const { error } = await admin.from('storm_collection_runs').update({ status, details, completed_at: new Date().toISOString() }).eq('window_key', window);
    if (error) throw Error('Wind collection ledger write failed.');
    return { status, window, ...details };
  } catch {
    await admin.from('storm_collection_runs').update({ status: 'failed', details: { error: 'Wind collection failed. Missing frames remain retryable; missing data is not calm wind.' }, completed_at: new Date().toISOString() }).eq('window_key', window);
    throw Error('Wind collection failed. Check provider access and the collection ledger.');
  }
}
