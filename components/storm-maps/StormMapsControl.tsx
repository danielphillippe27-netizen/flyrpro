'use client';

import { StormWorkbenchView } from './StormWorkbenchView';
import { StormTerritoryOverlay } from './StormTerritoryOverlay';
import type { StormDisplaySettings } from '@/lib/storm-maps/display-settings';
import Link from 'next/link';
import { StormOverlayPicker } from './StormOverlayPicker';
import { StormWeatherRail } from './StormWeatherRail';
import { StormTimelineRange } from './StormTimelineRange';
import { SavedStormTerritories } from './SavedStormTerritories';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
import { StormTerritorySketch } from './StormTerritorySketch';
import { HailZoneSelector } from './HailZoneSelector';
import { useStormPanelScroll } from './useStormPanelScroll';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { MapboxMapController } from '@xweather/mapsgl';
import '@xweather/mapsgl/dist/mapsgl.css';
import { CloudLightning, Play, Pause, X, Loader2, Settings, Map as MapIcon, ChevronDown } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { StormIntelligencePanel } from './intelligence/StormIntelligencePanel';
import type { StormEvent, StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { StormMapsRasterControl } from './StormMapsRasterControl';
import { StormGLSettingsPanel } from './StormGLSettingsPanel';
import { useStormGLSettings } from './useStormGLSettings';
import { bindStormFeaturePopups, upsertStormFeatures, removeStormFeatures, ensureStormDrawCasing } from '@/lib/storm-maps/map-layers';
import { STORM_LAYER_GROUPS, WEATHER_SHADES, STRONGEST_STORM_SETTINGS, stormTimeRange, hurricaneViewSettings, stormLayerForMode, hailViewSettings, isHistoricalHailShade } from '@/lib/storm-maps/gl-settings';
import { resetStormTimeline } from '@/lib/storm-maps/gl-timeline';
import { stormTerritoryImpact, type StormTerritories } from '@/lib/storm-maps/gl-impact';
import type { StormMapsManifest, StormFeatureProperties } from '@/lib/storm-maps/types';

type Props = { displaySettings?: StormDisplaySettings; onDisplaySettings?: () => void; standalone?: boolean; map: mapboxgl.Map | null; mapLoaded: boolean; workspaceId: string | null; territories?: StormTerritories; territoryDrawing?: boolean; onStormModeChange?: (active: boolean) => void; onStormCampaign?: (context: StormCampaignContext, boundary?: GeoJSON.Feature<GeoJSON.Polygon>) => void };
const timeLabel = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const EMPTY_RISK: GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties> = { type: 'FeatureCollection', features: [] };

export function StormMapsControl(props: Props) {
  return props.standalone ? <StormWorkbench {...props} /> : <StormOverlayPicker {...props} />;
}

function StormWorkbench(props: Props) {
  const panelScrollRef = useStormPanelScroll();
  const { map, mapLoaded, workspaceId, territories, territoryDrawing = false, standalone, onStormModeChange } = props;
  const territoryDrawingRef = useRef(territoryDrawing);
  territoryDrawingRef.current = territoryDrawing;
  const { settings, setSettings } = useStormGLSettings(workspaceId);
  const [entitled, setEntitled] = useState(false);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(true);
  const [selectingTerritory, setSelectingTerritory] = useState(false);
  const [territoryWindowEnd, setTerritoryWindowEnd] = useState(() => new Date());
  useEffect(() => { if (open) setTerritoryWindowEnd(new Date()); }, [open, settings.mode, settings.historyHours, settings.shade]);
  useEffect(() => { onStormModeChange?.(open); }, [open, onStormModeChange]);
  const [tab, setTab] = useState<'overview' | 'intelligence' | 'historic'>('overview' );
  const [exposureHours, setExposureHours] = useState<12 | 24 | null>(null);
  const [exposureEnd, setExposureEnd] = useState<Date>(() => new Date());
  const [savedTerritory, setSavedTerritory] = useState<SavedStormTerritory | null>(null);
  const [territoryRevision, setTerritoryRevision] = useState(0);
  useEffect(() => { setSavedTerritory(null); }, [workspaceId]);
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const archiveView = tab !== 'overview';
  const selectArchiveEvent = useCallback((event: StormEvent | null) => { setSelectedEvent(event); setExposureHours(null); }, []);
  const recentHailEvent = archiveView && selectedEvent?.hazard === 'hail' && Date.parse(selectedEvent.start) >= Date.now() - 7 * 86400000;
  const hailSelectionEvent = recentHailEvent && selectedEvent ? {
    key: selectedEvent.key, title: selectedEvent.title, hazard: selectedEvent.hazard, source: selectedEvent.source,
    sourceId: selectedEvent.sourceId, start: selectedEvent.start, end: selectedEvent.end,
  } : tab === 'overview' && settings.mode === 'history' && settings.shade === 'hail-size-max' ? {
    key: `hail-territory:${settings.historyHours}:${territoryWindowEnd.toISOString()}`,
    title: `Hail exposure · ${settings.historyHours} hours`, hazard: 'hail' as const, source: 'xweather' as const,
    sourceId: 'hail-size-max', start: new Date(territoryWindowEnd.getTime() - settings.historyHours * 3600_000).toISOString(), end: territoryWindowEnd.toISOString(),
  } : null;
  const saveTerritory = async (name: string, boundary: GeoJSON.Polygon, context: StormCampaignContext) => {
    const response = await fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId ?? '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, boundary, context }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    setSavedTerritory(data.territory); setTerritoryRevision(value => value + 1);
  };
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
  const [zoom, setZoom] = useState(map?.getZoom() ?? 6);

  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(map.getZoom());
    update();
    map.on('zoomend', update);
    return () => { map.off('zoomend', update); };
  }, [map]);

  useEffect(() => {
    setEntitled(false); setManifest(null); setOpen(false); setSavedTerritory(null); setSettingsOpen(false); setExposureHours(null); setSelectedEvent(null);
    if (!workspaceId) return;
    const abort = new AbortController();
    fetch(`/api/storm-maps/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null).then((d) => { if (!abort.signal.aborted) { setEntitled(d?.addon?.isActive === true); if (standalone && d?.addon?.isActive === true) { setSettings(previous => ({ ...STRONGEST_STORM_SETTINGS, units: previous.units, opacity: 100, radarOpacity: 100 })); setOpen(true); } } }).catch(() => {});
    return () => abort.abort();
  }, [workspaceId, standalone, setSettings]);

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
    const minutes = props.displaySettings?.autoUpdateMinutes ?? 10;
    const interval = minutes ? window.setInterval(() => { load(); setRevision(value => value + 1); setTerritoryWindowEnd(new Date()); }, minutes * 60_000) : undefined;
    return () => { abort.abort(); window.clearInterval(interval); };
  }, [open, refresh, props.displaySettings?.autoUpdateMinutes]);

  useEffect(() => {
    if (!map) return;
    const changed = () => setRevision((r) => r + 1);
    map.on('style.load', changed);
    return () => { map.off('style.load', changed); };
  }, [map]);

  const glEnabled = manifest?.providerHealth.xweather.available === true;
  useEffect(() => {
    if (!open || !map || !mapLoaded || !glEnabled || !workspaceId) return;
    let disposed = false;
    let controller: MapboxMapController | undefined;
    setReady(false); setLoading(true); setError(null); setLayerErrors([]); setPlaying(false);
    const sessionLayers = new Set<string>();
    activeIds.current = sessionLayers;
    const projection = map.getProjection();
    if (!props.standalone && projection.name !== 'mercator') map.setProjection('mercator');
    void import('@xweather/mapsgl').then(async (sdk) => {
      // MapsGL waits for Mapbox's first load when its style is busy. That event
      // has already fired on this map, so wait for the current style ourselves.
      for (let attempt = 0; !disposed && !map.isStyleLoaded(); attempt += 1) {
        if (attempt >= 150) throw new Error('Map style did not become ready');
        await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      }
      if (disposed) return;
      const account = new sdk.Account('wolfgrid', 'session');
      const server = `${window.location.origin}/api/storm-maps/gl/session-${workspaceId}`;
      account.servers.mapsgl = server;
      account.servers.api = `${server}/api`;
      account.servers.maps = `${server}/maps`;
      const beforeId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
      controller = new sdk.MapboxMapController(map, {
        account, animation: { repeat: true, duration: 12, pauseWhileLoading: true, preloadData: false },
        units: { temperature: 'C', speed: 'km/h', precipitation: 'mm' },
        slots: { slots: { underlay: { beforeId }, inlay: { beforeId } } },
      });
      controllerRef.current = controller;
      controller.on('load', () => {
        if (disposed || !controller) return;
        if (legendRef.current) {
          legendRef.current.replaceChildren();
          controller.addLegendControl(legendRef.current, { width: 240 });
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
      try { if (!props.standalone) map.setProjection(projection); } catch { /* map already removed */ }
    };
  }, [open, map, mapLoaded, workspaceId, glEnabled, revision, props.standalone]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    const range = archiveView && exposureHours ? stormTimeRange('history', exposureHours, exposureEnd.getTime()) : recentHailEvent && selectedEvent ? { start: new Date(selectedEvent.start), end: new Date(selectedEvent.end), current: new Date(selectedEvent.end) } : stormTimeRange(settings.mode, settings.historyHours);
    resetStormTimeline(controller, activeIds.current, range, settings.mode === 'history' ? range.end : range.current);
    setPlaying(false);
    setRangeLabels({ start: settings.mode === 'forecast' ? 'Now' : `−${settings.mode === 'history' ? settings.historyHours : 1}h`, end: settings.mode === 'history' ? 'Now' : `+${settings.mode === 'forecast' ? 24 : 1}h` });
    setPosition(controller.timeline.position * 100); setClock(timeLabel(controller.timeline.currentDate));
  }, [ready, settings.mode, settings.historyHours, recentHailEvent, selectedEvent, archiveView, exposureHours, exposureEnd]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    controller.timeline.duration = settings.speed;
    if (props.displaySettings) controller.setUnits(props.displaySettings.customUnits);
    else controller.setUnitsForSystem(settings.units);
  }, [ready, settings.speed, settings.units, props.displaySettings]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller || !map) return;
    const inspector = settings.inspector && !archiveView && !selectingTerritory ? controller.addDataInspectorControl({ event: props.standalone ? 'move' : 'click', stream: true, showCoordinates: true }) : undefined;
    if (!settings.inspector || archiveView || selectingTerritory) controller.removeDataInspectorControl();
    if (territoryDrawing) inspector?.disable();
    const modeChanged = (event: { mode?: string }) => { if (event.mode?.startsWith('draw_')) inspector?.disable(); else inspector?.enable(); };
    map.on('draw.modechange', modeChanged);
    return () => { map.off('draw.modechange', modeChanged); controller.removeDataInspectorControl(); };
  }, [ready, settings.inspector, map, archiveView, selectingTerritory, territoryDrawing, props.standalone]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!ready || !controller) return;
    const wanted = new Map<string, number>();
    if (settings.shade !== 'none' && (settings.shade !== 'satellite-infrared-color' || settings.mode !== 'forecast') && (!isHistoricalHailShade(settings.shade) || settings.mode === 'history')) wanted.set(settings.shade, settings.opacity / 100);
    for (const group of STORM_LAYER_GROUPS) {
      if (!settings[group.key]) continue;
      for (const layer of group.ids) wanted.set(stormLayerForMode(layer, settings.mode), group.key === 'radar' ? settings.radarOpacity / 100 : group.key === 'wind' ? 0.35 : layer.endsWith('-polygons') ? 0.4 : layer.endsWith('-tracks') ? 0.65 : 1);
    }
    if (settings.cells && settings.stormCones) wanted.set('stormcells-cones', 0.12);
    if (archiveView) { wanted.clear(); if (recentHailEvent || exposureHours) wanted.set('hail-size-max', 0.65); }
    const errors: string[] = [];
    for (const id of activeIds.current) {
      if (!wanted.has(id)) controller.setWeatherLayerVisibility(id, false);
    }
    for (const [id, opacity] of wanted) {
      // Keep broad risk areas at every zoom; individual strikes and tracks need a regional view.
      const detail = id === 'lightning-flash' || id === 'lightning-strikes' || id.startsWith('stormcells-') || id.endsWith('-points') || id.endsWith('-tracks');
      const visible = !detail || zoom >= 4;
      try {
        if (!visible && !activeIds.current.has(id)) continue;
        if (!activeIds.current.has(id)) {
          if (!controller.weatherProvider.isWeatherLayer(id)) { errors.push(id); continue; }
          const config = controller.weatherProvider.getWeatherLayerConfig(id);
          // The SDK hardcodes the raster metadata host; keep it behind our session proxy.
          if (id === 'satellite-infrared-color' && config && !Array.isArray(config)) {
            config.source = { ...config.source, metadataUrl: `${window.location.origin}/api/storm-maps/gl/session-${workspaceId}/maps/wolfgrid_session/satellite-infrared-color.json` };
          }
          controller.addWeatherLayer(id === 'satellite-infrared-color' && config && !Array.isArray(config) ? config : id, { data: { preloadLowQuality: id === 'radar' || id === 'gfs-radar' || id === 'wind-particles' }, paint: { opacity, ...(!props.standalone && id.endsWith('wind-particles') ? { particle: { density: 32 } } : {}) }, timing: { preload: id === 'radar' || id === 'gfs-radar' ? 1 : 0, ...(id === 'satellite-infrared-color' || id === 'lightning-flash' || id === 'lightning-strikes' || id === 'hail-size' || id === 'hail-size-max' || id === 'hail-severe-probability-max' ? { clamp: 'past' as const } : {}) }, legend: id === 'wind-particles' || id.endsWith('-tracks') || id.endsWith('-points') || id === 'lightning-flash' ? false : undefined });
          activeIds.current.add(id);
        } else {
          const layers = controller.getWeatherLayer(id);
          for (const layer of Array.isArray(layers) ? layers : layers ? [layers] : []) layer.setPaintProperty('opacity', opacity);
        }
        controller.setWeatherLayerVisibility(id, visible);
      } catch { errors.push(id); }
    }
    setLayerErrors(errors);
    if (map) ensureStormDrawCasing(map);
  }, [ready, settings, map, zoom, archiveView, recentHailEvent, selectedEvent, exposureHours, workspaceId, props.standalone]);

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
    const enabled = !archiveView && settings.mode !== 'history' && (settings.alerts || settings.outlook || settings.reports);
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
        cleanup?.(); upsertStormFeatures(map, data); cleanup = bindStormFeaturePopups(map, () => territoryDrawingRef.current);
        setRisk(data); setRiskLoaded(true); setRiskError(false);
      } catch { if (!abort.signal.aborted && request === sequence) setRiskError(true); }
    };
    const moved = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 400); };
    void load(); map.on('moveend', moved);
    const minutes = props.displaySettings?.autoUpdateMinutes ?? 5; const interval = minutes ? window.setInterval(() => void load(), minutes * 60_000) : undefined;
    return () => { abort.abort(); window.clearInterval(interval); window.clearTimeout(timer); map.off('moveend', moved); cleanup?.(); try { removeStormFeatures(map); } catch { /* map removed */ } };
  }, [map, mapLoaded, open, manifest, glEnabled, settings.alerts, settings.outlook, settings.reports, settings.mode, revision, archiveView, props.displaySettings?.autoUpdateMinutes]);

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

  if (!mapLoaded || !map) return null;
  if (!entitled) return props.standalone ? <div className="absolute left-5 top-5 z-30 rounded-xl bg-slate-950 p-5 text-white">Storm Maps requires an active workspace Storm Maps add-on. <Link className="underline" href="/settings">Open settings</Link></div> : null;
  if (manifest && !glEnabled) return <StormMapsRasterControl {...props} />;
  if (props.standalone) return <>
    <StormTerritoryOverlay map={map} territory={savedTerritory} />
    <StormWorkbenchView map={map} settings={settings} onChange={value => { if (value.shade === 'hail-size-max') map.setProjection('mercator'); setSettings(value); setTab('overview'); }} onSettings={props.onDisplaySettings} onArchive={active => setTab(active ? 'intelligence' : 'overview')} alwaysShowNames={props.displaySettings?.alwaysShowNames} ready={ready} loading={loading} error={error || (layerErrors.length ? `Unavailable layers: ${layerErrors.join(', ')}` : null)} playing={playing} position={position} clock={clock} rangeTitle={rangeTitle} rangeLabels={rangeLabels} onPlay={togglePlayback} onScrub={scrub} onNow={goNow} legendRef={legendRef}
      renderSaved={() => workspaceId ? <SavedStormTerritories initiallyOpen renderOverlay={false} map={map} workspaceId={workspaceId} revision={territoryRevision} active={savedTerritory} onSelect={setSavedTerritory} onCampaign={territory => props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, selectedAt: new Date().toISOString() })} /> : null}
      renderArchive={() => workspaceId ? <StormIntelligencePanel map={map} workspaceId={workspaceId} onSelect={setSelectedEvent} /> : null}
      renderLayers={() => <StormGLSettingsPanel settings={settings} onChange={setSettings} compact />}
      renderTerritory={() => <>
        <p className="mb-4 text-xs leading-relaxed text-slate-300">Select a measured intensity zone, save its boundary, then create campaigns inside it.</p>
        {!hailSelectionEvent && <button type="button" onClick={() => { map.setProjection('mercator'); setTab('overview'); setSettings(hailViewSettings(settings, 'history')); }} className="mb-4 w-full rounded-lg bg-[#a9d7d5] py-3 text-xs font-semibold text-[#0c202c]">Select a hail intensity zone</button>}
        {workspaceId && ready && controllerRef.current && hailSelectionEvent && !layerErrors.includes('hail-size-max') && <HailZoneSelector workspaceId={workspaceId} map={map} controller={controllerRef.current} windowKey={hailSelectionEvent.key} onSelecting={setSelectingTerritory} onApply={async zone => { await saveTerritory(zone.name, zone.polygon.geometry, { version: 1, event: hailSelectionEvent, selectedAt: new Date().toISOString(), minimumHailMM: zone.minimum, maximumHailMM: zone.maximum, selection: 'intensity-zone', evidenceKind: 'hail-size' }); }} />}
        {workspaceId && selectedEvent && !recentHailEvent && <StormTerritorySketch workspaceId={workspaceId} key={selectedEvent.key} map={map} onSelecting={setSelectingTerritory} onSave={saveTerritory} context={{ version: 1, event: { key: selectedEvent.key, title: selectedEvent.title, hazard: selectedEvent.hazard, source: selectedEvent.source, sourceId: selectedEvent.sourceId, start: selectedEvent.start, end: selectedEvent.end }, selectedAt: new Date().toISOString(), minimumHailMM: null, selection: 'user-drawn', evidenceKind: selectedEvent.hazard === 'hurricane' ? 'track' : 'reports' }} />}
        {workspaceId && <SavedStormTerritories renderOverlay={false} map={map} workspaceId={workspaceId} revision={territoryRevision} active={savedTerritory} onSelect={setSavedTerritory} onCampaign={territory => props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, selectedAt: new Date().toISOString() })} />}
      </>} />
  </>;
  return <>
    <div className="absolute left-[5.5rem] top-3 z-30 flex items-center gap-2">
      <button type="button" onClick={() => { props.onStormModeChange?.(true); if (!open) { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); if (map.getZoom() < 4) map.easeTo({ zoom: 5, pitch: 0, bearing: 0, duration: 600 }); else if (map.getPitch() !== 0) map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); setOpen(true); setPanel(true); } else setPanel(!panel); }} aria-expanded={open && panel} aria-controls="storm-maps-gl-panel" className="flex h-9 w-[4.08rem] items-center justify-center gap-1 rounded-full border border-cyan-200/60 bg-slate-950/90 px-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-xl"><CloudLightning className="h-3 w-3 shrink-0 text-cyan-300" />Storm</button>
      {open && <button type="button" aria-label="Turn off Storm" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-slate-950/90 text-white"><X className="h-4 w-4" /></button>}
    </div>
    {open && <>
      {props.standalone && <StormWeatherRail alwaysShowNames={props.displaySettings?.alwaysShowNames} onSettings={props.onDisplaySettings} settings={settings} onChange={value => { if (value.shade === 'hail-size-max') map.setProjection('mercator'); setSettings(value); setTab('overview'); setSettingsOpen(false); setPanel(true); }} />}
      <section ref={panelScrollRef} id="storm-maps-gl-panel" aria-label="Storm command controls" tabIndex={0} style={{ display: panel ? undefined : 'none', maxHeight: 'calc(100% - 7rem)', overscrollBehavior: 'contain', touchAction: 'pan-y', scrollbarGutter: 'stable' }} className="dark absolute left-5 top-20 z-30 w-[min(20rem,calc(100%-2.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Storms</h2><p className="mt-1 text-[10px] text-slate-400">{settingsOpen ? 'Weather layers & display settings' : archiveView ? (tab === 'historic' ? 'Search past storms by date.' : 'Find recent storms. Plan your next campaign.') : `${settings.mode === 'history' ? 'Past observations' : settings.mode === 'forecast' ? 'Forecast' : 'Live & short-range threats'} · ${enabledCount} overlays enabled`}</p></div><div className="flex items-center gap-1"><button type="button" aria-label="Storm settings" title="Storm settings" aria-expanded={settingsOpen} aria-controls="storm-settings-panel" onClick={() => setSettingsOpen(value => !value)} className={`rounded-lg p-2 ${settingsOpen ? 'bg-cyan-300 text-slate-950' : 'hover:bg-white/10'}`}><Settings className="h-4 w-4" /></button><button aria-label="Hide Storm controls" onClick={() => setPanel(false)} className="rounded-lg p-2 hover:bg-white/10"><ChevronDown className="h-4 w-4" /></button></div></div>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">{(['intelligence', 'overview', 'historic'] as const).map((value) => <button key={value} type="button" onClick={() => { setTab(value); setSettingsOpen(false); setExposureHours(null); }} aria-pressed={tab === value} className={`flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold capitalize ${tab === value ? 'bg-cyan-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>{{intelligence:'Find Storm',overview:'Weather Map',historic:'Historic'}[value]}</button>)}</div>
        <div className="mt-4 rounded-xl border border-cyan-300/25 p-3 text-[11px]"><p className="font-semibold text-cyan-200">Storm territories</p><p className="mt-1 text-slate-400">Select an intensity zone, review its outline and save the territory. Create campaigns inside a saved territory.</p>{!hailSelectionEvent && <button type="button" onClick={() => { setTab('overview'); setSettings(hailViewSettings(settings, 'history')); }} className="mt-2 w-full rounded-lg border border-cyan-300/40 py-2 text-cyan-200">Select a past hail intensity territory</button>}{!archiveView && settings.mode === 'forecast' && <p className="mt-2 text-amber-200">Forecast shading shows predicted weather. Its colors are not measured hail intensity or a damage boundary.</p>}</div>
        {archiveView && workspaceId && <div className="mt-4" hidden={settingsOpen}><div hidden={exposureHours !== null}><StormIntelligencePanel browseMode={tab === 'historic' ? 'historic' : 'recent'} onHailExposure={(hours) => { setSelectedEvent(null); setExposureEnd(new Date()); setExposureHours(hours); }} map={map} workspaceId={workspaceId} onSelect={selectArchiveEvent} territoryDrawing={territoryDrawing} /></div></div>}
        {archiveView && !settingsOpen && exposureHours && <div className="mt-4 space-y-3">
          <button type="button" onClick={() => setExposureHours(null)} className="text-xs text-cyan-200">← Back to find storms</button>
          <h3 className="text-sm font-semibold">Hail exposure · past {exposureHours} hours</h3>
          <div className="grid grid-cols-2 gap-2">{([12, 24] as const).map(hours => <button key={hours} type="button" aria-pressed={hours === exposureHours} onClick={() => { setExposureEnd(new Date()); setExposureHours(hours); }} className={`rounded-lg border py-2 text-xs ${hours === exposureHours ? 'border-cyan-300 text-cyan-200' : 'border-white/15'}`}>Last {hours}h</button>)}</div>
          <p className="text-[11px] text-slate-300">Largest estimated hail at each location during this period. Use the intensity legend to choose a neighborhood to inspect.</p>
          <p className="text-[10px] text-slate-400">Window ending {exposureEnd.toLocaleString()}. U.S., Europe, Japan and Australia; Canada is not covered. Empty shading does not establish that no hail occurred.</p>
          {props.onStormCampaign && <button type="button" disabled={!ready || loading || layerErrors.includes('hail-size-max')} onClick={() => { props.onStormCampaign?.({ version: 1, event: { key: `hail-exposure:${exposureHours}:${exposureEnd.toISOString()}`, title: `Hail exposure · ${exposureHours} hours`, hazard: 'hail', source: 'xweather', sourceId: 'hail-size-max', start: new Date(exposureEnd.getTime() - exposureHours * 3600_000).toISOString(), end: exposureEnd.toISOString() }, selectedAt: new Date().toISOString(), minimumHailMM: null, selection: 'user-drawn', evidenceKind: 'hail-size' }); setPanel(false); }} className="w-full rounded-lg bg-red-500 py-3 text-xs font-semibold disabled:opacity-40">Draw campaign in this area</button>}
          <p className="text-[10px] text-amber-200">Estimated exposure identifies inspection priorities, not confirmed property damage. Draw your own boundary within the shaded corridor.</p>
        </div>}
        {panel && workspaceId && ready && controllerRef.current && hailSelectionEvent && !layerErrors.includes('hail-size-max') && <div className="mt-4"><HailZoneSelector workspaceId={workspaceId} map={map} controller={controllerRef.current} windowKey={hailSelectionEvent.key} onSelecting={setSelectingTerritory} onApply={async (zone) => {
          await saveTerritory(zone.name, zone.polygon.geometry, { version: 1, event: hailSelectionEvent, selectedAt: new Date().toISOString(), minimumHailMM: zone.minimum, maximumHailMM: zone.maximum, selection: 'intensity-zone', evidenceKind: 'hail-size' });
        }} /></div>}
        {panel && workspaceId && archiveView && selectedEvent && !recentHailEvent && <StormTerritorySketch workspaceId={workspaceId} key={selectedEvent.key} map={map} onSelecting={setSelectingTerritory} onSave={saveTerritory} context={{ version: 1, event: { key: selectedEvent.key, title: selectedEvent.title, hazard: selectedEvent.hazard, source: selectedEvent.source, sourceId: selectedEvent.sourceId, start: selectedEvent.start, end: selectedEvent.end }, selectedAt: new Date().toISOString(), minimumHailMM: null, selection: 'user-drawn', evidenceKind: selectedEvent.hazard === 'hurricane' ? 'track' : 'reports' }} />}
        {workspaceId && props.onStormCampaign && <SavedStormTerritories map={map} workspaceId={workspaceId} revision={territoryRevision} active={savedTerritory} onSelect={setSavedTerritory} onCampaign={(territory) => {
          setPanel(false);
          props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, selectedAt: new Date().toISOString() });
        }} />}
        <div id="storm-settings-panel" className="mt-4" hidden={!settingsOpen}><StormGLSettingsPanel settings={settings} onChange={setSettings} compact /></div>
        <div hidden={settingsOpen || tab !== 'overview'} className="mt-4 space-y-4">
          <p className={`rounded-lg border p-2 text-[11px] ${settings.mode === 'history' ? 'border-violet-300/30 text-violet-200' : 'border-amber-300/30 text-amber-200'}`}>{settings.mode === 'history' ? 'PAST · Hail-size shading shows historical estimates. Threat tracks are archived predictions.' : settings.mode === 'forecast' ? 'FORECAST · Predicted weather and threat areas.' : 'LIVE · Current weather with short-range forecast threats.'}</p>
          <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setSettings({ ...STRONGEST_STORM_SETTINGS })} className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 py-2 text-xs font-semibold text-cyan-200">Strongest preset</button><button type="button" onClick={() => setSettings({ ...settings, shade: 'none', mode: 'live', radar: true })} className="rounded-xl border border-white/15 py-2 text-xs hover:bg-white/10">Radar focus</button></div>
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3"><p className="text-xs font-semibold text-cyan-200">Hurricane maps</p><div className="mt-2 grid grid-cols-2 gap-2">{(['satellite', 'forecast'] as const).map((view) => <button key={view} type="button" onClick={() => setSettings(hurricaneViewSettings(settings, view))} className="rounded-lg border border-white/15 py-2 text-[11px] hover:bg-white/10">Hurricane {view}</button>)}</div><p className="mt-2 text-[10px] leading-relaxed text-slate-400">Satellite shows observed cloud-top temperatures over the past 6 hours. Forecast shows GFS precipitation, wind and pressure lines. Tracks and cones come from published cyclone advisories; the cone describes uncertainty in the storm centre.</p></div>
          <div className="rounded-xl border border-violet-300/20 bg-violet-300/5 p-3"><p className="text-xs font-semibold text-violet-200">Hail intelligence</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSettings(hailViewSettings(settings, 'live'))} className="rounded-lg border border-white/15 py-2 text-[11px] hover:bg-white/10">Live hail tracks</button><button type="button" onClick={() => setSettings(hailViewSettings(settings, 'history'))} className="rounded-lg border border-white/15 py-2 text-[11px] hover:bg-white/10">Past 24h hail size</button></div><p className="mt-2 text-[10px] leading-relaxed text-slate-400">Live threat areas and tracks include Canada; predictions extend up to 60 minutes. Hail-size maps cover the U.S., Europe, Japan and Australia. Map data does not confirm property damage.</p></div>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1">{(['live', 'history', 'forecast'] as const).map((mode) => <button key={mode} type="button" onClick={() => setSettings({ ...settings, mode })} aria-pressed={settings.mode === mode} className={`rounded-lg py-2 text-xs capitalize ${settings.mode === mode ? 'bg-white/15 font-semibold' : 'text-slate-400'}`}>{mode === 'history' ? 'Past' : mode}</button>)}</div>
          <div><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Storm intelligence</p><div className="mt-2 flex flex-wrap gap-1.5">{toggled.map((group) => <span key={group.key} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px]">{group.title}</span>)}{settings.alerts && <span className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">Official alerts</span>}{settings.outlook && <span className="rounded-md border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[10px] text-violet-200">Canadian outlook</span>}{settings.reports && <span className="rounded-md border border-white/10 px-2 py-1 text-[10px]">U.S. reports</span>}</div></div>
          {settings.mode !== 'history' && settings.impact && <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs font-semibold">Campaign risk in view</p>{!settings.alerts && !settings.outlook ? <p className="mt-2 text-[11px] text-slate-400">Enable warnings or outlooks to assess mapped territories.</p> : !riskLoaded ? <p className="mt-2 text-[11px] text-slate-400">{riskError ? 'Official risk data unavailable. Retry by reopening Storm.' : 'Checking official risk areas…'}</p> : <><p className={`mt-2 text-sm font-semibold ${impacts.length ? 'text-amber-200' : 'text-cyan-200'}`}>{impacts.length} / {territories?.features.length || 0} mapped territories overlap risk areas</p><p className="mt-1 text-[10px] text-slate-400">{risk.features.filter((feature) => feature.properties.kind === 'alert').length} alerts · {risk.features.filter((feature) => feature.properties.kind === 'outlook').length} outlooks · {risk.features.filter((feature) => feature.properties.kind === 'report').length} reports in view</p>{impacts.slice(0, 4).map((item) => <div key={item.id} className="mt-2 border-t border-white/10 pt-2"><p className="text-[11px] font-medium">{item.name}</p><p className="text-[10px] text-slate-400">{item.events.join(' · ')}</p></div>)}<p className="mt-2 text-[10px] leading-relaxed text-slate-500">Based on loaded official warnings and outlooks. This is not a damage assessment.{riskError ? ' Refresh failed; showing the last loaded data.' : ''}</p></>}</div>}
          <p className="text-[10px] leading-relaxed text-slate-400">{settings.shade === 'none' ? 'Storm focus' : WEATHER_SHADES.find((shade) => shade.id === settings.shade)?.label} · {rangeTitle}. {settings.inspector ? 'Hover over the map to inspect weather; tap on touch devices.' : ''} Storm-cell tracks cover the U.S.; hail threats include Canada.</p>
        </div>
        {!archiveView && isHistoricalHailShade(settings.shade) && <p className="mt-3 rounded-lg border border-violet-300/20 bg-violet-300/5 p-2 text-[10px] leading-relaxed text-violet-200">{settings.mode !== 'history' ? 'Hail-size history is hidden in Live and Forecast. Select History to view it.' : 'Hail-size coverage: U.S., Europe, Japan and Australia. Canada is not covered by this map layer; an empty map there does not mean no hail occurred.'}</p>}
        {settings.mode === 'forecast' && settings.hail && <p className="mt-2 text-[10px] text-slate-400">Hail tracks are short-range nowcasts, up to 60 minutes; they are not a 24-hour hail forecast.</p>}
        <div className="mt-4 grid grid-cols-3 gap-2">{([{ label: 'Overview', zoom: 4 }, { label: 'Regional', zoom: 7 }, { label: 'Local', zoom: 12 }]).map((view) => <button key={view.label} type="button" onClick={() => map.easeTo({ zoom: view.zoom, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, retainPadding: false, duration: 600 })} className="flex items-center justify-center gap-1 rounded-xl border border-white/15 py-2 text-xs hover:bg-white/10"><MapIcon className="h-3 w-3" />{view.label}</button>)}</div>
        {zoom < 4 && <p className="mt-2 text-[10px] text-slate-400">Overview shows radar and broad risk areas. Zoom in for individual lightning strikes and storm tracks.</p>}

        {(!archiveView || recentHailEvent || exposureHours) && (loading || !ready) && !error && <p role="status" className="mt-3 flex items-center gap-2 text-[11px] text-cyan-200"><Loader2 className="h-3 w-3 animate-spin" />Loading weather data…</p>}
        {(error || layerErrors.length > 0) && <p role="alert" className="mt-3 text-xs text-amber-200">{error || `Unavailable in this renderer: ${layerErrors.join(', ')}. Other layers remain active.`}</p>}
        <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">Weather data © <a href="https://www.xweather.com" target="_blank" rel="noreferrer" className="underline">Vaisala Xweather</a> · NOAA/NWS · ECCC. Follow official authorities for safety decisions.</p>
      </section>
      <aside aria-label="Storm intensity legend" className="absolute bottom-32 right-5 z-30 max-h-[35%] w-[min(18rem,calc(100%-2.5rem))] overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 p-3 text-white shadow-xl max-sm:bottom-28">
        <h3 className="text-xs font-semibold">Storm intensity</h3>
        {archiveView && selectedEvent && <div className="mt-2 space-y-1 text-[10px]">
          <p className="capitalize">{selectedEvent.hazard} · {selectedEvent.active ? 'Includes forecast' : 'Past observations'}</p>
          {selectedEvent.hazard === 'hail' ? <><p>Report points: <span style={{color:'#67e8f9'}}>Small</span> → <span style={{color:'#c084fc'}}>1″ / 25.4 mm</span> → <span style={{color:'#f472b6'}}>2″ / 50.8 mm</span> → <span style={{color:'#f87171'}}>3″ / 76.2 mm+</span></p><p>Shading uses the separate Xweather scale below.</p></> : selectedEvent.hazard === 'hurricane' ? <><p><span className="text-violet-300">━ Past track</span> · <span className="text-amber-300">━ Forecast</span></p><p>Observed positions use the wind-speed scale: cyan → yellow (93 km/h) → orange (119 km/h) → red (150 km/h+). Forecast positions remain amber.</p><p>{selectedEvent.category || 'Category unknown'}{selectedEvent.maxWindKPH != null ? ` · Max sustained ${(selectedEvent.maxWindKPH / 1.609344).toFixed(0)} mph / ${selectedEvent.maxWindKPH.toFixed(0)} km/h` : ''}</p><p>Wind areas: <span className="text-sky-300">34 kt</span> · <span className="text-orange-300">50 kt</span> · <span className="text-red-300">64 kt</span></p><p className="text-amber-200">Amber area: forecast centre cone.</p></> : <><p className="text-cyan-200">● Individual report locations</p><p>{selectedEvent.hazard === 'tornado' ? 'EF intensity unavailable in these reports.' : selectedEvent.maxWindKPH != null ? `Max reported wind: ${(selectedEvent.maxWindKPH / 1.609344).toFixed(0)} mph / ${selectedEvent.maxWindKPH.toFixed(0)} km/h` : 'Wind intensity unknown.'}</p>{selectedEvent.hazard === 'wind' ? <p>Wind points: <span style={{color:'#67e8f9'}}>Lower</span> → <span style={{color:'#fde047'}}>58 mph / 93 km/h</span> → <span style={{color:'#fb923c'}}>74 mph / 119 km/h</span> → <span style={{color:'#f87171'}}>93 mph / 150 km/h+</span>. Unknown wind: cyan.</p> : <p>Point color does not indicate intensity.</p>}</>}
        </div>}
        <div ref={legendRef} hidden={archiveView && !recentHailEvent && !exposureHours} className="mt-2 text-xs" />
        {archiveView && !selectedEvent && !exposureHours && <p className="mt-2 text-[10px] text-slate-400">Choose a storm or a 12h / 24h hail summary to show its scale.</p>}
        <p className="mt-2 text-[9px] text-slate-400">{exposureHours ? `Maximum hail · last ${exposureHours}h · ` : ''}Colors show weather estimates or reports, not confirmed home damage.</p>
      </aside>
      {!archiveView && <div className="absolute bottom-7 left-5 right-20 z-30 flex max-w-3xl items-center gap-4 rounded-2xl border border-white/15 bg-slate-950/95 px-4 py-3 text-white shadow-xl backdrop-blur-xl">
        <button type="button" onClick={togglePlayback} disabled={!ready} aria-label={playing ? 'Pause weather animation' : 'Play weather animation'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950 disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <div className="min-w-0 flex-1"><StormTimelineRange settings={settings} onChange={setSettings} /><div className="mb-2 flex items-center justify-between text-[11px]"><span className="text-slate-400">{rangeTitle}</span><span className="font-semibold">{clock}</span><button type="button" onClick={goNow} className="text-cyan-200">Now</button></div><Slider min={0} max={100} step={1} value={[position]} onValueChange={(v) => scrub(v[0])} aria-label="Weather timeline" /><div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>{rangeLabels.start}</span><span>{rangeLabels.end}</span></div></div>
      </div>}
    </>}
  </>;
}
