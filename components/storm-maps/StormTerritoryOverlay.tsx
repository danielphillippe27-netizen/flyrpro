'use client';
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { feature, featureCollection, pointOnFeature } from '@turf/turf';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';

export function useSavedStormTerritory(workspaceId: string | null | undefined, territoryId: string | undefined) {
  const key = `${workspaceId ?? ''}:${territoryId ?? ''}`;
  const [result, setResult] = useState<{ key: string; territory: SavedStormTerritory | null; error: string }>({ key: '', territory: null, error: '' });
  useEffect(() => {
    if (!workspaceId || !territoryId) return;
    const abort = new AbortController();
    fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}&id=${encodeURIComponent(territoryId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Storm territory unavailable.');
      const territory = (data.territories as SavedStormTerritory[]).find(value => value.id === territoryId);
      if (!territory) throw new Error('Saved storm territory not found.');
      if (!abort.signal.aborted) setResult({ key, territory, error: '' });
    }).catch(reason => { if (!abort.signal.aborted) setResult({ key, territory: null, error: reason instanceof Error ? reason.message : 'Storm territory unavailable.' }); });
    return () => abort.abort();
  }, [workspaceId, territoryId, key]);
  return result.key === key ? result : { key, territory: null, error: '' };
}

export function StormTerritoryOverlay({ map, territory }: { map: mapboxgl.Map; territory: SavedStormTerritory | null }) {
  useEffect(() => {
    const source = 'campaign-storm-territory', ids = [`${source}-label`, `${source}-line`, `${source}-casing`, `${source}-fill`];
    const clear = () => {
      // A basemap replacement or parent teardown can remove the style first.
      try {
        for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(source)) map.removeSource(source);
      } catch { /* Layers have already gone with the old style/map. */ }
    };
    const show = () => {
      if (!map.isStyleLoaded()) return;
      clear(); if (!territory) return;
      const polygon = feature(territory.boundary), point = pointOnFeature(polygon);
      const { minimumHailMM: min, maximumHailMM: max } = territory.context;
      const gust=territory.context.gustSelection;
      const intensity = gust ? `Estimated wind ${Math.round(gust.minimumKPH)}${gust.maximumKPH==null?'+':`–${Math.round(gust.maximumKPH)}`} km/h · ${gust.time.slice(11,16)} UTC` : min == null ? 'User-drawn storm territory' : min === 0 ? `Hail >0 to <${max ?? 12.7} mm` : `Hail ${min.toFixed(1)} mm${max == null ? '+' : `–<${max.toFixed(1)} mm`}`;
      point.properties = { label: `${territory.name} · ${intensity}` };
      map.addSource(source, { type: 'geojson', data: featureCollection<GeoJSON.Geometry>([polygon, point]) });
      map.addLayer({ id: `${source}-fill`, type: 'fill', source, paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.1 } });
      map.addLayer({ id: `${source}-casing`, type: 'line', source, paint: { 'line-color': '#ffffff', 'line-width': 6 } });
      map.addLayer({ id: `${source}-line`, type: 'line', source, paint: { 'line-color': '#111111', 'line-width': 3 } });
      map.addLayer({ id: `${source}-label`, type: 'symbol', source, filter: ['==', '$type', 'Point'], layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#111111', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    };
    const recover=()=>{if(!map.isStyleLoaded())return;const exists=!!map.getSource(source);if(territory?!exists:exists)show();};
    show(); map.on('style.load', show);map.on('idle',recover);
    return () => {
      map.off('style.load', show);map.off('idle',recover);
      try { clear(); } catch { /* The parent map has already been disposed. */ }
    };
  }, [map, territory]);
  return null;
}
