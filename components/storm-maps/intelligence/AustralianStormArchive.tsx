'use client';
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { eventBounds, type StormEvent } from '@/lib/storm-maps/intelligence/model';
import { StormEventMap } from './StormEventMap';
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const field = 'w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground';
export function AustralianStormArchive({ map, workspaceId, selected, onSelect, simple=false }: {
  map: mapboxgl.Map; workspaceId: string; selected: StormEvent | null; onSelect: (event: StormEvent | null) => void; simple?: boolean;
}) {
  const [from, setFrom] = useState(() => daysAgo(7)), [to, setTo] = useState(() => daysAgo(0));
  const [events, setEvents] = useState<StormEvent[]>([]), [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [health, setHealth] = useState(''), [starts, setStarts] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [minimumMM, setMinimumMM] = useState(20), [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setError('');
    if (!offset) { setEvents([]); setNext(null); }
    const query = new URLSearchParams({ workspaceId, from, to, offset: String(offset), minimumMM: String(minimumMM) });
    void fetch(`/api/storm-maps/intelligence/australia?${query}`, { signal: abort.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Australian storm list unavailable.');
      if (abort.signal.aborted) return;
      setEvents(previous => offset ? [...new Map([...previous, ...data.events].map((event: StormEvent) => [event.key, event])).values()] : data.events);
      setNext(data.nextOffset); setHealth(data.health?.message ?? ''); setStarts(data.archiveStartsAt); setTotal(data.total);
    }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Australian archive unavailable.'); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [workspaceId, from, to, offset, refresh, minimumMM]);
  function select(event: StormEvent) {
    onSelect(event);
    const bounds = eventBounds(event);
    if (bounds) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 80, maxZoom: 7, retainPadding: false });
  }
  return <section aria-label="Australian saved storm list" className="space-y-2 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold">{simple?'Recent hail detections':'Nationwide saved hail threats'}</h3>
    <p className="text-xs text-muted-foreground">Australian detections are saved automatically every five minutes, including available frames between checks. These are modeled threats, not ground reports.</p>
    {!simple&&<div className="space-y-3"><label className="block text-xs">From (UTC)<input aria-label="Australian archive start" className={field} type="date" value={from} max={to} onChange={event => { setOffset(0); setFrom(event.target.value); }} /></label>
    <label className="block text-xs">To (UTC)<input aria-label="Australian archive end" className={field} type="date" value={to} max={daysAgo(0)} onChange={event => { setOffset(0); setTo(event.target.value); }} /></label>
    <label className="block text-xs">Estimated hail size<select aria-label="Australian archive hail size" className={field} value={minimumMM} onChange={event => { setOffset(0); setMinimumMM(Number(event.target.value)); }}><option value={0}>All sizes</option><option value={20}>20 mm+</option><option value={25.4}>25.4 mm+ / 1 inch+</option><option value={40}>40 mm+</option><option value={50.8}>50.8 mm+ / 2 inches+</option></select></label>
    </div>}
    <button type="button" disabled={busy} className="min-h-11 w-full rounded-lg border border-border px-3 text-xs" onClick={() => { setOffset(0); setRefresh(value => value + 1); }}>Refresh saved storms</button>
    {starts && <p className="text-xs text-muted-foreground">Saved detections begin {starts.slice(0, 10)} UTC. Older nationwide history is not connected.</p>}
    {health && <p className="text-xs text-muted-foreground">{health}</p>}
    {total != null && <p className="text-xs">{total.toLocaleString()} matching saved detections</p>}
    {selected && <p className="text-xs font-semibold">Selected: {selected.title} · estimated {selected.maxHailMM?.toFixed(1) ?? 'unknown'} mm</p>}
    {error && <p role="alert" className="text-xs">{error}</p>}
    {events.map(event => <button type="button" key={event.key} aria-pressed={selected?.key === event.key} onClick={() => select(event)} className="block min-h-11 w-full rounded-lg border border-border px-2 py-3 text-left text-xs aria-pressed:bg-muted">{event.title}<span className="mt-1 block">Estimated hail: {event.maxHailMM?.toFixed(1) ?? 'unknown'} mm</span>{event.features[0]?.geometry.type === 'Point' && <span className="mt-1 block text-muted-foreground">Approx. {event.features[0].geometry.coordinates[1].toFixed(1)}, {event.features[0].geometry.coordinates[0].toFixed(1)}</span>}</button>)}
    {busy && <p role="status" className="text-xs">Loading saved Australian storms…</p>}
    {!busy && !error && !events.length && <p className="text-xs">No saved detections returned for this interval. This does not establish no storms.</p>}
    {next != null && <button type="button" disabled={busy} className="min-h-11 w-full rounded-lg border border-border text-xs" onClick={() => setOffset(next)}>Load older saved storms</button>}
    <StormEventMap map={map} event={selected} minimumHailMM={0} onLocation={() => {}} />
  </section>;
}
