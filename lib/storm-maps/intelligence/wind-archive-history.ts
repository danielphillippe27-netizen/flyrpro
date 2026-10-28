import { gunzipSync } from 'node:zlib';
import { createAdminClient } from '@/lib/supabase/server';
import { WIND_PRODUCT, type WindArchiveBundle, type WindCountry } from './wind-archive-format';

const bundles = new Map<string, { value: Promise<WindArchiveBundle>; expires: number }>();
export async function loadWindArchive(country: WindCountry, time: string) {
  const key = `${country}:${time}`, existing = bundles.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  // Coalesce map-tile requests; keep at most two decoded country frames in memory.
  const value = (async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.from('storm_archive_assets').select('storage_path,bucket').eq('provider', 'xweather').eq('product', WIND_PRODUCT).eq('source_time', time).eq('metadata->>country', country).order('captured_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !data) throw Error('This wind hour has not been archived for the selected country.');
    const { data: file, error: download } = await admin.storage.from(data.bucket).download(data.storage_path);
    if (download || !file) throw Error('Saved wind map unavailable.');
    const result: WindArchiveBundle = JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer()), { maxOutputLength: 80000000 }).toString());
    if (result.version !== 1 || result.country !== country || result.time !== time || !result.numericTiles || !result.displayTiles) throw Error('Invalid saved wind map.');
    return result;
  })();
  if (bundles.size >= 2) bundles.delete(bundles.keys().next().value!);
  bundles.set(key, { value, expires: Date.now() + 60000 });
  try { return await value; } catch (error) { bundles.delete(key); throw error; }
}
export async function windArchiveHealth(now = new Date()) {
  const admin = createAdminClient();
  const { data, error } = await admin.from('storm_collection_runs').select('status,details,completed_at').like('window_key', 'wind-run:%').not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return { available: false, message: 'Wind collection has not completed yet.' };
  const fresh = data.completed_at && +now - Date.parse(data.completed_at) < 20 * 60000;
  return { available: data.status !== 'failed' && !!fresh, remainingFrames: data.details?.remainingFrames ?? null, lastChecked: data.completed_at, latestAvailable: data.details?.latestAvailable ?? null,
    message: !fresh ? 'Wind collection is stale. Saved maps remain available.' : data.status === 'failed' ? 'Latest wind collection failed. Saved maps remain available.' : data.status === 'partial' ? 'Some wind frames failed and will be retried.' : data.details?.remainingFrames ? 'Wind history is backfilling. Saved hours are available below.' : 'Available seven-day wind history saved; new hours are collected automatically.' };
}
