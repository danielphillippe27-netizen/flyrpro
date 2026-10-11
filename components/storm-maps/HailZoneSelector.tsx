'use client';
import { StormTerritoryAddressCount } from './StormTerritoryAddressCount';
import { pointOnFeature, featureCollection } from '@turf/turf';
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { MapboxMapController } from '@xweather/mapsgl';
import { HAIL_BANDS, bandForHail, connectedHailCells, hailCellsPolygon, smoothHailBoundary, hailMillimeters } from '@/lib/storm-maps/intensity/hail-zone';

const SOURCE = 'wolfgrid-hail-zone-preview';
const FILL = `${SOURCE}-fill`, LINE = `${SOURCE}-line`, LABEL = `${SOURCE}-label`, CASING = `${SOURCE}-casing`;
const label = (mm: number) => mm === 0 ? 'Trace hail (>0 mm)' : `${(mm / 25.4).toLocaleString(undefined, { maximumFractionDigits: 1 })}″ / ${mm.toFixed(1)} mm`;
type Zone = { name: string; polygon: GeoJSON.Feature<GeoJSON.Polygon>; minimum: number; maximum: number | null; sampledMM: number; cellMeters: number };
type Props = { map: mapboxgl.Map; controller: MapboxMapController; windowKey: string; workspaceId?: string; onSelecting?: (active: boolean) => void; onApply: (zone: Zone) => void | Promise<void> };

