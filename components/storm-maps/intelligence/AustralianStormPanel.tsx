'use client';
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { AUSTRALIAN_STORM_LOCATIONS, australianHailDay, type AustralianWeatherView } from '@/lib/storm-maps/australia';
import { StormLocationSearch } from '../StormLocationSearch';
import { AustralianStormArchive } from './AustralianStormArchive';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';

type Period = { dateTimeISO: string; maxSizeMM: number | null };
const field = 'w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground';
const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40';

export function AustralianStormPanel({ map, workspaceId, onView, onEvent, simple=false }: {
  map: mapboxgl.Map; workspaceId: string; onView: (value: AustralianWeatherView) => void; onEvent: (event: StormEvent | null) => void; simple?: boolean;
}) {
  const [selected, setSelected] = useState<StormEvent | null>(null);
  const showView = (value: AustralianWeatherView) => { setSelected(null); onView(value); };
  const [location, setLocation] = useState(AUSTRALIAN_STORM_LOCATIONS[0].id);
  const [point, setPoint] = useState({ lon: 153.0251, lat: -27.4698 });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const day = australianHailDay(date);

  useEffect(() => {
    map.setProjection('mercator');
    map.flyTo({ center: AUSTRALIAN_STORM_LOCATIONS[0].center, zoom: 7 });
    onView({ view: 'history' });
  }, [map, onView, workspaceId]);
  useEffect(() => {
    const choose = (event: mapboxgl.MapMouseEvent) => {
      const { lng: lon, lat } = event.lngLat;
      if (lon < 112 || lon > 155 || lat < -44 || lat > -10) return;
      setPoint({ lon, lat });
    };
    map.on('click', choose);
    return () => { map.off('click', choose); };
  }, [map]);
  useEffect(() => {
    request.current?.abort(); setBusy(false); setPeriods(null); setMessage('');
    return () => request.current?.abort();
  }, [point, date, workspaceId]);

  async function lookup() {
    if (!day) return;
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    setBusy(true); setPeriods(null); setMessage('');
    try {
      const query = new URLSearchParams({ workspaceId, lat: String(point.lat), lon: String(point.lon), date });
      const response = await fetch(`/api/storm-maps/intelligence/hail?${query}`, { signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Australian hail history is unavailable.');
      if (abort.signal.aborted) return;
      setPeriods(data.periods);
      setMessage(data.coverage === 'unavailable' ? 'No archive data returned for this point and date. This does not establish no hail.' : data.message);
    } catch (error) {
      if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Hail lookup unavailable.');
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }

  const sizes = periods?.flatMap(period => typeof period.maxSizeMM === 'number' && Number.isFinite(period.maxSizeMM) ? [period.maxSizeMM] : []) ?? [];
  if(simple)return <AustralianStormArchive simple map={map} workspaceId={workspaceId} selected={selected} onSelect={event=>{setSelected(event);onEvent(event);}}/>;
  return <section aria-label="Australian storm maps" className="space-y-3">
    <p className="text-sm font-semibold">Australia · Xweather</p>
    <label className="block text-xs">Region<select aria-label="Australian storm region" className={field} value={location} onChange={event => {
      const next = AUSTRALIAN_STORM_LOCATIONS.find(item => item.id === event.target.value);
      if (!next) return;
      setLocation(next.id); setPoint({ lon: next.center[0], lat: next.center[1] }); setSelected(null); onEvent(null);
      map.setProjection('mercator'); map.flyTo({ center: next.center, zoom: next.zoom });
    }}>{AUSTRALIAN_STORM_LOCATIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <StormLocationSearch map={map} inline />
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className={button} onClick={() => showView({ view: 'live' })}>Live hail tracks</button>
      <button type="button" className={button} onClick={() => showView({ view: 'history' })}>Past 24h hail size</button>
    </div>
    <p className="text-xs text-muted-foreground">Live hail threats extend up to 60 minutes. Hail-size maps cover the past seven days. Lightning and radar use the same Xweather connection.</p>
    <label className="block text-xs">Hail date (UTC)<input aria-label="Australian hail date" className={field} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={event => setDate(event.target.value)} /></label>
    <button type="button" className={`${button} w-full`} disabled={!day?.mapAvailable} onClick={() => { if (day?.mapAvailable) showView({ view: 'history', range: { start: day.start, end: day.end } }); }}>Show this day’s hail map</button>
    {day && !day.mapAvailable && <p className="text-xs text-muted-foreground">This day is outside the seven-day map archive. You can still request point history below, where available.</p>}
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold">Location hail history</p>
      <p className="text-xs text-muted-foreground">Uses the selected city centre. Tap the map to choose another point.</p>
      <p className="text-xs">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</p>
      <button type="button" className={`${button} w-full`} disabled={busy || !day} onClick={() => void lookup()}>{busy ? 'Looking up hail…' : 'Look up hail at this point'}</button>
      {periods && periods.length > 0 && <p className="text-xs">{sizes.length ? `Maximum estimated hail: ${Math.max(...sizes).toFixed(1)} mm` : 'Hail size unavailable'} · {periods.length} hourly records</p>}
      {message && <p role="status" className="text-xs">{message}</p>}
    </div>
    <AustralianStormArchive map={map} workspaceId={workspaceId} selected={selected} onSelect={event => { setSelected(event); onEvent(event); }} />
    <p className="text-[11px] text-muted-foreground">Weather estimates do not confirm roof damage. U.S. storm reports and North American warning overlays are excluded from this view.</p>
  </section>;
}
