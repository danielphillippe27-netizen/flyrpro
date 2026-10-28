import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { createAdminClient } from '@/lib/supabase/server';
import type { StormEvent } from './model';
import { AU_FRAME_PREFIX, AU_HAIL_PRODUCT, australianFramesToCollect, australianHailFrame, mergeAustralianEvent, type AustralianHailFrame } from './australian-hail-format';

const ORIGIN = 'https://prod.v1.mapsgl.api.xweather.com';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function collectAustralianHail(now = new Date(), runTag = 'scheduled') {
  const admin = createAdminClient();
  // A durable claim prevents overlapping scheduled collectors; a later run retries failures.
  const window = `au-hail-run:${now.toISOString().slice(0, 16)}:${runTag}`;
  const { error: claim } = await admin.from('storm_collection_runs').insert({ window_key: window });
  if (claim) { if (claim.code === '23505') return { status: 'already_attempted', window }; throw Error('Australian archive ledger unavailable.'); }
  try {
    const id = process.env.XWEATHER_CLIENT_ID, secret = process.env.XWEATHER_CLIENT_SECRET;
    if (!id || !secret) throw Error('Australian Xweather credentials unavailable.');
    const auth = await fetch(`${ORIGIN}/auth/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!auth.ok) throw Error('Australian weather authentication failed.');
    const session = await auth.json();
    if (typeof session.access_token !== 'string') throw Error('Australian weather authentication failed.');
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const metadata = await fetch(`${ORIGIN}/vector/?products=hail-threats-nowcast`, { headers, signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!metadata.ok) throw Error('Australian hail timeline unavailable.');
    const body = await metadata.json(), times = body['hail-threats-nowcast']?.validTimes;
    if (!Array.isArray(times) || !times.length || times.some(t => typeof t !== 'string' || !Number.isFinite(Date.parse(t)))) throw Error('Invalid Australian hail timeline.');
    const available: string[] = [...new Set<string>(times)].filter(t => Date.parse(t) <= +now && Date.parse(t) >= +now - 7 * 86400000).sort((a, b) => Date.parse(a) - Date.parse(b));
    if (!available.length || +now - Date.parse(available.at(-1)!) > 20 * 60000) throw Error('Australian hail timeline is stale.');
    const completed = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from('storm_collection_runs').select('window_key').like('window_key', `${AU_FRAME_PREFIX}%`).eq('status', 'complete').gte('started_at', available[0]).order('window_key').range(offset, offset + 999);
      if (error) throw Error('Australian frame history unavailable.');
      for (const row of data ?? []) completed.add(row.window_key.slice(AU_FRAME_PREFIX.length));
      if ((data?.length ?? 0) < 1000) break;
    }
    const selected = australianFramesToCollect(available, completed, now), frames: AustralianHailFrame[] = [], failed: string[] = [];
    for (let offset = 0; offset < selected.length; offset += 6) {
      await Promise.all(selected.slice(offset, offset + 6).map(async time => {
        try {
          const response = await fetch(`${ORIGIN}/vector/hail-threats-nowcast/${encodeURIComponent(time)}/0/0/0.pbf`, { headers, signal: AbortSignal.timeout(20000), cache: 'no-store' });
          if (!response.ok) throw Error('Hail frame unavailable.');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > 8000000) throw Error('Hail frame exceeds budget.');
          const tile = new VectorTile(new Pbf(bytes)), layer = tile.layers['threat-zones-hail-nowcast'];
          if (!layer) throw Error('Hail vector layer missing.');
          const features = Array.from({ length: layer.length }, (_, index) => layer.feature(index).toGeoJSON(0, 0, 0));
          frames.push(australianHailFrame(features, time));
        } catch { failed.push(time); }
      }));
    }
    const events = new Map<string, StormEvent>(), seen = new Map<string, string>();
    for (const frame of frames.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) for (const event of frame.events) {
      events.set(event.key, mergeAustralianEvent(events.get(event.key), event)); seen.set(event.key, new Date(frame.time).toISOString());
    }
    const keys = [...events.keys()];
    for (let offset = 0; offset < keys.length; offset += 100) {
      const { data, error } = await admin.from('storm_events').select('event_key,metadata,source_updated_at').in('event_key', keys.slice(offset, offset + 100));
      if (error) throw Error('Australian event history unavailable.');
      for (const row of data ?? []) { events.set(row.event_key, mergeAustralianEvent(row.metadata as StormEvent, events.get(row.event_key)!)); if (Date.parse(row.source_updated_at) > Date.parse(seen.get(row.event_key)!)) seen.set(row.event_key, row.source_updated_at); }
    }
    if (keys.length) {
      const { error } = await admin.from('storm_events').upsert([...events.values()].map(event => ({ event_key: event.key, provider_event_id: event.sourceId, hazard: 'hail', source: 'xweather', event_start: event.start, event_end: event.end, source_updated_at: seen.get(event.key), metadata: event })), { onConflict: 'event_key' });
      if (error) throw Error('Australian event archive write failed.');
      const snapshots = frames.flatMap(frame => frame.events.map(event => ({ event_key: event.key, content_hash: hash(JSON.stringify([frame.time, event])), payload: { frameTime: frame.time, evidence: 'modeled-hail-threat', event }, captured_at: now.toISOString() })));
      for (let offset = 0; offset < snapshots.length; offset += 500) {
        const { error } = await admin.from('storm_event_snapshots').upsert(snapshots.slice(offset, offset + 500), { onConflict: 'event_key,content_hash', ignoreDuplicates: true });
        if (error) throw Error('Australian snapshots could not be saved.');
      }
      const raw = gzipSync(JSON.stringify({ product: 'hail-threats-nowcast', geometry: 'simplified vector display geometry at zoom 0; not a damage footprint', frames: frames.filter(frame => frame.events.length) }));
      const digest = hash(raw), path = `xweather/${AU_HAIL_PRODUCT}/${now.toISOString().slice(0, 10)}/${digest}.gz`;
      const { error: upload } = await admin.storage.from('storm-archive').upload(path, raw, { contentType: 'application/gzip', upsert: true });
      if (upload) throw Error('Australian raw archive upload failed.');
      const { error: record } = await admin.from('storm_archive_assets').upsert({ provider: 'xweather', product: AU_HAIL_PRODUCT, content_hash: digest, storage_path: path, source_time: now.toISOString(), byte_size: raw.length, metadata: { country: 'AU', evidence: 'modeled-hail-threat', impactGeometry: false, frames: frames.length, events: keys.length } }, { onConflict: 'provider,product,content_hash' });
      if (record) throw Error('Australian raw archive record failed.');
    }
    // Mark a frame complete only after all its events, snapshots and raw data are durable.
    if (frames.length) {
      const { error } = await admin.from('storm_collection_runs').upsert(frames.map(frame => ({ window_key: `${AU_FRAME_PREFIX}${new Date(frame.time).toISOString()}`, status: 'complete', details: { events: frame.events.length, evidence: 'modeled-hail-threat' }, started_at: new Date(frame.time).toISOString(), completed_at: now.toISOString() })), { onConflict: 'window_key' });
      if (error) throw Error('Australian frame completion failed.');
      frames.forEach(frame => completed.add(new Date(frame.time).toISOString()));
    }
    const remaining = available.filter(time => !completed.has(new Date(time).toISOString()));
    const details = { framesStored: frames.length, eventRecords: keys.length, failedFrames: failed.length, remainingFrames: remaining.length, remaining24h: remaining.filter(t => Date.parse(t) >= +now - 86400000).length, availableFrom: available[0], latestAvailable: available.at(-1), coverage: 'Australia-wide Xweather modeled hail threats. Captures every available frame; not all actual storms or confirmed hail damage.' };
    const status = failed.length ? 'partial' : 'complete';
    const { error } = await admin.from('storm_collection_runs').update({ status, details, completed_at: new Date().toISOString() }).eq('window_key', window);
    if (error) throw Error('Australian collection status write failed.');
    return { status, window, ...details };
  } catch {
    await admin.from('storm_collection_runs').update({ status: 'failed', details: { error: 'Australian hail collection failed. Frames remain retryable; failure is not zero storms.' }, completed_at: new Date().toISOString() }).eq('window_key', window);
    throw Error('Australian hail collection failed. Check provider access and the collection ledger.');
  }
}
