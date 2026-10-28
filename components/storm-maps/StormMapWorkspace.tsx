'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { useTheme } from '@/lib/theme-provider';
import { StormDisplaySettingsPanel } from '@/components/storm-maps/StormDisplaySettings';
import { DEFAULT_STORM_DISPLAY, readStormDisplay, migrateStormDisplay, resolveStormBaseMap, type StormDisplaySettings } from '@/lib/storm-maps/display-settings';
import { StormMapsControl } from '@/components/storm-maps/StormMapsControl';
import { StormCountryContext } from '@/lib/storm-maps/storm-country-context';
import { stormBrowserDefaults } from '@/lib/storm-maps/intelligence/storm-browser';
import { WIND_COUNTRIES, type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { StormMobileMapContext } from '@/lib/storm-maps/mobile-session';

export function StormMapWorkspace({ workspaceId: currentWorkspaceId, initialCenter, mobile = false, initiallyOpenDiscovery = false, onStormCampaign, drawingRequest = 0 }: {
  workspaceId: string | null;
  initialCenter?: [number, number];
  mobile?: boolean;
  initiallyOpenDiscovery?: boolean;
  onStormCampaign?: (context: StormCampaignContext) => void;
  drawingRequest?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mobileMapSession = useContext(StormMobileMapContext);
  const mobileMapSessionRef = useRef(mobileMapSession);
  mobileMapSessionRef.current = mobileMapSession;
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState('');
  const { theme } = useTheme();
  const router = useRouter();
  const [preferences, setPreferences] = useState<{ workspace: string; value: StormDisplaySettings } | null>(null);
  const display = preferences?.workspace === currentWorkspaceId ? preferences.value : DEFAULT_STORM_DISPLAY;
  const [country,setCountry]=useState<WindCountry>('CA');
  const [countryReady,setCountryReady]=useState(false);
  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    try {if(!query.has('country')&&query.get('region')!=='au'){const saved=localStorage.getItem(`wolfgrid:storm-country:${currentWorkspaceId}`);if(saved)query.set('country',saved);}} catch { /* optional storage */ }
    setCountry(stormBrowserDefaults(query).country);setCountryReady(true);
  },[currentWorkspaceId]);
  const changeCountry=(value:WindCountry)=>{setCountry(value);if(map&&loaded){const bounds=WIND_COUNTRIES[value].bounds[0];map.setProjection('mercator');map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:35,duration:500});}try{localStorage.setItem(`wolfgrid:storm-country:${currentWorkspaceId}`,value);}catch{/* optional storage */}};
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialCameraCenter = useRef(initialCenter);
  const initialStyle = useRef(resolveStormBaseMap(display.baseMap, theme));
  const appliedStyle = useRef(initialStyle.current);
  useEffect(() => {
    if (!currentWorkspaceId) return;
    let value = DEFAULT_STORM_DISPLAY;
    try {
      const saved = localStorage.getItem(`wolfgrid:storm-display:v3:${currentWorkspaceId}`);
      const v2 = localStorage.getItem(`wolfgrid:storm-display:v2:${currentWorkspaceId}`);
      const previous = localStorage.getItem(`wolfgrid:storm-display:${currentWorkspaceId}`);
      value = saved ? readStormDisplay(JSON.parse(saved)) : v2 ? migrateStormDisplay(JSON.parse(v2)) : { ...migrateStormDisplay(previous ? JSON.parse(previous) : null), projection: mobile ? 'mercator' : 'globe' };
    } catch { /* optional storage */ }
    setPreferences({ workspace: currentWorkspaceId, value });
  }, [currentWorkspaceId, mobile]);
  const saveDisplay = (value: StormDisplaySettings) => {
    if (!currentWorkspaceId) return;
    setPreferences({ workspace: currentWorkspaceId, value });
    try { localStorage.setItem(`wolfgrid:storm-display:v3:${currentWorkspaceId}`, JSON.stringify(value)); } catch { /* optional storage */ }
  };
  useEffect(() => {
    if (!map || !loaded) return;
    const style = resolveStormBaseMap(display.baseMap, theme);
    if (appliedStyle.current === style) return;
    appliedStyle.current = style;
    // A palette change must keep the projection chosen by a storm/territory.
    const projection = map.getProjection();
    const restoreProjection = () => map.setProjection(projection);
    map.once('style.load', restoreProjection);
    map.setStyle(style);
    return () => { map.off('style.load', restoreProjection); };
  }, [map, loaded, display.baseMap, theme]);
  useEffect(() => {
    if (!map || !loaded) return;
    map.setProjection(display.projection);
    if (display.projection === 'globe' && map.getZoom() > 3) map.easeTo({ zoom: 2.3, pitch: 0, bearing: 0 });
  }, [map, loaded, display.projection]);
  useEffect(() => {
    if (!map || !loaded) return;
    const light = display.baseMap === 'light' || display.baseMap === 'streets' || (display.baseMap === 'auto' && theme === 'light');
    const apply = () => map.setFog(map.getProjection().name === 'globe' ? light
      ? { color: '#e7eff7', 'high-color': '#b9d5ec', 'space-color': '#eef4fa', 'star-intensity': 0 }
      : { color: '#9bb9df', 'high-color': '#244475', 'space-color': '#080a19', 'star-intensity': 0.7 } : null);
    if (map.isStyleLoaded()) apply();
    map.on('style.load', apply);
    return () => { map.off('style.load', apply); };
  }, [map, loaded, display.baseMap, display.projection, theme]);
  useEffect(() => {
    const activity = () => {
      setControlsHidden(false);
      if (activityTimer.current) clearTimeout(activityTimer.current);
      if (!mobile && display.autoHideControls && !settingsOpen) activityTimer.current = setTimeout(() => setControlsHidden(true), 15000);
    };
    const node = container.current?.parentElement;
    const events = ['pointermove','pointerdown','wheel','keydown','focusin'] as const;
    events.forEach(event => node?.addEventListener(event,activity));
    document.addEventListener('fullscreenchange', activity);
    document.addEventListener('webkitfullscreenchange', activity);
    activity();
    return () => {
      events.forEach(event => node?.removeEventListener(event,activity));
      document.removeEventListener('fullscreenchange', activity);
      document.removeEventListener('webkitfullscreenchange', activity);
      if (activityTimer.current) clearTimeout(activityTimer.current);
    };
  }, [display.autoHideControls, settingsOpen, mobile]);
  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = getMapboxToken();
    const instance = new mapboxgl.Map({ container: container.current, style: initialStyle.current, center: initialCameraCenter.current ?? [-85, 39], zoom: mobile ? 3 : initialCameraCenter.current ? 5 : 2.3, projection: mobile ? 'mercator' : 'globe', attributionControl: !mobile,
      transformRequest: url => mobileMapSessionRef.current?.transformRequest(url) ?? { url },
    });
    if (mobile) instance.addControl(new mapboxgl.AttributionControl({ compact: false }), 'bottom-left');
    else {
      instance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      instance.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
    }
    setMap(instance);
    const resize = () => instance.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const frame = requestAnimationFrame(resize);
    const error = (event: mapboxgl.ErrorEvent) => {
      const failure = event.error as Error & { status?: number; url?: string };
      if (failure.status === 401 && failure.url && new URL(failure.url, window.location.origin).origin === window.location.origin && new URL(failure.url, window.location.origin).pathname === '/api/storm-maps/intelligence/wind/map') mobileMapSessionRef.current?.onUnauthorized();
      if (!instance.isStyleLoaded()) setMapError(event.error.message || 'Could not load the base map.');
    };
    instance.on('error', error);
    const ready = () => { instance.resize(); setMapError(''); setLoaded(true); };
    instance.on('load', ready);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); instance.off('error', error); instance.off('load', ready); queueMicrotask(() => removeMapboxMapWhenSafe(instance)); };
  }, [mobile]);
  return <div data-mobile-campaign={mobile || undefined} className="storm-workspace relative min-h-0 flex-1 overflow-hidden" aria-label="Storm Maps workspace">
    <div ref={container} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: controlsHidden || settingsOpen ? 0 : sidebarWidth, height: '100%' }} />
    {/* Empty overlay space must pass wheel and drag gestures to the map canvas. */}
    <div inert={controlsHidden || settingsOpen} className={"pointer-events-none absolute inset-0 " + (controlsHidden || settingsOpen ? "opacity-0" : "opacity-100 [&>*]:pointer-events-auto")}>{countryReady&&<StormCountryContext.Provider value={{country,setCountry:changeCountry}}><StormMapsControl mobileCampaign={mobile} initiallyOpenDiscovery={mobile || initiallyOpenDiscovery} drawingRequest={drawingRequest} onSidebarWidth={setSidebarWidth} displaySettings={display} onDisplaySettings={() => setSettingsOpen(true)} standalone map={map} mapLoaded={loaded} workspaceId={currentWorkspaceId} onStormCampaign={context => { if (onStormCampaign) { onStormCampaign(context); return; } if (context.territoryId) router.push(`/campaigns/create?stormTerritory=${encodeURIComponent(context.territoryId)}`); }} /></StormCountryContext.Provider>}</div>
    {settingsOpen && <section role="dialog" aria-label="Storm map settings" className="absolute left-5 top-5 z-40 max-h-[calc(100%-2.5rem)] w-[min(30rem,calc(100%-2.5rem))] overflow-y-auto rounded-2xl border border-border bg-white/95 p-5 text-slate-900 shadow-2xl dark:border-white/15 dark:bg-slate-950/95 dark:text-white"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Map settings</h2><button type="button" aria-label="Close map settings" onClick={() => setSettingsOpen(false)} className="rounded-lg border border-border px-3 py-2 text-sm dark:border-white/15">Close</button></div><label className="mb-5 block text-sm font-medium">Country<select aria-label="Storm country" className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background p-2 text-base text-foreground" value={country} onChange={event=>changeCountry(event.target.value as WindCountry)}>{Object.entries(WIND_COUNTRIES).filter(([code])=>code!=='NZ').map(([code,value])=><option key={code} value={code}>{value.name}</option>)}</select></label><StormDisplaySettingsPanel campaignOnly={mobile} value={display} onChange={saveDisplay} /></section>}
    {mapError && <p role="alert" className="absolute bottom-5 left-5 z-40 max-w-md rounded-xl bg-red-950 p-4 text-white">{mapError}</p>}
    {!loaded && !mapError && <p role="status" className="absolute left-5 top-5 rounded-xl bg-white p-4 text-slate-900 dark:bg-slate-950 dark:text-white">Loading storm map…</p>}
  </div>;
}
