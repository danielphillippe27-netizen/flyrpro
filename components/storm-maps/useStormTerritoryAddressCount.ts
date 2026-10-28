'use client';
import { useEffect, useState } from 'react';

export type StormAddressCount = { count: number; partial: boolean; zoom: number; regions: string[] };
type Entry = { promise: Promise<StormAddressCount>; abort: AbortController; users: number; settled: boolean; expires: number };
// The count display and campaign action share one scan of the same workspace/boundary.
const scans = new Map<string, Entry>();
function acquire(key: string, workspaceId: string, body: string, endpoint: string): Entry {
  const previous = scans.get(key);
  if (previous && (!previous.settled || previous.expires > Date.now())) { previous.users++; return previous; }
  const abort = new AbortController();
  const entry: Entry = { abort, users: 1, settled: false, expires: 0, promise: Promise.resolve(null as never) };
  entry.promise = fetch(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: abort.signal,
  }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Address count unavailable.');
    if (!Number.isFinite(data.count) || data.count < 0) throw new Error('Address count unavailable.');
    entry.settled = true; entry.expires = Date.now() + 30_000;
    return data as StormAddressCount;
  }).catch(error => { if (scans.get(key) === entry) scans.delete(key); throw error; });
  scans.set(key, entry);
  if (scans.size > 64) for (const [oldKey, old] of scans) {
    if (!old.users && old.settled) scans.delete(oldKey);
    if (scans.size <= 64) break;
  }
  return entry;
}
export function useStormTerritoryAddressCount(workspaceId: string, boundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null, endpoint = '/api/storm-maps/intelligence/address-count') {
  const serialized = boundary ? JSON.stringify(boundary) : '';
  const key = `${endpoint}:${workspaceId}:${serialized}`;
  const [result, setResult] = useState<{ key: string; data?: StormAddressCount; error?: string }>({ key: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!serialized || !workspaceId) return;
    let active = true;
    let entry: Entry | undefined;
    setResult({ key });
    const timer = setTimeout(() => {
      entry = acquire(key, workspaceId, serialized, endpoint);
      entry.promise.then(data => { if (active) setResult({ key, data }); })
        .catch(reason => { if (active) setResult({ key, error: reason instanceof Error ? reason.message : 'Address count unavailable.' }); });
    }, 500);
    return () => {
      active = false; clearTimeout(timer);
      if (entry && --entry.users === 0 && !entry.settled) {
        entry.abort.abort();
        if (scans.get(key) === entry) scans.delete(key);
      }
    };
  }, [key, workspaceId, serialized, retry, endpoint]);
  return { ...(result.key === key ? result : { key }), retry: () => setRetry(value => value + 1) };
}
