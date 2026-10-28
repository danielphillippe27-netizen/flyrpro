'use client';
import { useStormTerritoryAddressCount } from './useStormTerritoryAddressCount';
export function StormTerritoryAddressCount({ workspaceId, boundary, label = 'Address pins in this territory' }: { label?: string; workspaceId: string; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon }) {
  const current = useStormTerritoryAddressCount(workspaceId, boundary);
  return <div className="rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]" aria-live="polite">
    <p className="font-semibold">{label}</p>
    {current.data ? <><p className="mt-1 text-lg font-bold text-cyan-800 dark:text-cyan-200">{current.data.count > 0 ? `${current.data.partial ? 'At least ' : ''}${current.data.count.toLocaleString()}` : 'Unknown'}</p><p className="text-[10px] text-slate-400">Mapped-address estimate · {current.data.regions.join(', ')}. Duplicates excluded; addresses may include businesses.{current.data.partial ? ' Some regional tiles were unavailable.' : ' Tile coverage may omit addresses.'}</p></> : current.error ? <><p className="mt-1 text-lg font-bold">Unknown</p><p role="alert" className="mt-1 text-amber-800 dark:text-amber-200">{current.error}</p><button type="button" onClick={() => current.retry()} className="mt-1 text-cyan-200 underline">Retry count</button></> : <p className="mt-1 text-slate-400">Counting address pins…</p>}
  </div>;
}
