'use client';
import { feature, featureCollection, pointOnFeature } from '@turf/turf';
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
const SOURCE = 'wolfgrid-saved-storm-territory', FILL = `${SOURCE}-fill`, LINE = `${SOURCE}-line`, LABEL = `${SOURCE}-label`;
type Props = { map: mapboxgl.Map; workspaceId: string; revision: number; active: SavedStormTerritory | null; onSelect: (territory: SavedStormTerritory | null) => void; onCampaign: (territory: SavedStormTerritory) => void };
export function SavedStormTerritories({ map, workspaceId, revision, active, onSelect, onCampaign }: Props) {
  const [territories, setTerritories] = useState<SavedStormTerritory[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.territories;
    }).then(data => { if (!abort.signal.aborted) setTerritories(data); }).catch(reason => { if (!abort.signal.aborted) setError(reason.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [workspaceId, revision]);
  useEffect(() => {
    const clear = () => {
      if (map.getLayer(LABEL)) map.removeLayer(LABEL);
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
    const show = () => {
      clear(); if (!active || !map.isStyleLoaded()) return;
      const polygon = feature(active.boundary), point = pointOnFeature(polygon);
      point.properties = { label: `${active.name} · ${active.context.minimumHailMM == null ? 'User-drawn storm territory' : `Hail ${active.context.minimumHailMM.toFixed(1)} mm${active.context.maximumHailMM == null ? '+' : `–<${active.context.maximumHailMM.toFixed(1)} mm`}`}` };
      map.addSource(SOURCE, { type: 'geojson', data: featureCollection<GeoJSON.Geometry>([polygon, point]) });
      map.addLayer({ id: FILL, type: 'fill', source: SOURCE, paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.07 } });
      map.addLayer({ id: LINE, type: 'line', source: SOURCE, paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: LABEL, type: 'symbol', source: SOURCE, filter: ['==', '$type', 'Point'], layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#67e8f9', 'text-halo-color': '#020617', 'text-halo-width': 2 } });
    };
    show(); map.on('style.load', show);
    return () => { map.off('style.load', show); clear(); };
  }, [active, map]);
  const select = (territory: SavedStormTerritory) => {
    onSelect(territory);
    const positions = territory.boundary.coordinates[0];
    map.fitBounds([[Math.min(...positions.map(p => p[0])),Math.min(...positions.map(p => p[1]))],[Math.max(...positions.map(p => p[0])),Math.max(...positions.map(p => p[1]))]], { padding: 100, maxZoom: 12, pitch: 0, bearing: 0, duration: 600 });
  };
  return <details open={!!active} className="mt-4 rounded-xl border border-cyan-300/25 p-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-200">Saved storm territories</summary><div className="mt-3 space-y-2">
    {loading && <p role="status" className="text-[11px]">Loading territories…</p>}
    {error && <p role="alert" className="text-[11px] text-amber-200">{error}</p>}
    {!loading && !error && !territories.length && <p className="text-[11px] text-slate-400">Select a hail intensity zone and save its boundary here.</p>}
    {territories.map(territory => <button key={territory.id} type="button" aria-pressed={active?.id === territory.id} onClick={() => select(territory)} className={`w-full rounded-lg border p-2 text-left text-xs ${active?.id === territory.id ? 'border-cyan-300' : 'border-white/15'}`}><p className="font-semibold">{territory.name}</p><p className="mt-1 text-[10px] text-slate-400">{territory.context.event.start.slice(0,10)} · {territory.context.minimumHailMM == null ? 'Storm inspection area' : `${territory.context.minimumHailMM.toFixed(1)} mm${territory.context.maximumHailMM == null ? '+' : `–${territory.context.maximumHailMM.toFixed(1)} mm`}`}</p></button>)}
    {active && <div className="space-y-2 border-t border-white/10 pt-3"><p className="text-xs font-semibold">{active.name}</p><p className="text-[10px] text-slate-400">Cyan outline: saved storm territory. Draw a smaller campaign inside it. Reopen this territory to create more campaigns.</p><button type="button" onClick={() => onCampaign(active)} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold">Draw campaign inside territory</button><button type="button" onClick={() => onSelect(null)} className="text-[11px] text-cyan-200">Hide territory</button></div>}
  </div></details>;
}
