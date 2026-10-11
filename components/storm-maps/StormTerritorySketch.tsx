'use client';
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { stormTerritorySchema } from '@/lib/storm-maps/intelligence/storm-territories';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';

type Props = { map: mapboxgl.Map; context: StormCampaignContext; onSave: (name: string, boundary: GeoJSON.Polygon, context: StormCampaignContext) => Promise<void>; onSelecting: (selecting: boolean) => void };
const SOURCE = 'wolfgrid-storm-territory-sketch';
export function StormTerritorySketch({ map, context, onSave, onSelecting }: Props) {
  const [drawing, setDrawing] = useState(false), [points, setPoints] = useState<number[][]>([]);
  const [name, setName] = useState(`${context.event.title} territory`.slice(0, 160)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { onSelecting(drawing); return () => onSelecting(false); }, [drawing, onSelecting]);
  useEffect(() => {
    if (!drawing) return;
    const canvas = map.getCanvas(), cursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    const click = (event: mapboxgl.MapMouseEvent) => { setPoints(value => [...value, [event.lngLat.lng, event.lngLat.lat]]); setError(''); };
    map.on('click', click);
    return () => { map.off('click', click); canvas.style.cursor = cursor; };
  }, [drawing, map]);
  useEffect(() => {
    const clear = () => {
      for (const id of [`${SOURCE}-line`, `${SOURCE}-fill`]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
    const show = () => {
      clear(); if (!map.isStyleLoaded() || points.length < 2) return;
      const geometry: GeoJSON.Geometry = points.length < 3 ? { type: 'LineString', coordinates: points } : { type: 'Polygon', coordinates: [[...points, points[0]]] };
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry } });
      map.addLayer({ id: `${SOURCE}-fill`, type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 } });
      map.addLayer({ id: `${SOURCE}-line`, type: 'line', source: SOURCE, paint: { 'line-color': '#22d3ee', 'line-width': 3 } });
    };
    show(); map.on('style.load', show);
    return () => { map.off('style.load', show); clear(); };
  }, [map, points]);
  const save = async () => {
    if (points.length < 3) return;
    const boundary: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[...points, points[0]]] };
    const parsed = stormTerritorySchema.safeParse({ name, boundary, context });
    if (!parsed.success) { setError('Choose a name and a non-crossing territory smaller than 500 km².'); return; }
    setBusy(true); setDrawing(false); setError('');
    try { await onSave(parsed.data.name, boundary, context); setPoints([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save territory.'); }
    finally { setBusy(false); }
  };
  return <div className="mt-4 space-y-2 rounded-xl border border-cyan-300/25 p-3">
    <h3 className="text-xs font-semibold text-cyan-200">Draw a storm territory</h3>
    <p className="text-[10px] text-slate-400">Reports and hurricane tracks do not define a damage boundary. Draw the territory you want to inspect, then save it before creating campaigns.</p>
    <label className="block text-[11px]">Territory name<input aria-label="Drawn storm territory name" value={name} maxLength={160} disabled={busy} onChange={event => setName(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-slate-900 px-2" /></label>
    <button type="button" disabled={busy} onClick={() => setDrawing(value => !value)} className="w-full rounded-lg border border-cyan-300/40 py-2 text-xs text-cyan-200">{drawing ? 'Pause drawing' : points.length ? 'Continue drawing' : 'Draw territory on the map'}</button>
    {drawing && <p role="status" className="text-[10px]">Click each corner of the territory. {points.length} points placed.</p>}
    {points.length > 0 && <button type="button" disabled={busy} onClick={() => setPoints(value => value.slice(0, -1))} className="text-[11px] text-cyan-200">Undo last point</button>}
    <button type="button" disabled={busy || points.length < 3 || !name.trim()} onClick={save} className="w-full rounded-lg bg-red-500 py-2.5 text-xs font-semibold disabled:opacity-40">{busy ? 'Saving…' : 'Save storm territory'}</button>
    {points.length > 0 && <button type="button" disabled={busy} onClick={() => { setDrawing(false); setPoints([]); }} className="text-[11px] text-cyan-200">Clear territory</button>}
    {error && <p role="alert" className="text-[11px] text-amber-200">{error}</p>}
  </div>;
}
