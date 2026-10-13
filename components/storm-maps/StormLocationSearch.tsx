'use client';
import { useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { Search, Navigation, X } from 'lucide-react';
import { getMapboxToken } from '@/lib/mapbox';
type Place = { id: string; place_name: string; center: [number, number] };
export function StormLocationSearch({ map, inline = false }: { map: mapboxgl.Map; inline?: boolean }) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [query, setQuery] = useState(''), [results, setResults] = useState<Place[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    setResults([]); setError(''); setBusy(false);
    if (query.trim().length < 3) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const center = map.getCenter();
        const params = new URLSearchParams({ access_token: getMapboxToken(), limit: '5', proximity: `${center.lng},${center.lat}` });
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json?${params}`, { signal: abort.signal });
        if (!response.ok) throw new Error('Location search unavailable.');
        const data = await response.json();
        if (!abort.signal.aborted) setResults(data.features ?? []);
      } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Search unavailable.'); }
      finally { if (!abort.signal.aborted) setBusy(false); }
    }, 350);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [query, map]);
  const locate = () => {
    if (!navigator.geolocation) { setError('Location is unavailable in this browser.'); return; }
    navigator.geolocation.getCurrentPosition(position => { if (!mounted.current) return; setQuery(''); map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 9 }); }, () => { if (mounted.current) setError('Location permission unavailable. Search for a location instead.'); });
  };
  return <div className={inline ? "relative w-full" : "absolute right-24 top-4 z-30 w-[min(24rem,calc(100%-6.5rem))] max-lg:top-20"}>
    <div className="flex h-12 items-center gap-2 rounded-xl bg-white px-3 text-slate-700 shadow-lg"><Search className="h-5 w-5 shrink-0 text-slate-400" /><input aria-label="Search map locations" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); if (event.key === 'Enter' && results[0]) { map.flyTo({ center: results[0].center, zoom: 9 }); setQuery(''); } }} placeholder="Search locations" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />{query && <button aria-label="Clear location search" onClick={() => setQuery('')}><X className="h-4 w-4" /></button>}<button type="button" aria-label="Use my location" title="Use my location" onClick={locate} className="rounded-full bg-[#102530] p-2 text-white"><Navigation className="h-4 w-4" /></button></div>
    {(busy || error || results.length > 0) && <div className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-white p-2 text-slate-800 shadow-xl">{busy && <p role="status" className="p-2 text-xs">Searching…</p>}{error && <p role="alert" className="p-2 text-xs text-red-700">{error}</p>}{results.map(place => <button type="button" key={place.id} onClick={() => { map.flyTo({ center: place.center, zoom: 9 }); setQuery(''); }} className="block w-full rounded-lg p-3 text-left text-sm hover:bg-slate-100">{place.place_name}</button>)}</div>}
  </div>;
}
