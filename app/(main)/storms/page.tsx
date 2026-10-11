'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { useWorkspace } from '@/lib/workspace-context';
import { StormDisplaySettingsPanel } from '@/components/storm-maps/StormDisplaySettings';
import { DEFAULT_STORM_DISPLAY, readStormDisplay, type StormDisplaySettings } from '@/lib/storm-maps/display-settings';
import { StormMapsControl } from '@/components/storm-maps/StormMapsControl';

export default function StormsPage() {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState('');
  const { currentWorkspaceId } = useWorkspace();
  const router = useRouter();
  const [preferences, setPreferences] = useState<{ workspace: string; value: StormDisplaySettings } | null>(null);
  const display = preferences?.workspace === currentWorkspaceId ? preferences.value : DEFAULT_STORM_DISPLAY;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedStyle = useRef('dark');
  useEffect(() => {
    if (!currentWorkspaceId) return;
    let value = DEFAULT_STORM_DISPLAY;
    try { value = readStormDisplay(JSON.parse(localStorage.getItem(`wolfgrid:storm-display:${currentWorkspaceId}`) || 'null')); } catch { /* optional storage */ }
    setPreferences({ workspace: currentWorkspaceId, value });
  }, [currentWorkspaceId]);
  const saveDisplay = (value: StormDisplaySettings) => {
    if (!currentWorkspaceId) return;
    setPreferences({ workspace: currentWorkspaceId, value });
    try { localStorage.setItem(`wolfgrid:storm-display:${currentWorkspaceId}`, JSON.stringify(value)); } catch { /* optional storage */ }
  };
  useEffect(() => {
    if (!map || !loaded) return;
    if (appliedStyle.current !== display.baseMap) {
      appliedStyle.current = display.baseMap;
      map.setStyle(`mapbox://styles/mapbox/${display.baseMap === 'streets' ? 'streets-v12' : `${display.baseMap}-v11`}`);
    }
    const apply = () => { map.setProjection(display.projection); if (display.projection === 'globe' && map.getZoom() > 3) map.easeTo({ zoom: 2.3, pitch: 0, bearing: 0 }); map.setFog(display.projection === 'globe' ? { color: '#9bb9df', 'high-color': '#244475', 'space-color': '#080a19', 'star-intensity': 0.7 } : null); };
    apply(); map.on('style.load', apply);
    return () => { map.off('style.load', apply); };
  }, [map, loaded, display.baseMap, display.projection]);
  useEffect(() => {
    const activity = () => {
      setControlsHidden(false);
      if (activityTimer.current) clearTimeout(activityTimer.current);
      if (display.autoHideControls && !settingsOpen) activityTimer.current = setTimeout(() => setControlsHidden(true), 15000);
    };
    const node = container.current?.parentElement;
    const events = ['pointermove','pointerdown','wheel','keydown','focusin'] as const;
    events.forEach(event => node?.addEventListener(event,activity)); activity();
    return () => { events.forEach(event => node?.removeEventListener(event,activity)); if (activityTimer.current) clearTimeout(activityTimer.current); };
  }, [display.autoHideControls, settingsOpen]);
  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = getMapboxToken();
    const instance = new mapboxgl.Map({ container: container.current, style: 'mapbox://styles/mapbox/dark-v11', center: [-85, 39], zoom: 4, projection: 'mercator' });
    instance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    instance.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
    setMap(instance);
    const resize = () => instance.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const frame = requestAnimationFrame(resize);
    const error = (event: mapboxgl.ErrorEvent) => { if (!instance.isStyleLoaded()) setMapError(event.error.message || 'Could not load the base map.'); };
    instance.on('error', error);
    const ready = () => { instance.resize(); setMapError(''); setLoaded(true); };
    instance.on('load', ready);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); instance.off('error', error); instance.off('load', ready); removeMapboxMapWhenSafe(instance); };
  }, []);
  return <div className="relative min-h-0 flex-1 overflow-hidden" aria-label="Storm Maps workspace">
    <div ref={container} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    <div className={controlsHidden || settingsOpen ? "pointer-events-none opacity-0" : "opacity-100"}><StormMapsControl displaySettings={display} onDisplaySettings={() => setSettingsOpen(true)} standalone map={map} mapLoaded={loaded} workspaceId={currentWorkspaceId} onStormCampaign={context => { if (context.territoryId) router.push(`/campaigns/create?stormTerritory=${encodeURIComponent(context.territoryId)}`); }} /></div>
    {settingsOpen && <section role="dialog" aria-label="Storm map settings" className="absolute left-5 top-5 z-40 max-h-[calc(100%-2.5rem)] w-[min(30rem,calc(100%-2.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-5 text-white shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Map settings</h2><button type="button" aria-label="Close map settings" onClick={() => setSettingsOpen(false)} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Close</button></div><StormDisplaySettingsPanel value={display} onChange={saveDisplay} /></section>}
    {mapError && <p role="alert" className="absolute bottom-5 left-5 z-40 max-w-md rounded-xl bg-red-950 p-4 text-white">{mapError}</p>}
    {!loaded && !mapError && <p role="status" className="absolute left-5 top-5 rounded-xl bg-slate-950 p-4 text-white">Loading storm map…</p>}
  </div>;
}
