'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { MapboxMapController } from '@xweather/mapsgl';
import '@xweather/mapsgl/dist/mapsgl.css';
import { CloudLightning, Play, Pause, X, Loader2, Settings2, Map as MapIcon, ChevronDown } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { StormMapsRasterControl } from './StormMapsRasterControl';
import { StormGLSettingsPanel } from './StormGLSettingsPanel';
import { useStormGLSettings } from './useStormGLSettings';
import { bindStormFeaturePopups, upsertStormFeatures, removeStormFeatures, ensureStormDrawCasing } from '@/lib/storm-maps/map-layers';
import { STORM_LAYER_GROUPS, WEATHER_SHADES, STRONGEST_STORM_SETTINGS, stormTimeRange } from '@/lib/storm-maps/gl-settings';
import { stormTerritoryImpact, type StormTerritories } from '@/lib/storm-maps/gl-impact';
import type { StormMapsManifest, StormFeatureProperties } from '@/lib/storm-maps/types';

type Props = { map: mapboxgl.Map | null; mapLoaded: boolean; workspaceId: string | null; territories?: StormTerritories };
const timeLabel = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const EMPTY_RISK: GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties> = { type: 'FeatureCollection', features: [] };

export function StormMapsControl(props: Props) {
  const { map, mapLoaded, workspaceId, territories } = props;
  const { settings, setSettings } = useStormGLSettings(workspaceId);
  const [entitled, setEntitled] = useState(false);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState<'overview' | 'settings'>('overview');
  const [manifest, setManifest] = useState<StormMapsManifest | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layerErrors, setLayerErrors] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(50);
  const [clock, setClock] = useState('Now');
  const [rangeLabels, setRangeLabels] = useState({ start: '−1 hour', end: '+1 hour' });
  const [risk, setRisk] = useState(EMPTY_RISK);
  const [riskLoaded, setRiskLoaded] = useState(false);
  const [riskError, setRiskError] = useState(false);
  const controllerRef = useRef<MapboxMapController | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const activeIds = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setEntitled(false); setManifest(null); setOpen(false);
    if (!workspaceId) return;
    const abort = new AbortController();
    fetch(`/api/storm-maps/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((d) => { if (!abort.signal.aborted) setEntitled(d?.addon?.isActive === true); }).catch(() => {});
    return () => abort.abort();
  }, [workspaceId]);

  const refresh = useCallback(async (signal: AbortSignal) => {
    if (!map || !workspaceId) return;
    const center = map.getCenter();
    const r = await fetch(`/api/storm-maps/manifest?workspaceId=${encodeURIComponent(workspaceId)}&lat=${center.lat}&lon=${center.lng}`, { signal, cache: 'no-store' });
    if (!r.ok) throw new Error('Could not start the weather session.');
    setManifest(await r.json());
  }, [map, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const load = () => { void refresh(abort.signal).catch((e) => { if (!abort.signal.aborted) setError(e.message); }); };
    load();
    const interval = window.setInterval(load, 10 * 60_000);
    return () => { abort.abort(); window.clearInterval(interval); };
  }, [open, refresh]);

  useEffect(() => {
    if (!map) return;
    const changed = () => setRevision((r) => r + 1);
    map.on('style.load', changed);
    return () => { map.off('style.load', changed); };
  }, [map]);

  const glEnabled = manifest?.providerHealth.xweather.available === true;
  useEffect(() => {
    if (!open || !map || !mapLoaded || !manifest || !glEnabled) return;
    let disposed = false;
    let controller: MapboxMapController | undefined;
    setReady(false); setLoading(true); setError(null); setLayerErrors([]); setPlaying(false);
    const sessionLayers = new Set<string>();
    activeIds.current = sessionLayers;
    const projection = map.getProjection();
    if (projection.name !== 'mercator') map.setProjection('mercator');
    void import('@xweather/mapsgl').then(async (sdk) => {
      // MapsGL waits for Mapbox's first load when its style is busy. That event
      // has already fired on this map, so wait for the current style ourselves.
      for (let attempt = 0; !disposed && !map.isStyleLoaded(); attempt += 1) {
        if (attempt >= 150) throw new Error('Map style did not become ready');
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      }
      if (disposed) return;
      const account = new sdk.Account('wolfgrid', 'session');
      const server = `${window.location.origin}/api/storm-maps/gl/${manifest.tileToken}`;
      account.servers.mapsgl = server;
      account.servers.maps = `${server}/maps`;
      const beforeId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
      controller = new sdk.MapboxMapController(map, {
        account, animation: { repeat: true, duration: 12, pauseWhileLoading: true },
        units: { temperature: 'C', speed: 'km/h', precipitation: 'mm' },
        slots: { slots: { underlay: { beforeId }, inlay: { beforeId } } },
      });
      controllerRef.current = controller;
      controller.on('load', () => {
        if (disposed || !controller) return;
        if (legendRef.current) {
          legendRef.current.replaceChildren();
          controller.addLegendControl(legendRef.current, { width: 274 });
        }
        setReady(true);
      });
      controller.on('load:start', () => { if (!disposed) setLoading(true); });
      controller.on('load:complete', () => { if (!disposed) setLoading(false); });
      controller.on('error', () => { if (!disposed) setError('Some weather data could not load. Reopen Storm to retry.'); });
    }).catch(() => { if (!disposed) { setError('The weather renderer could not start.'); setLoading(false); } });
    return () => {
      disposed = true; controllerRef.current = null; sessionLayers.clear();
      controller?.dispose();
      try { map.setProjection(projection); } catch { /* map already removed */ }
    };
  }, [open, map, mapLoaded, manifest, glEnabled, revision]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    const range = stormTimeRange(settings.mode, settings.historyHours);
    controller.timeline.pause(); setPlaying(false);
    controller.timeline.startDate = range.start;
    controller.timeline.endDate = range.end;
    controller.timeline.goToDate(settings.mode === 'history' ? controller.timeline.endDate : range.current);
    setRangeLabels({ start: settings.mode === 'forecast' ? 'Now' : `−${settings.mode === 'history' ? settings.historyHours : 1}h`, end: settings.mode === 'history' ? 'Now' : `+${settings.mode === 'forecast' ? 24 : 1}h` });
    setPosition(controller.timeline.position * 100); setClock(timeLabel(controller.timeline.currentDate));
  }, [ready, settings.mode, settings.historyHours]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    controller.timeline.duration = settings.speed;
    controller.setUnitsForSystem(settings.units);
  }, [ready, settings.speed, settings.units]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller || !map) return;
    const inspector = settings.inspector ? controller.addDataInspectorControl({ event: 'click', stream: true, showCoordinates: true }) : undefined;
    if (!settings.inspector) controller.removeDataInspectorControl();
    const modeChanged = (event: { mode?: string }) => { if (event.mode?.startsWith('draw_')) inspector?.disable(); else inspector?.enable(); };
    map.on('draw.modechange', modeChanged);
    return () => { map.off('draw.modechange', modeChanged); controller.removeDataInspectorControl(); };
  }, [ready, settings.inspector, map]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    const wanted = new Map<string, number>();
    if (settings.shade !== 'none') wanted.set(settings.shade, settings.opacity / 100);
    for (const group of STORM_LAYER_GROUPS) {
      if (!settings[group.key]) continue;
      for (const layer of group.ids) wanted.set(layer === 'radar' && settings.mode === 'forecast' ? 'gfs-radar' : layer, group.key === 'radar' ? settings.radarOpacity / 100 : group.key === 'wind' ? 0.35 : 1);
    }
    const errors: string[] = [];
    for (const id of activeIds.current) {
      if (!wanted.has(id)) { controller.removeWeatherLayer(id); activeIds.current.delete(id); }
    }
    for (const [id, opacity] of wanted) {
      try {
        if (!activeIds.current.has(id)) {
          if (!controller.weatherProvider.isWeatherLayer(id)) { errors.push(id); continue; }
          controller.addWeatherLayer(id, { paint: { opacity }, legend: id === 'wind-particles' || id.endsWith('-tracks') || id.endsWith('-points') || id === 'lightning-flash' ? false : undefined });
          activeIds.current.add(id);
        } else controller.setPaintProperty(id, 'opacity', opacity);
      } catch { errors.push(id); }
    }
    setLayerErrors(errors);
    if (map) ensureStormDrawCasing(map);
  }, [ready, settings, map]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      const timeline = controllerRef.current?.timeline;
      if (!timeline) return;
      setPosition(timeline.position * 100); setClock(timeLabel(timeline.currentDate));
    }, 400);
    return () => window.clearInterval(interval);
  }, [ready]);

  useEffect(() => {
    const enabled = settings.alerts || settings.outlook || settings.reports;
    if (!map || !mapLoaded || !open || !manifest || !glEnabled || !enabled) {
      if (map && mapLoaded) removeStormFeatures(map);
      setRisk(EMPTY_RISK); setRiskLoaded(false); return;
    }
    const abort = new AbortController();
    let cleanup: (() => void) | undefined;
    let timer: number | undefined;
    let sequence = 0;
    setRiskLoaded(false); setRiskError(false);
    const load = async () => {
      const request = ++sequence;
      const bounds = map.getBounds();
      if (!bounds) return;
      const bbox = [Math.max(-180, bounds.getWest()), Math.max(18, bounds.getSouth()), Math.min(-50, bounds.getEast()), Math.min(85, bounds.getNorth())];
      if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) { removeStormFeatures(map); setRisk(EMPTY_RISK); setRiskLoaded(true); return; }
      try {
        const r = await fetch(`${manifest.featureEndpoint}?bbox=${bbox.join(',')}&alerts=${settings.alerts}&outlook=${settings.outlook}&reports=${settings.reports}&token=${encodeURIComponent(manifest.tileToken)}`, { signal: abort.signal });
        if (!r.ok) throw new Error('Risk data unavailable');
        const data = await r.json() as typeof EMPTY_RISK;
        if (abort.signal.aborted || request !== sequence) return;
        cleanup?.(); upsertStormFeatures(map, data); cleanup = bindStormFeaturePopups(map);
        setRisk(data); setRiskLoaded(true); setRiskError(false);
      } catch { if (!abort.signal.aborted && request === sequence) setRiskError(true); }
    };
    const moved = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 400); };
    void load(); map.on('moveend', moved);
    const interval = window.setInterval(() => void load(), 5 * 60_000);
    return () => { abort.abort(); window.clearInterval(interval); window.clearTimeout(timer); map.off('moveend', moved); cleanup?.(); try { removeStormFeatures(map); } catch { /* map removed */ } };
  }, [map, mapLoaded, open, manifest, glEnabled, settings.alerts, settings.outlook, settings.reports, revision]);

  const togglePlayback = () => {
    const timeline = controllerRef.current?.timeline;
    if (!timeline) return;
    if (playing) timeline.pause();
    else {
      if (timeline.position >= 0.99) timeline.goToDate(timeline.startDate);
      if (timeline.isActive) timeline.resume(); else timeline.play();
    }
    setPlaying(!playing);
  };
  const scrub = (value: number) => {
    const timeline = controllerRef.current?.timeline;
    if (!timeline) return;
    timeline.pause(); setPlaying(false);
    timeline.goToDate(new Date(Math.min(timeline.endDate.getTime(), Math.max(timeline.startDate.getTime(), Math.floor((timeline.startDate.getTime() + value / 100 * timeline.deltaTime) / 1000) * 1000))));
    setPosition(value); setClock(timeLabel(timeline.currentDate));
  };
  const goNow = () => {
    const timeline = controllerRef.current?.timeline;
    if (!timeline) return;
    const value = (Date.now() - timeline.startDate.getTime()) / timeline.deltaTime * 100;
    scrub(Math.max(0, Math.min(100, value)));
  };
  const impacts = useMemo(() => stormTerritoryImpact(territories, risk), [territories, risk]);
  const toggled = STORM_LAYER_GROUPS.filter((group) => settings[group.key]);
  const enabledCount = toggled.length + [settings.alerts, settings.outlook, settings.reports].filter(Boolean).length;
  const rangeTitle = settings.mode === 'forecast' ? 'Forecast · next 24h' : settings.mode === 'history' ? `History · past ${settings.historyHours}h` : 'Live + 1h nowcast';

  if (!entitled || !mapLoaded || !map) return null;
  if (manifest && !glEnabled) return <StormMapsRasterControl {...props} />;
  return <>
    <div className="absolute left-[5.5rem] top-3 z-30 flex items-center gap-2">
      <button type="button" onClick={() => { if (!open) { setOpen(true); setPanel(true); } else setPanel(!panel); }} aria-expanded={open && panel} aria-controls="storm-maps-gl-panel" className="flex h-9 w-[4.08rem] items-center justify-center gap-1 rounded-full border border-cyan-200/60 bg-slate-950/90 px-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-xl"><CloudLightning className="h-3 w-3 shrink-0 text-cyan-300" />Storm</button>
      {open && <button type="button" aria-label="Turn off Storm" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/90 text-white"><X className="h-4 w-4" /></button>}
    </div>
    {open && <>
      <section id="storm-maps-gl-panel" aria-label="Storm command controls" style={{ display: panel ? undefined : 'none' }} className="dark absolute left-5 top-20 z-30 w-[min(20rem,calc(100%-2.5rem))] max-h-[calc(100%-12rem)] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Storm command</h2><p className="mt-1 text-[10px] text-slate-400">Storm priority · {enabledCount} overlays enabled</p></div><button aria-label="Hide Storm controls" onClick={() => setPanel(false)} className="rounded-lg p-2 hover:bg-white/10"><ChevronDown className="h-4 w-4" /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">{(['overview', 'settings'] as const).map((value) => <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={tab === value} className={`flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold capitalize ${tab === value ? 'bg-cyan-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>{value === 'settings' && <Settings2 className="h-3 w-3" />}{value}</button>)}</div>
        <div className="mt-4" hidden={tab !== 'settings'}><StormGLSettingsPanel settings={settings} onChange={setSettings} compact /></div>
        <div hidden={tab !== 'overview'} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setSettings({ ...STRONGEST_STORM_SETTINGS })} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 py-2 text-xs font-semibold text-cyan-200">Strongest preset</button><button type="button" onClick={() => setSettings({ ...settings, shade: 'none', mode: 'live', radar: true })} className="rounded-xl border border-white/15 py-2 text-xs hover:bg-white/10">Radar focus</button></div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">{(['live', 'history', 'forecast'] as const).map((mode) => <button key={mode} type="button" onClick={() => setSettings({ ...settings, mode })} aria-pressed={settings.mode === mode} className={`rounded-lg py-2 text-xs capitalize ${settings.mode === mode ? 'bg-white/15 font-semibold' : 'text-slate-400'}`}>{mode}</button>)}</div>
          <div><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Storm intelligence</p><div className="mt-2 flex flex-wrap gap-1.5">{toggled.map((group) => <span key={group.key} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{group.title}</span>)}{settings.alerts && <span className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">Official alerts</span>}{settings.outlook && <span className="rounded-md border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[10px] text-violet-200">Canadian outlook</span>}{settings.reports && <span className="rounded-md border border-white/10 px-2 py-1 text-[10px]">U.S. reports</span>}</div></div>
          {settings.impact && <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs font-semibold">Campaign risk in view</p>{!settings.alerts && !settings.outlook ? <p className="mt-2 text-[11px] text-slate-400">Enable warnings or outlooks to assess mapped territories.</p> : !riskLoaded ? <p className="mt-2 text-[11px] text-slate-400">{riskError ? 'Official risk data unavailable. Retry by reopening Storm.' : 'Checking official risk areas…'}</p> : <><p className={`mt-2 text-sm font-semibold ${impacts.length ? 'text-amber-200' : 'text-cyan-200'}`}>{impacts.length} / {territories?.features.length || 0} mapped territories overlap risk areas</p><p className="mt-1 text-[10px] text-slate-400">{risk.features.filter((feature) => feature.properties.kind === 'alert').length} alerts · {risk.features.filter((feature) => feature.properties.kind === 'outlook').length} outlooks · {risk.features.filter((feature) => feature.properties.kind === 'report').length} reports in view</p>{impacts.slice(0, 4).map((item) => <div key={item.id} className="mt-2 border-t border-white/10 pt-2"><p className="text-[11px] font-medium">{item.name}</p><p className="text-[10px] text-slate-400">{item.events.join(' · ')}</p></div>)}<p className="mt-2 text-[10px] leading-relaxed text-slate-500">Based on loaded official warnings and outlooks. This is not a damage assessment.{riskError ? ' Refresh failed; showing the last loaded data.' : ''}</p></>}</div>}
          <p className="text-[10px] leading-relaxed text-slate-400">{settings.shade === 'none' ? 'Storm focus' : WEATHER_SHADES.find((shade) => shade.id === settings.shade)?.label} · {rangeTitle}. {settings.inspector ? 'Click the map to inspect weather.' : ''} Storm-cell tracks cover the U.S.; hail threats include Canada.</p>
        </div>
        <button type="button" onClick={() => map.easeTo({ zoom: 6, pitch: 0, duration: 900 })} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2 text-xs hover:bg-white/10"><MapIcon className="h-3.5 w-3.5" />Regional view</button>
        <details className="mt-4" open><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-slate-400">Layer legends</summary><div ref={legendRef} className="mt-2 max-h-48 overflow-auto text-xs" /></details>
        {(loading || !ready) && !error && <p role="status" className="mt-3 flex items-center gap-2 text-[11px] text-cyan-200"><Loader2 className="h-3 w-3 animate-spin" />Loading weather data…</p>}
        {(error || layerErrors.length > 0) && <p role="alert" className="mt-3 text-xs text-amber-200">{error || `Unavailable in this renderer: ${layerErrors.join(', ')}. Other layers remain active.`}</p>}
        <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">Weather data © <a href="https://www.xweather.com" target="_blank" rel="noreferrer" className="underline">Vaisala Xweather</a> · NOAA/NWS · ECCC. Follow official authorities for safety decisions.</p>
      </section>
      <div className="absolute bottom-7 left-5 right-20 z-30 flex max-w-3xl items-center gap-4 rounded-2xl border border-white/15 bg-slate-950/95 px-4 py-3 text-white shadow-xl backdrop-blur-xl">
        <button type="button" onClick={togglePlayback} disabled={!ready} aria-label={playing ? 'Pause weather animation' : 'Play weather animation'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950 disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <div className="min-w-0 flex-1"><div className="mb-2 flex items-center justify-between text-[11px]"><span className="text-slate-400">{rangeTitle}</span><span className="font-semibold">{clock}</span><button type="button" onClick={goNow} className="text-cyan-200">Now</button></div><Slider min={0} max={100} step={1} value={[position]} onValueChange={(v) => scrub(v[0])} aria-label="Weather timeline" /><div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>{rangeLabels.start}</span><span>{rangeLabels.end}</span></div></div>
      </div>
    </>}
  </>;
}