export function HailZoneSelector({ map, controller, windowKey, workspaceId, onApply, onSelecting }: Props) {
  const [armed, setArmed] = useState(true), [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState('auto'), [bandOnly, setBandOnly] = useState(false);
  const [zone, setZone] = useState<Zone | null>(null), [error, setError] = useState('');
  const [saved,setSaved]=useState(false);
  const [name, setName] = useState('Storm territory');
  const sequence = useRef(0);
  useEffect(() => {
    const candidates=controller.getWeatherLayer('hail-size-max');
    const layers=Array.isArray(candidates)?candidates:candidates?[candidates]:[];
    const ids:string[]=[];
    try {
      for(const [index,layer] of layers.entries()){
        const id='wolfgrid-hail-selection-contours-'+index;
        if(controller.hasLayer(id))controller.removeLayer(id);
        controller.addLayer(id,{type:'contour',source:layer.source,paint:{opacity:0.65,stroke:{color:'#111111'},sample:{channel:'r'},contour:{interval:12.7,majorInterval:25.4,width:1,majorWidth:1.5}}});
        ids.push(id);
      }
    } catch { setError('Hail contour lines could not load. Zone selection is still available.'); }
    return()=>{for(const id of ids){try{if(controller.hasLayer(id))controller.removeLayer(id);}catch{/* controller disposed */}}};
  },[controller,windowKey]);
  useEffect(() => {
    const requestSequence = sequence;
    setArmed(true); setBusy(false); setZone(null); setError(''); requestSequence.current++;
    return () => { requestSequence.current++; };
  }, [windowKey]);
  useEffect(() => { onSelecting?.(armed || busy); return () => onSelecting?.(false); }, [armed, busy, onSelecting]);
  useEffect(() => {
    const invalidate = () => { sequence.current++; setBusy(false); setZone(null); setArmed(true); };
    map.on('movestart', invalidate);
    map.on('style.load', invalidate);
    return () => { map.off('movestart', invalidate); map.off('style.load', invalidate); };
  }, [map]);
  useEffect(() => {
    const clear = () => {
      if (map.getLayer(LABEL)) map.removeLayer(LABEL);
      if (map.getLayer(CASING)) map.removeLayer(CASING);
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
    if (!zone || !map.isStyleLoaded()) return;
    const point = pointOnFeature(zone.polygon);
    point.properties = { label: `Hail ${label(zone.minimum)}${zone.maximum == null ? '+' : ` – <${label(zone.maximum)}`}` };
    map.addSource(SOURCE, { type: 'geojson', data: featureCollection<GeoJSON.Geometry>([zone.polygon, point]) });
    map.addLayer({ id: FILL, type: 'fill', source: SOURCE, paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.12 } });
    map.addLayer({ id: CASING, type: 'line', source: SOURCE, layout:{'line-join':'round','line-cap':'round'}, paint: { 'line-color': '#111111', 'line-width': 2 } });
    map.addLayer({ id: LINE, type: 'line', source: SOURCE, layout:{'line-join':'round','line-cap':'round'}, paint: { 'line-color': '#111111', 'line-width': 2 } });
    map.addLayer({ id: LABEL, type: 'symbol', source: SOURCE, filter: ['==', '$type', 'Point'], layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#020617', 'text-halo-width': 2 } });
    return clear;
  }, [map, zone]);
  useEffect(() => {
    if (!armed) return;
    const canvas = map.getCanvas(), previous = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    const select = async (event: mapboxgl.MapMouseEvent) => {
      const request = ++sequence.current;
      setBusy(true); setZone(null); setError(''); setArmed(false);
      const valid = () => request === sequence.current;
      const deadline = Date.now() + 25_000;
      try {
        if (map.getZoom() < 7) throw new Error('Zoom to a regional or neighborhood view before selecting a zone.');
        if (map.getPitch() > 5) throw new Error('Switch to a flat map before selecting a zone.');
        const bounds = map.getBounds(); if (!bounds) throw new Error('Map bounds are unavailable.');
        const extent: [number,number,number,number] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
        if (extent[2] <= extent[0] || extent[2] - extent[0] > 180) throw new Error('Choose a smaller region away from the date line.');
        const candidates = controller.getWeatherLayer('hail-size-max');
        const layers = (Array.isArray(candidates) ? candidates : candidates ? [candidates] : []);
        if (!layers.length) throw new Error('Hail estimates are not loaded yet. Try again after the map finishes loading.');
        controller.timeline.pause();
        const zoom = map.getZoom();
        const sample = async (lon: number, lat: number) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const samples = await Promise.race([
            Promise.all(layers.map(layer => layer.queryFeaturesPromise({ lon, lat }, zoom, false))),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Hail sampling took too long. Wait for the map to load, then retry.')), Math.max(1, deadline - Date.now())); }),
          ]).finally(() => { if (timeout) clearTimeout(timeout); });
          const values = samples.map(hailMillimeters).filter((value): value is number => value != null);
          return values.length ? Math.max(...values) : null;
        };
        const clicked = await sample(event.lngLat.lng, event.lngLat.lat);
        if (clicked == null) throw new Error('No numerical hail estimate is available here. Choose a shaded area or draw a boundary manually.');
        const band = bandForHail(threshold === 'auto' ? clicked : Number(threshold));
        const minimum = band.minimum, maximum = bandOnly ? band.maximum : null;
        const size = 128, values: (number | null)[] = Array(size * size).fill(null);
        const dx = (extent[2] - extent[0]) / size, dy = (extent[3] - extent[1]) / size;
        let next = 0;
        await Promise.all(Array.from({ length: 12 }, async () => {
          while (next < values.length && valid()) {
            if (Date.now() > deadline) throw new Error('Hail sampling took too long. Wait for the map to load, then retry.');
            const id = next++;
            values[id] = await sample(extent[0] + (id % size + 0.5) * dx, extent[1] + (Math.floor(id / size) + 0.5) * dy);
          }
        }));
        if (!valid()) return;
        const x = Math.floor((event.lngLat.lng - extent[0]) / dx), y = Math.floor((event.lngLat.lat - extent[1]) / dy);
        const cells = connectedHailCells(values, size, size, y * size + x, minimum, maximum);
        for (const id of cells) for (const adjacent of [id-1,id+1,id-size,id+size]) {
          if (values[adjacent] == null) throw new Error('Hail data is incomplete near this zone. Wait for loading to finish and retry.');
        }
        const polygon = smoothHailBoundary(hailCellsPolygon(cells, size, size, extent));
        setZone({ name, polygon, minimum, maximum, sampledMM: clicked, cellMeters: Math.round(Math.max(dx * 111320 * Math.cos(event.lngLat.lat * Math.PI / 180), dy * 111320)) });
      } catch (reason) {
        if (valid()) { sequence.current++; setBusy(false); setArmed(true); setError(reason instanceof Error ? reason.message : 'Could not select this hail zone.'); }
      } finally { if (valid()) setBusy(false); }
    };
    map.on('click', select);
    return () => { canvas.style.cursor = previous; map.off('click', select); };
  }, [armed, map, controller, threshold, bandOnly, name]);
  const reset = () => { setSaved(false);sequence.current++; setBusy(false); setZone(null); setError(''); };
  return <div className="space-y-2 rounded-xl border border-cyan-300/25 bg-cyan-300/5 p-3">
    <h3 className="text-xs font-semibold text-cyan-200">Select hail zone</h3>
    <label className="block text-[11px]">Hail size<select aria-label="Hail zone threshold" value={threshold} disabled={busy} onChange={event => { reset(); setThreshold(event.target.value); }} className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-slate-900 px-2"><option value="auto">Use the intensity I click</option>{HAIL_BANDS.map(mm => <option key={mm} value={mm}>{label(mm)}</option>)}</select></label>
    <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={bandOnly} disabled={busy} onChange={event => { reset(); setBandOnly(event.target.checked); }} />Exclude stronger hail</label>
    <button type="button" disabled={busy} aria-pressed={armed} onClick={() => { reset(); setArmed(value => !value); }} className="w-full rounded-lg border border-cyan-300/40 py-2 text-xs text-cyan-200 disabled:opacity-50">{busy ? 'Finding the connected zone…' : armed ? 'Cancel zone selection' : 'Click a zone on the map'}</button>
    {armed && <p role="status" className="text-[10px]">Click a colour area. Black lines show the hail levels.</p>}
    {busy && !zone && <button type="button" onClick={reset} className="text-xs text-cyan-200">Cancel</button>}
    {error && <p role="alert" className="text-[11px] text-amber-200">{error}</p>}
    {saved&&<p role="status" className="text-xs text-cyan-200">Storm territory saved.</p>}{zone && <>{workspaceId && <StormTerritoryAddressCount workspaceId={workspaceId} boundary={zone.polygon.geometry} />}<p className="text-[11px]">Selected {label(zone.minimum)}{zone.maximum == null ? ' or greater' : ` to under ${label(zone.maximum)}`}.</p><p className="text-[10px] text-slate-400">Clicked estimate: {label(zone.sampledMM)}. Estimated boundary · {zone.cellMeters.toLocaleString()} m detail.</p><label className="block text-[11px]">Territory name<input aria-label="Storm territory name" value={name} maxLength={160} disabled={busy} onChange={event => setName(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-slate-900 px-2" /></label><button type="button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); setError(''); try { await onApply({ ...zone, name: name.trim() }); setSaved(true);setBusy(false); } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : 'Could not save territory.'); } }} className="w-full rounded-lg bg-red-500 py-2.5 text-xs font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save storm territory'}</button><button type="button" disabled={busy} onClick={reset} className="text-xs text-cyan-200">Clear selection</button></>}
    <p className="text-[10px] text-slate-400">Estimated hail zone. Address counts cover this outline; they do not confirm damage.</p>
  </div>;
}
