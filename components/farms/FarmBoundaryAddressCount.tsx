'use client';

import { useEffect, useState, type RefObject } from 'react';
import type mapboxgl from 'mapbox-gl';
import type MapboxDraw from '@mapbox/mapbox-gl-draw';
import { Building2 } from 'lucide-react';
import { getDrawnPolygon } from '@/lib/territory/create-polygon';
import { useStormTerritoryAddressCount } from '@/components/storm-maps/useStormTerritoryAddressCount';

export function FarmBoundaryAddressCount({ map, draw, mapLoaded, workspaceId }: {
  map: RefObject<mapboxgl.Map | null>;
  draw: RefObject<MapboxDraw | null>;
  mapLoaded: boolean;
  workspaceId: string | null;
}) {
  const [boundary, setBoundary] = useState<GeoJSON.Polygon | null>(null);
  useEffect(() => {
    const instance = map.current;
    if (!mapLoaded || !instance) return;
    let previous = '';
    const update = () => {
      const polygon = getDrawnPolygon(draw.current);
      const serialized = JSON.stringify(polygon);
      if (serialized === previous) return;
      previous = serialized;
      setBoundary(polygon);
    };
    // Idle also observes programmatic boundary imports, clears and style restores.
    const events = ['draw.create', 'draw.update', 'draw.delete', 'idle'];
    events.forEach(event => instance.on(event, update));
    update();
    return () => { events.forEach(event => instance.off(event, update)); };
  }, [map, draw, mapLoaded]);
  const current = useStormTerritoryAddressCount(workspaceId ?? '', boundary, '/api/farms/address-count');
  return <div className="rounded-xl border border-border bg-card px-3 py-3" aria-live="polite">
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><Building2 className="h-4 w-4" aria-hidden="true" />Address pins</span>
      <span className="text-lg font-bold tabular-nums">{!boundary ? '0' : current.data ? `${current.data.partial ? 'At least ' : ''}${current.data.count.toLocaleString()}` : current.error ? 'Unavailable' : 'Counting…'}</span>
    </div>
    {!boundary && <p className="mt-1 text-xs text-muted-foreground">Draw a boundary to count its addresses.</p>}
    {current.data?.partial && <p className="mt-1 text-xs text-muted-foreground">Some regional data was unavailable.</p>}
    {current.error && <div className="mt-2 text-xs"><p role="alert">{current.error}</p><button type="button" onClick={current.retry} className="mt-1 underline">Retry count</button></div>}
  </div>;
}
