'use client';
import { useStormTerritoryAddressCount } from './useStormTerritoryAddressCount';
export function StormTerritoryAddressCount({ workspaceId, boundary, label = 'Address pins in this territory', emptyLabel = 'Unknown' }: { label?: string; emptyLabel?: string; workspaceId: string; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon }) {
  const current = useStormTerritoryAddressCount(workspaceId, boundary);
  const count = current.data;
  const value = count && count.count > 0
    ? `${count.partial ? 'At least ' : ''}${count.count.toLocaleString()}`
    : count?.partial ? 'Unknown' : emptyLabel;
  return <div className="rounded-lg border border-white/15 bg-white/5 p-2 text-[11px]" aria-live="polite">
    <p className="font-semibold">{label}</p>
    {count ? <><p className="mt-1 text-lg font-bold text-cyan-800 dark:text-cyan-200">{value}</p><p className="text-[10px] text-muted-foreground">Mapped-address estimate · {count.regions.join(', ')}. Duplicates excluded. Addresses may include businesses.{count.partial ? ' Some regional tiles were unavailable.' : ' Tile coverage may omit addresses.'}</p></> : current.error ? <><p className="mt-1 text-lg font-bold">Unknown</p><p role="alert" className="mt-1 text-amber-800 dark:text-amber-200">{current.error}</p><button type="button" onClick={() => current.retry()} className="mt-1 text-primary underline">Retry count</button></> : <p className="mt-1 text-muted-foreground">Counting address pins…</p>}
  </div>;
}
