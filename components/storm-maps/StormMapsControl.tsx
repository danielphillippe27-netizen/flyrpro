'use client';
import { TornadoAreaSelector } from './TornadoAreaSelector';
import { HurricaneAreaSelector } from './HurricaneAreaSelector';
import { StormTerritoryEditor } from './StormTerritoryEditor';
import { StormDiscoveryPanel } from './intelligence/StormDiscoveryPanel';
import { StormRegionBrowser } from './intelligence/StormRegionBrowser';
import { mrmsHailOverlay } from '@/lib/storm-maps/intelligence/mrms-hail-overlay';
import { StormWorkbenchView } from './StormWorkbenchView';
import { StormTerritoryOverlay } from './StormTerritoryOverlay';
import { StormTerritoryDrawingContext } from './StormTerritoryCampaignActions';
import { StormTerritoryDisplayContext } from '@/lib/storm-maps/territory-display';
import type { StormDisplaySettings } from '@/lib/storm-maps/display-settings';
import Link from 'next/link';
import { StormOverlayPicker } from './StormOverlayPicker';
import { SavedStormTerritories } from './SavedStormTerritories';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';

import { useCallback, useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { Slider } from '@/components/ui/slider';
import type { StormEvent, StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { useStormGLSettings } from './useStormGLSettings';
import { bindStormFeaturePopups, upsertStormFeatures, removeStormFeatures, upsertStormRaster, removeStormRaster, ensureStormDrawCasing } from '@/lib/storm-maps/map-layers';
import { STRONGEST_STORM_SETTINGS, stormTimeRange, hailViewSettings } from '@/lib/storm-maps/gl-settings';
import type { StormTerritories } from '@/lib/storm-maps/gl-impact';
import type { StormMapsManifest, StormFeatureProperties } from '@/lib/storm-maps/types';

type Props = { inline?: boolean; campaignCreation?: boolean; mobileCampaign?: boolean; initiallyOpenDiscovery?: boolean; drawingRequest?: number; territoryDrawing?: boolean; onSidebarWidth?: (width: number) => void; displaySettings?: StormDisplaySettings; onDisplaySettings?: () => void; standalone?: boolean; map: mapboxgl.Map | null; mapLoaded: boolean; workspaceId: string | null; territories?: StormTerritories; onStormModeChange?: (active: boolean) => void; onStormCampaign?: (context: StormCampaignContext, boundary?: GeoJSON.Feature<GeoJSON.Polygon>) => void };
const timeLabel = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function StormMapsControl(props: Props) {
  return props.standalone ? <StormWorkbench {...props} /> : <StormOverlayPicker {...props} />;
}

function StormWorkbench(props: Props) {
  const { map, mapLoaded, workspaceId, onStormModeChange } = props;
  const { settings, setSettings } = useStormGLSettings(workspaceId);
  const [entitled, setEntitled] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [territorySelection, setTerritorySelection] = useState<'draw' | 'weather'>('draw');
  const [territoryWindowEnd, setTerritoryWindowEnd] = useState(() => new Date());
  useEffect(() => { if (open) setTerritoryWindowEnd(new Date()); }, [open, settings.mode, settings.historyHours, settings.shade]);
  useEffect(() => { onStormModeChange?.(open); }, [open, onStormModeChange]);
  const [windArchiveView, setWindArchiveView] = useState(false);
  const handleWorkbenchArchive = useCallback((active: boolean) => { if (!active) setWindArchiveView(false); }, []);
  const [savedTerritory, setSavedTerritory] = useState<SavedStormTerritory | null>(null);
  const [territoryRevision, setTerritoryRevision] = useState(0);
  useEffect(() => { setSavedTerritory(null); }, [workspaceId]);
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);
  const showStormReports = useCallback(() => {
    setWindArchiveView(false);
    setSelectedEvent(null);
  }, []);
  const showWindArchive = useCallback(() => {
    setWindArchiveView(true);
    setSelectedEvent(null); setSavedTerritory(null);
    setSettings(previous => ({ ...previous, mode: 'history', shade: 'none', radar: false, wind: false, pressure: false, cyclones: false, hail: false, cells: false, stormCones: false, lightning: false, lightningThreats: false, alerts: false, outlook: false, reports: false, inspector: false, impact: false }));
  }, [setSettings]);
  const selectEvent = useCallback((event: StormEvent | null) => {
    setSavedTerritory(null);
    setSelectedEvent(event);
    if (event) {
      if (event.hazard === 'hail' && map?.getProjection().name !== 'mercator') map?.setProjection('mercator');
      setSettings(previous => event.hazard === 'hail' ? {
        ...previous, mode: 'history', shade: 'hail-size-max', historyHours: 24,
        radar: false, wind: false, pressure: false, cyclones: false,
        hail: false, cells: false, stormCones: false, lightning: false,
        lightningThreats: false, alerts: false, outlook: false, reports: false,
      } : { ...previous, mode: 'history' });
    }
  }, [map, setSettings]);
  const saveTerritoryAndReturn = async (name: string, boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon, context: StormCampaignContext, selectSaved = true) => {
    const response = await fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId ?? '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, boundary, context }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    if (selectSaved) setSavedTerritory(data.territory); setTerritoryRevision(value => value + 1);
    return data.territory as SavedStormTerritory;
  };
  const saveTerritory = async (...args: Parameters<typeof saveTerritoryAndReturn>): Promise<void> => { await saveTerritoryAndReturn(...args); };
  const [manifest, setManifest] = useState<StormMapsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setCheckingAccess(true); setAccessError('');
    setEntitled(false); setManifest(null); setOpen(false); setSavedTerritory(null); setSelectedEvent(null);
    if (!workspaceId) return;
    const abort = new AbortController();
    fetch(`/api/storm-maps/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not check Storm Maps access.'); return data; }).then((d) => { if (!abort.signal.aborted) { setEntitled(d?.addon?.isActive === true); if (d?.addon?.isActive === true) { setSettings(previous => props.mobileCampaign ? { ...hailViewSettings(previous, 'history'), shade: 'none', radar: true, wind: false, pressure: false, cyclones: false, hail: false, cells: false, stormCones: false, lightning: false, lightningThreats: false, reports: false, alerts: false, outlook: false, inspector: false, impact: false } : { ...STRONGEST_STORM_SETTINGS, units: previous.units, shade: 'temperatures', hail: false, cells: false, lightning: false, lightningThreats: false, reports: false, outlook: false, opacity: 100, radarOpacity: 70 }); setOpen(true); } } }).catch(reason => { if (!abort.signal.aborted) setAccessError(reason instanceof Error ? reason.message : 'Could not connect to Storms.'); }).finally(() => { if (!abort.signal.aborted) setCheckingAccess(false); });
    return () => abort.abort();
  }, [workspaceId, setSettings, accessAttempt, props.mobileCampaign]);

  const refresh = useCallback(async (signal: AbortSignal) => {
    if (!map || !workspaceId) return;
    const center = map.getCenter();
    const r = await fetch(`/api/storm-maps/manifest?workspaceId=${encodeURIComponent(workspaceId)}&lat=${center.lat}&lon=${center.lng}`, { signal, cache: 'no-store' });
    if (!r.ok) throw new Error('Could not start the weather session.');
    setManifest(await r.json());
    setError(null);
  }, [map, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const load = () => { void refresh(abort.signal).catch((e) => { if (!abort.signal.aborted) setError(e.message); }); };
    load();
    const minutes = props.displaySettings?.autoUpdateMinutes ?? 10;
    const update = () => {
      if (document.hidden) return;
      load();
      setRevision(value => value + 1);
      setTerritoryWindowEnd(new Date());
    };
    let moveTimer: number | undefined;
    const onMapMove = () => {
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => { if (!document.hidden) load(); }, 450);
    };
    const interval = minutes ? window.setInterval(update, minutes * 60_000) : undefined;
    document.addEventListener('visibilitychange', update);
    map?.on('moveend', onMapMove);
    return () => {
      abort.abort();
      window.clearInterval(interval);
      window.clearTimeout(moveTimer);
      document.removeEventListener('visibilitychange', update);
      map?.off('moveend', onMapMove);
    };
  }, [map, open, refresh, props.displaySettings?.autoUpdateMinutes]);

  useEffect(() => {
    if (!map) return;
    const changed = () => setRevision((r) => r + 1);
    map.on('style.load', changed);
    return () => { map.off('style.load', changed); };
  }, [map]);

  const radar = manifest?.layers.find(layer => layer.id === 'radar' && layer.available);
  const showPublicRadar = settings.radar && !selectedEvent && !windArchiveView && !savedTerritory;
  const [publicRadarIndex, setPublicRadarIndex] = useState<number | null>(null);
  const [publicRadarPlaying, setPublicRadarPlaying] = useState(false);
  const publicRadarFrameCount = radar?.frames.length ?? 0;
  const publicRadarFrameIndex = Math.max(0, Math.min(publicRadarIndex ?? publicRadarFrameCount - 1, publicRadarFrameCount - 1));
  const publicRadarFrame = radar?.frames[publicRadarFrameIndex];

  useEffect(() => {
    if (!publicRadarPlaying || !showPublicRadar || publicRadarFrameCount < 2) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) setPublicRadarIndex(index => ((index ?? publicRadarFrameCount - 1) + 1) % publicRadarFrameCount);
    }, Math.max(350, settings.speed * 1000 / publicRadarFrameCount));
    return () => window.clearInterval(interval);
  }, [publicRadarPlaying, showPublicRadar, publicRadarFrameCount, settings.speed]);

  useEffect(() => {
    const frame = publicRadarFrame;
    if (!map || !mapLoaded || !open || !showPublicRadar || !radar || !frame || !manifest) return;
    const tileUrl = `/api/storm-maps/tiles/${radar.provider}/radar/${encodeURIComponent(frame.time)}/{z}/{x}/{y}.png?token=${encodeURIComponent(manifest.tileToken)}`;
    try {
      upsertStormRaster(map, { tileUrl, provider: radar.provider, opacity: settings.radarOpacity / 100 });
      ensureStormDrawCasing(map);
    } catch { /* A style update may be in progress. Retry when style.load fires. */ }
    return () => { try { removeStormRaster(map); } catch { /* map removed */ } };
  }, [map, mapLoaded, open, showPublicRadar, radar, manifest, publicRadarFrame, settings.radarOpacity, revision]);

  useEffect(() => {
    const enabled = !savedTerritory && !selectedEvent && !windArchiveView && (settings.alerts || settings.outlook || settings.reports);
    if (!map || !mapLoaded || !open || !manifest || !enabled) {
      if (map && mapLoaded) removeStormFeatures(map);
      return;
    }
    const abort = new AbortController();
    let cleanup: (() => void) | undefined;
    let timer: number | undefined;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const bounds = map.getBounds();
      if (!bounds) return;
      const bbox = [Math.max(-180, bounds.getWest()), Math.max(18, bounds.getSouth()), Math.min(-50, bounds.getEast()), Math.min(85, bounds.getNorth())];
      if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) { removeStormFeatures(map); return; }
      try {
        const r = await fetch(`${manifest.featureEndpoint}?bbox=${bbox.join(',')}&alerts=${settings.alerts}&outlook=${settings.outlook}&reports=${settings.reports}&token=${encodeURIComponent(manifest.tileToken)}`, { signal: abort.signal });
        if (!r.ok) throw new Error('Risk data unavailable');
        const data = await r.json() as GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties>;
        if (abort.signal.aborted || request !== sequence) return;
        cleanup?.(); upsertStormFeatures(map, data); cleanup = bindStormFeaturePopups(map);
      } catch { /* Keep the last successful feature overlay if refresh fails. */ }
    };
    const moved = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 400); };
    void load(); map.on('moveend', moved);
    const minutes = props.displaySettings?.autoUpdateMinutes ?? 5; const interval = minutes ? window.setInterval(() => { if (!document.hidden) void load(); }, minutes * 60_000) : undefined;
    return () => { abort.abort(); window.clearInterval(interval); window.clearTimeout(timer); map.off('moveend', moved); cleanup?.(); try { removeStormFeatures(map); } catch { /* map removed */ } };
  }, [map, mapLoaded, open, manifest, selectedEvent, windArchiveView, settings.alerts, settings.outlook, settings.reports, revision, props.displaySettings?.autoUpdateMinutes, savedTerritory]);

  const timelineRange = stormTimeRange(settings.mode, settings.historyHours, territoryWindowEnd.getTime());

  if (!mapLoaded || !map) return null;
  if (checkingAccess) return <p role="status" className="absolute left-5 top-5 rounded-xl bg-background p-5">Checking Storm Maps access…</p>;
  if (accessError) return <div role="alert" className="absolute left-5 right-5 top-5 rounded-xl bg-background p-5"><p>{accessError}</p><button type="button" className="mt-3 min-h-11 rounded-lg border px-4" onClick={() => setAccessAttempt(value => value + 1)}>Retry</button></div>;
  if (!entitled) return <div className="absolute left-5 top-5 z-30 rounded-xl bg-slate-950 p-5 text-white">Storm Maps requires an active workspace Storm Maps add-on. <Link className="underline" href="/settings">Open settings</Link></div>;
  return <StormTerritoryDrawingContext.Provider value={territory => {
    setSavedTerritory(territory);
    props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() });
  }}><StormTerritoryDisplayContext.Provider value={!!savedTerritory}>
    <StormTerritoryOverlay map={map} territory={savedTerritory} />
    <StormWorkbenchView historicHail={!!mrmsHailOverlay(selectedEvent?.key, selectedEvent?.hailMap) && !savedTerritory} archivedWind={windArchiveView} mobileCampaign={props.mobileCampaign} initiallyOpenDiscovery={props.initiallyOpenDiscovery} drawingRequest={props.drawingRequest} onCreateTerritory={setTerritorySelection} onSidebarWidth={props.onSidebarWidth} map={map} selectedStorm={selectedEvent !== null} onSettings={props.onDisplaySettings} onArchive={handleWorkbenchArchive} loading={!savedTerritory && !manifest} error={savedTerritory ? null : error}
      renderSaved={() => workspaceId ? <SavedStormTerritories initiallyOpen renderOverlay={false} map={map} workspaceId={workspaceId} revision={territoryRevision} active={savedTerritory} onSelect={setSavedTerritory} onCampaign={territory => props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() })} /> : null}
      renderArchive={(onTerritory, browseOnly, onSelected, windActions) => workspaceId ? <StormRegionBrowser map={map} workspaceId={workspaceId} onReports={showStormReports} onWindView={showWindArchive} windActive={windArchiveView} onSaveWind={saveTerritoryAndReturn} windActions={windActions} onEvent={selectEvent} renderHistory={country=><StormDiscoveryPanel key={`history:${country}`} simple savedHistory savedCountry={country} browseOnly={browseOnly} onSelected={onSelected} allAreasByDefault map={map} workspaceId={workspaceId} onSelect={selectEvent} onTerritory={onTerritory} onSaveZone={saveTerritory}/>} renderReports={()=><StormDiscoveryPanel simple browseOnly={browseOnly} onSelected={onSelected} allAreasByDefault map={map} workspaceId={workspaceId} onSelect={selectEvent} onTerritory={onTerritory} onSaveZone={saveTerritory}/>} /> : null}
      renderLayers={() => (
        <div className="space-y-3 text-sm">
          {([['radar', 'Live radar'], ['alerts', 'Official weather alerts'], ['outlook', 'Storm outlooks'], ['reports', 'U.S. storm reports']] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })} />
              {label}
            </label>
          ))}
          {showPublicRadar && publicRadarFrameCount > 1 && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span>Radar playback</span>
                <button type="button" onClick={() => setPublicRadarPlaying(value => !value)} className="rounded-md border px-3 py-2">
                  {publicRadarPlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <Slider min={0} max={publicRadarFrameCount - 1} step={1} value={[publicRadarFrameIndex]} onValueChange={([index]) => { setPublicRadarPlaying(false); setPublicRadarIndex(index); }} aria-label="Radar frame" />
              {publicRadarFrame && <p className="text-xs text-muted-foreground">{timeLabel(new Date(publicRadarFrame.label))}</p>}
            </div>
          )}
        </div>
      )}
      renderTerritory={onSelectionReady => <>
        <div style={props.mobileCampaign ? { display: 'none' } : undefined} className="mb-3 flex gap-2" role="group" aria-label="Storm territory selection">
          <button type="button" aria-pressed={territorySelection === 'draw'} onClick={() => setTerritorySelection('draw')} className="flex-1 rounded-lg border border-cyan-300/40 px-2 py-2 text-xs">Draw territory</button>
          <button type="button" aria-pressed={territorySelection === 'weather'} onClick={() => setTerritorySelection('weather')} className="flex-1 rounded-lg border border-cyan-300/40 px-2 py-2 text-xs">Select weather zone</button>
        </div>
        {territorySelection === 'draw' && workspaceId && <StormTerritoryEditor onPrepareCampaign={savedTerritory ? (name,boundary,context) => saveTerritoryAndReturn(name,boundary,context,false) : undefined} onSelectionReady={onSelectionReady} key="custom-storm-drawing" workspaceId={workspaceId} map={map} onSave={saveTerritory} savedTerritory={savedTerritory} context={{version:1,event:selectedEvent?{key:selectedEvent.key,title:selectedEvent.title,hazard:selectedEvent.hazard,source:selectedEvent.source,sourceId:selectedEvent.sourceId,start:selectedEvent.start,end:selectedEvent.end}:{key:`storm-map:${territoryWindowEnd.toISOString()}`,title:'Storm inspection area',hazard:'hail',source:'manual',sourceId:'storm-map-selection',start:timelineRange.start.toISOString(),end:timelineRange.end.toISOString()},selectedAt:new Date().toISOString(),minimumHailMM:null,selection:'user-drawn',evidenceKind:'user-drawn'}} />}
        {territorySelection === 'weather' && <>
          {!selectedEvent && <p className="text-xs">Choose a storm in Find storm first, or draw your own territory.</p>}
        {workspaceId && selectedEvent?.hazard==='hurricane'&&<HurricaneAreaSelector map={map} event={selectedEvent} workspaceId={workspaceId} onSave={saveTerritory}/>}
        {workspaceId && selectedEvent?.hazard==='tornado'&&<TornadoAreaSelector map={map} event={selectedEvent} workspaceId={workspaceId} onSave={saveTerritory}/>}
        {/* Mobile has a separate drawing tool. Keep Mapbox Draw out of hail selection so it cannot consume map taps. */}
        {workspaceId && selectedEvent && selectedEvent.hazard!=='hurricane' && selectedEvent.hazard!=='tornado' && !(props.mobileCampaign && selectedEvent.hazard==='hail') && <StormTerritoryEditor workspaceId={workspaceId} key={selectedEvent.key} map={map} onSave={saveTerritory} context={{version:1,event:{key:selectedEvent.key,title:selectedEvent.title,hazard:selectedEvent.hazard,source:selectedEvent.source,sourceId:selectedEvent.sourceId,start:selectedEvent.start,end:selectedEvent.end},selectedAt:new Date().toISOString(),minimumHailMM:null,selection:'user-drawn',evidenceKind:'reports'}} />}
        </>}
        {workspaceId && territorySelection !== 'draw' && <SavedStormTerritories renderOverlay={false} map={map} workspaceId={workspaceId} revision={territoryRevision} active={savedTerritory} onSelect={setSavedTerritory} onCampaign={territory => props.onStormCampaign?.({ ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() })} />}
      </>} />
  </StormTerritoryDisplayContext.Provider></StormTerritoryDrawingContext.Provider>;
}
