import { createAdminClient } from '@/lib/supabase/server';
import type { StormEvent } from './model';

export async function australianHailHealth(now = new Date()) {
  const admin = createAdminClient();
  const { data, error } = await admin.from('storm_collection_runs').select('status,details,completed_at').like('window_key', 'au-hail-run:%').not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return { available: false, complete24h: false, message: 'Australian collection has not completed yet.' };
  const fresh = data.completed_at && +now - Date.parse(data.completed_at) < 20 * 60000;
  return { available: data.status !== 'failed' && !!fresh, complete24h: data.status === 'complete' && !!fresh && data.details?.remaining24h === 0,
    lastChecked: data.completed_at, remainingFrames: data.details?.remainingFrames ?? null,
    message: !fresh ? 'Australian collection is stale.' : data.status === 'failed' ? 'Australian collection failed; missing records do not mean no storms.' : data.details?.remaining24h ? 'Australian history is still backfilling.' : 'Australia-wide Xweather modeled hail threats; not confirmed ground reports.' };
}

export async function australianHailDigest(start: Date, end: Date) {
  const admin = createAdminClient(), health = await australianHailHealth(end);
  let count = 0, maximumMM: number | null = null;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from('storm_events').select('metadata').like('event_key', 'xweather:au:hail:%').gte('source_updated_at', start.toISOString()).lte('event_start', end.toISOString()).order('event_key').range(offset, offset + 999);
    if (error) throw Error('Australian digest archive unavailable.');
    for (const row of data ?? []) { const event = row.metadata as StormEvent; count++; if (event.maxHailMM != null) maximumMM = Math.max(maximumMM ?? 0, event.maxHailMM); }
    if ((data?.length ?? 0) < 1000) break;
  }
  return { count, maximumMM, complete: health.complete24h, available: health.available };
}
