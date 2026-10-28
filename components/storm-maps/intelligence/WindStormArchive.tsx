'use client';
import { useContext, useEffect, useState } from 'react';
import { useStormTerritoryDisplay } from '@/lib/storm-maps/territory-display';
import type mapboxgl from 'mapbox-gl';
import { WIND_COUNTRIES, type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { WindZoneSelector, type SaveWindTerritory } from './WindZoneSelector';
import type { StormWindActions } from '../StormWorkbenchView';
import { StormLocationSearch } from '../StormLocationSearch';
import { StormMobileMapContext } from '@/lib/storm-maps/mobile-session';

type Archive = { indexingPending?: boolean; times: string[]; archiveStartsAt: string | null; coverage: string; health: { available: boolean; message: string; latestAvailable?: string | null } };
const field = 'min-h-11 w-full rounded-lg border border-border bg-background p-2 text-base text-foreground md:text-xs';
const layerId = 'wolfgrid-saved-wind', sourceId = 'wolfgrid-saved-wind-source';
export function WindStormArchive({ map, workspaceId, onView, active, onSave, windActions, simple=false, selectedCountry, selectedTime, selectedMinimum=93.341952, selectedRegions=[] }: { map: mapboxgl.Map; workspaceId: string; onView: () => void; active: boolean; onSave: SaveWindTerritory; windActions?: StormWindActions; simple?: boolean; selectedCountry?: WindCountry; selectedTime?: string; selectedMinimum?: number; selectedRegions?:string[] }) {
  const territoryDisplay = useStormTerritoryDisplay();
  const mobileSessionRevision = useContext(StormMobileMapContext)?.revision ?? 0;
  const [minimum,setMinimum]=useState(String(selectedMinimum));
  const [country, setCountry] = useState<WindCountry>(selectedCountry??'CA');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  useEffect(()=>{if(selectedCountry)setCountry(selectedCountry);},[selectedCountry]);
  const [archive, setArchive] = useState<Archive | null>(null), [time, setTime] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => { onView(); }, [onView]);
  useEffect(() => {
    if(simple)return;
    const query=new URLSearchParams(window.location.search), region=query.get('country'), requested=query.get('windTime');
    const threshold=query.get('minimum'); if(threshold && ['40','60','93.341952','120','160'].includes(threshold))setMinimum(threshold);
    if(!selectedCountry && region && Object.hasOwn(WIND_COUNTRIES,region))setCountry(region as WindCountry);
    if(requested && /^\d{4}-\d{2}-\d{2}T/.test(requested))setDate(requested.slice(0,10));
  }, [simple, selectedCountry]);
  useEffect(() => {
    const bounds = country === 'NZ' ? [166, -48, 185, -33] : [...WIND_COUNTRIES[country].bounds[0]];
    map.setProjection('mercator');
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 35, duration: 500 });
  }, [map, country]);
  useEffect(() => {
    if(simple&&selectedTime){setTime(selectedTime);return;}
    const abort = new AbortController(); setBusy(true); setError(''); setArchive(null); setTime('');
    const query = new URLSearchParams({ workspaceId, country, minimum, from: date, to: date });
    fetch(`/api/storm-maps/intelligence/wind?${query}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Wind history unavailable.');
      if (!abort.signal.aborted) { setArchive(data); const requested=new URLSearchParams(window.location.search).get('windTime'); setTime(data.times.includes(requested) ? requested : data.times[0] ?? ''); }
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Wind history unavailable.'); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [country, date, workspaceId, refresh, minimum, simple, selectedTime]);
  useEffect(() => {
    const clear = () => { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); };
    const apply = () => {
      if (!map.isStyleLoaded()) return;
      clear(); if (!time || !active || territoryDisplay) return;
      const query = new URLSearchParams({ workspaceId, country, time, minimum, rendering: 'land-no-alaska-v3' });
      map.addSource(sourceId, { type: 'raster', tiles: [`${window.location.origin}/api/storm-maps/intelligence/wind/map?${query}&z={z}&x={x}&y={y}`], tileSize: 512, maxzoom: 4, attribution: 'Wind estimates: Vaisala Xweather · WolfGrid archive' });
      map.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } });
    };
    const recover = () => { if (time && active && !territoryDisplay && !map.getSource(sourceId) && map.isStyleLoaded()) apply(); };
    apply(); map.on('style.load', apply); map.on('idle', recover);
    return () => { map.off('style.load', apply); map.off('idle', recover); clear(); };
  }, [map, workspaceId, country, time, active, minimum, mobileSessionRevision, territoryDisplay]);
  if(simple)return <section aria-label="Selected wind map" className="space-y-3 rounded-lg border border-border p-3">
    <p className="text-sm font-semibold">Selected wind map</p><p className="text-xs">{selectedTime?.slice(0,10)} · {selectedTime?.slice(11,16)} UTC · {Math.round(selectedMinimum)} km/h+</p><p className="text-sm font-medium">{selectedRegions.join(', ')}</p><p className="text-xs text-muted-foreground">Estimated gust field over land. Broad weather areas can span many kilometres; this is not a mapped damage path.</p>
    {time&&(active?<>{windActions&&<button type="button" onClick={windActions.inspect} className="min-h-11 w-full rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground">Select wind area on map</button>}<WindZoneSelector simple key={`${country}:${time}`} map={map} workspaceId={workspaceId} country={country} time={time} minimumKPH={selectedMinimum} onSelected={windActions?.review} onSave={onSave}/></>:<button type="button" onClick={onView} className="min-h-11 w-full rounded-lg border border-border text-sm">Show selected wind map</button>)}
  </section>;
  return <section aria-label="Saved wind maps" className="space-y-3">
    <p className="text-sm font-semibold">Historical wind storms</p>
    {!selectedCountry&&<label className="block text-xs">Country<select aria-label="Wind archive country" className={field} value={country} onChange={event => setCountry(event.target.value as WindCountry)}>{Object.entries(WIND_COUNTRIES).filter(([code])=>code!=='NZ').map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>}
    <StormLocationSearch map={map} inline />
    <label className="block text-xs">Show gusts above<select aria-label="Historical wind storm threshold" className={field} value={minimum} onChange={event=>setMinimum(event.target.value)}>{[40,60,93.341952,120,160].map(value=><option key={value} value={value}>{Math.round(value)} km/h · {Math.round(value/1.609344)} mph</option>)}</select></label>
    <p className="text-xs text-muted-foreground">Only gusts meeting this threshold appear. Choose a saved storm hour, then tap a coloured area to create a campaign.</p>
    <label className="block text-xs">Date (UTC)<input aria-label="Wind archive date" className={field} type="date" value={date} min={archive?.archiveStartsAt?.slice(0,10)} max={new Date().toISOString().slice(0, 10)} onChange={event => setDate(event.target.value)} /></label>
    {busy && <p role="status" className="text-xs">Loading saved wind maps…</p>}
    {error && <p role="alert" className="text-xs text-amber-500">{error}</p>}
    {archive && <>
      <p role="status" className="text-xs text-muted-foreground">{archive.health.message}</p>
      {archive.archiveStartsAt && <p className="text-xs">Saved history begins {new Date(archive.archiveStartsAt).toLocaleString()}.</p>}
      {!!archive.times.length ? <label className="block text-xs">High-wind hour<select aria-label="Wind archive hour" className={field} value={time} onChange={event => setTime(event.target.value)}>{archive.times.map(value => <option key={value} value={value}>{new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} · {value.slice(11, 16)} UTC</option>)}</select></label> : <p className="text-xs">No saved hours meet this threshold on this date. Lower the threshold or choose another date. Missing data does not mean calm wind.</p>}
      {time && (active ? <><p className="text-xs">Tap a shaded wind area to select it for a campaign.</p><div aria-label="Wind gust legend" className="grid grid-cols-2 gap-1 text-[11px]">{[[40,'#22c55e', '40–60 km/h'], [60,'#facc15', '60–93 km/h'], [93.341952,'#f97316', '93–120 km/h'], [120,'#ef4444', '120–160 km/h'], [160,'#a855f7', '160+ km/h']].filter(([threshold])=>Number(threshold)>=Number(minimum)).map(([,color, label]) => <span key={label} className="flex items-center gap-1"><i aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: String(color) }} />{label}</span>)}</div></> : <button type="button" onClick={onView} className="min-h-11 w-full rounded-lg border border-border px-3 text-xs">Show selected wind map</button>)}
    </>}
    {time && active && windActions && <button type="button" onClick={windActions.inspect} className="min-h-11 w-full rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground">Select wind area on map</button>}
    {time && active && <WindZoneSelector key={`${workspaceId}:${country}:${time}:${minimum}`} map={map} workspaceId={workspaceId} country={country} time={time} minimumKPH={Number(minimum)} onSelected={windActions?.review} onSave={onSave} />}
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className="min-h-11 w-full rounded-lg border border-border px-3 text-xs disabled:opacity-40">Refresh saved hours</button>
    <p className="text-[11px] text-muted-foreground">Regional wind estimates from Xweather, saved permanently as new hours become available. Local gusts can differ. These maps do not confirm property damage.</p>
  </section>;
}
