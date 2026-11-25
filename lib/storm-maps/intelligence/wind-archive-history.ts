import { isStormCountry } from '../storm-countries';
import { gunzipSync } from 'node:zlib';
import { createAdminClient } from '@/lib/supabase/server';
import { PUBLIC_WIND_DATASET, PUBLIC_WIND_PROVIDER, WIND_DATASET, WIND_PRODUCT, type WindArchiveBundle, type WindCountry } from './wind-archive-format';

const bundles = new Map<string, { value: Promise<WindArchiveBundle>; expires: number }>();
export async function loadWindArchive(country: WindCountry, time: string, provider?: typeof PUBLIC_WIND_PROVIDER | 'xweather') {
  if (!isStormCountry(country)) throw Error('Wind maps are available for Canada and the United States.');
  const key = `${country}:${time}:${provider ?? 'preferred'}`, existing = bundles.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  // Coalesce map-tile requests; keep at most two decoded country frames in memory.
  const value = (async () => {
    const admin = createAdminClient();
    const query = admin.from('storm_archive_assets').select('provider,storage_path,bucket')
      .in('provider', provider ? [provider] : [PUBLIC_WIND_PROVIDER, 'xweather'])
      .eq('product', WIND_PRODUCT).eq('source_time', time).eq('metadata->>country', country);
    const { data, error } = await query.order('provider').order('captured_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !data) throw Error('This wind hour has not been archived for the selected country.');
    const { data: file, error: download } = await admin.storage.from(data.bucket).download(data.storage_path);
    if (download || !file) throw Error('Saved wind map unavailable.');
    const result: WindArchiveBundle = JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer()), { maxOutputLength: 80000000 }).toString());
    if (result.version !== 1 || result.country !== country || result.time !== time || result.dataset !== (data.provider === PUBLIC_WIND_PROVIDER ? PUBLIC_WIND_DATASET : WIND_DATASET) || !result.numericTiles || !result.displayTiles) throw Error('Invalid saved wind map.');
    return result;
  })();
  if (bundles.size >= 2) bundles.delete(bundles.keys().next().value!);
  bundles.set(key, { value, expires: Date.now() + 60000 });
  try { return await value; } catch (error) { bundles.delete(key); throw error; }
}
