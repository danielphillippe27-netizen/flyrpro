'use client';
import { useEffect, useState } from 'react';
type Count = { count: number; partial: boolean; zoom: number; regions: string[] };
export function StormTerritoryAddressCount({ workspaceId, boundary }: { workspaceId: string; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon }) {
  const serialized = JSON.stringify(boundary);
  const key = `${workspaceId}:${serialized}`;
  const [result, setResult] = useState<{ key: string; data?: Count; error?: string }>({ key: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setResult({ key });
    const timer = setTimeout(() => {
      fetch(`/api/storm-maps/intelligence/address-count?workspaceId=${encodeURIComponent(workspaceId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialized, signal: abort.signal }).then(async response => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Address count unavailable.');
        if (!abort.signal.aborted) setResult({ key, data });
      }).catch(reason => { if (!abort.signal.aborted) setResult({ key, error: reason instanceof Error ? reason.message : 'Address count unavailable.' }); });
    }, 500);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [key, workspaceId, serialized, retry]);
  const current = result.key === key ? result : { key };
  return <div className="rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]" aria-live="polite">
    <p className="font-semibold">Address pins in this territory</p>
    {current.data ? <><p className="mt-1 text-lg font-bold text-cyan-200">{current.data.partial ? 'At least ' : ''}{current.data.count.toLocaleString()}</p><p className="text-[10px] text-slate-400">Mapped-address estimate · {current.data.regions.join(', ')}. Duplicates excluded; addresses may include businesses.{current.data.partial ? ' Some regional tiles were unavailable.' : ' Tile coverage may omit addresses.'}</p></> : current.error ? <><p role="alert" className="mt-1 text-amber-200">{current.error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-1 text-cyan-200 underline">Retry count</button></> : <p className="mt-1 text-slate-400">Counting address pins…</p>}
  </div>;
}
