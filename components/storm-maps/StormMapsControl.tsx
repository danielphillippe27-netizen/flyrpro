'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  ChevronLeft,
  ChevronRight,
  CloudLightning,
  Gauge,
  Layers3,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  bindStormFeaturePopups,
  ensureStormDrawCasing,
  preloadAdjacentStormRaster,
  removeStormFeatures,
  removeStormMapLayers,
  removeStormPreload,
  removeStormRaster,
  upsertStormFeatures,
  upsertStormRaster,
} from '@/lib/storm-maps/map-layers';
import type { StormFeatureProperties, StormMapsManifest, StormRasterLayerId } from '@/lib/storm-maps/types';

const PREFERENCES_KEY = 'wolfgrid.stormMaps.preferences.v1';

type Preferences = {
  layerId: StormRasterLayerId;
  opacity: number;
  speed: number;
  warnings: boolean;
  outlook: boolean;
  reports: boolean;
};

type SettingsPayload = {
  addon?: { isActive?: boolean };
};

type FeaturePayload = GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties> & {
  metadata?: { generatedAt?: string; dataAsOf?: string | null; stale?: boolean; sources?: string[] };
};

const DEFAULT_PREFERENCES: Preferences = {
  layerId: 'radar',
  opacity: 0.68,
  speed: 1250,
  warnings: true,
  outlook: true,
  reports: false,
};

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}') as Partial<Preferences>;
    return {
      layerId: typeof parsed.layerId === 'string' ? parsed.layerId : DEFAULT_PREFERENCES.layerId,
      opacity: typeof parsed.opacity === 'number' ? Math.min(0.9, Math.max(0.2, parsed.opacity)) : DEFAULT_PREFERENCES.opacity,
      speed: [750, 1250, 2000].includes(parsed.speed || 0) ? parsed.speed! : DEFAULT_PREFERENCES.speed,
      warnings: parsed.warnings !== false,
      outlook: parsed.outlook !== false,
      reports: parsed.reports === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function viewportBbox(map: mapboxgl.Map) {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const west = Math.max(-180, bounds.getWest());
  const south = Math.max(18, bounds.getSouth());
  const east = Math.min(-50, bounds.getEast());
  const north = Math.min(85, bounds.getNorth());
  if (west >= east || south >= north) return null;
  return [west, south, east, north].map((value) => value.toFixed(4)).join(',');
}

function formatFrameLabel(value: string) {
  if (value === 'Now' || value.startsWith('+')) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Latest';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function StormMapsControl({
  map,
  mapLoaded,
  workspaceId,
}: {
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  workspaceId: string | null;
}) {
  const initialPreferences = useMemo(loadPreferences, []);
  const [entitled, setEntitled] = useState(false);
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<StormMapsManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [layerId, setLayerId] = useState<StormRasterLayerId>(initialPreferences.layerId);
  const [opacity, setOpacity] = useState(initialPreferences.opacity);
  const [speed, setSpeed] = useState(initialPreferences.speed);
  const [warnings, setWarnings] = useState(initialPreferences.warnings);
  const [outlook, setOutlook] = useState(initialPreferences.outlook);
  const [reports, setReports] = useState(initialPreferences.reports);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [styleRevision, setStyleRevision] = useState(0);
  const [featurePayload, setFeaturePayload] = useState<FeaturePayload | null>(null);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const layerIdRef = useRef(layerId);
  const lastRadarProviderRef = useRef<string | null>(null);
  const featureAbortRef = useRef<AbortController | null>(null);
  const manifestAbortRef = useRef<AbortController | null>(null);
  const interactionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    layerIdRef.current = layerId;
  }, [layerId]);

  useEffect(() => {
    if (!workspaceId) {
      setEntitled(false);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/storm-maps/settings?workspaceId=${encodeURIComponent(workspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<SettingsPayload> : null)
      .then((payload) => setEntitled(payload?.addon?.isActive === true))
      .catch(() => setEntitled(false));
    return () => controller.abort();
  }, [workspaceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ layerId, opacity, speed, warnings, outlook, reports }));
    } catch {
      // Preferences are optional when storage is disabled or full.
    }
  }, [layerId, opacity, outlook, reports, speed, warnings]);

  const loadManifest = useCallback(async () => {
    if (!workspaceId || !map) return;
    manifestAbortRef.current?.abort();
    const controller = new AbortController();
    manifestAbortRef.current = controller;
    setManifestLoading(true);
    setManifestError(null);
    try {
      const center = map.getCenter();
      const response = await fetch(
        `/api/storm-maps/manifest?workspaceId=${encodeURIComponent(workspaceId)}&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}`,
        { credentials: 'include', cache: 'no-store', signal: controller.signal },
      );
      const payload = (await response.json().catch(() => ({}))) as StormMapsManifest & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not load Storm Maps.');
      setManifest(payload);
      const preferred = payload.layers.find((layer) => layer.id === layerIdRef.current && layer.available);
      const fallback = payload.layers.find((layer) => layer.id === 'radar' && layer.available) || payload.layers.find((layer) => layer.available);
      if (!preferred && fallback) setLayerId(fallback.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setManifestError(error instanceof Error ? error.message : 'Could not load Storm Maps.');
    } finally {
      if (!controller.signal.aborted) setManifestLoading(false);
    }
  }, [map, workspaceId]);

  useEffect(() => {
    if (open) void loadManifest();
  }, [open, loadManifest]);

  useEffect(() => {
    if (!map) return;
    const handleStyleLoad = () => setStyleRevision((current) => current + 1);
    map.on('style.load', handleStyleLoad);
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !open) return;
    const handleMapError = (event: mapboxgl.ErrorEvent & { sourceId?: string }) => {
      if (event.sourceId === 'wolfgrid-storm-raster' || event.sourceId === 'wolfgrid-storm-preload') {
        setRasterError('This weather layer is temporarily unavailable. Radar and official alerts continue to work independently.');
      }
    };
    map.on('error', handleMapError);
    return () => { map.off('error', handleMapError); };
  }, [map, open]);

  const selectedLayer = manifest?.layers.find((layer) => layer.id === layerId) || null;
  const selectedLayerFrameCount = selectedLayer?.frames.length || 0;
  const selectedFrame = selectedLayer?.frames[Math.min(frameIndex, Math.max(0, selectedLayer.frames.length - 1))] || null;

  useEffect(() => {
    setFrameIndex(layerId === 'radar' ? Math.max(0, selectedLayerFrameCount - 1) : 0);
    setPlaying(false);
  }, [layerId, selectedLayerFrameCount]);

  useEffect(() => {
    if (!playing || !selectedLayer || selectedLayer.id !== 'radar' || selectedLayer.frames.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setFrameIndex((current) => (current + 1) % selectedLayer.frames.length);
    }, speed);
    return () => window.clearInterval(interval);
  }, [playing, selectedLayer, speed]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') setPlaying(false);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!map || !mapLoaded || !open || !selectedLayer?.available || !selectedFrame || !manifest) {
      if (map && mapLoaded) {
        removeStormRaster(map);
        removeStormPreload(map);
      }
      return;
    }
    const providerChanged = lastRadarProviderRef.current && lastRadarProviderRef.current !== selectedLayer.provider;
    if (providerChanged) removeStormRaster(map);
    lastRadarProviderRef.current = selectedLayer.provider;
    setRasterError(null);
    const time = encodeURIComponent(selectedFrame.time);
    const tileUrl = `/api/storm-maps/tiles/${selectedLayer.provider}/${selectedLayer.id}/${time}/{z}/{x}/{y}.png?token=${encodeURIComponent(manifest.tileToken)}`;
    try {
      upsertStormRaster(map, { tileUrl, provider: selectedLayer.provider, opacity });
      ensureStormDrawCasing(map);
      if (selectedLayer.id === 'radar' && selectedLayer.frames.length > 1) {
        const adjacentIndex = (frameIndex + 1) % selectedLayer.frames.length;
        const adjacentTime = encodeURIComponent(selectedLayer.frames[adjacentIndex].time);
        preloadAdjacentStormRaster(
          map,
          `/api/storm-maps/tiles/${selectedLayer.provider}/${selectedLayer.id}/${adjacentTime}/{z}/{x}/{y}.png?token=${encodeURIComponent(manifest.tileToken)}`,
          selectedLayer.provider,
        );
      } else {
        removeStormPreload(map);
      }
    } catch {
      // A style may be between teardown and load; style.load retries through styleRevision.
    }
  }, [frameIndex, manifest, map, mapLoaded, opacity, open, selectedFrame, selectedLayer, styleRevision]);

  useEffect(() => {
    if (!map || !mapLoaded || !open) return;
    const timers = [0, 250, 750].map((delay) => window.setTimeout(() => {
      try { ensureStormDrawCasing(map); } catch { /* style or Draw is still restoring */ }
    }, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [map, mapLoaded, open, styleRevision]);

  const loadFeatures = useCallback(async () => {
    if (!map || !manifest || (!warnings && !outlook && !reports)) {
      setFeaturePayload(null);
      return;
    }
    const bbox = viewportBbox(map);
    if (!bbox) {
      setFeaturePayload(null);
      return;
    }
    featureAbortRef.current?.abort();
    const controller = new AbortController();
    featureAbortRef.current = controller;
    setFeatureLoading(true);
    setFeatureError(null);
    try {
      const response = await fetch(
        `${manifest.featureEndpoint}?bbox=${encodeURIComponent(bbox)}&alerts=${warnings}&outlook=${outlook}&reports=${reports}&token=${encodeURIComponent(manifest.tileToken)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error('Weather alerts are temporarily unavailable.');
      setFeaturePayload((await response.json()) as FeaturePayload);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFeaturePayload(null);
        setFeatureError(error instanceof Error ? error.message : 'Weather features are temporarily unavailable.');
      }
    } finally {
      if (!controller.signal.aborted) setFeatureLoading(false);
    }
  }, [manifest, map, outlook, reports, warnings]);

  useEffect(() => {
    if (!open || !map || !manifest) return;
    void loadFeatures();
    let timeoutId: number | undefined;
    const handleMoveEnd = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void loadFeatures();
        void loadManifest();
      }, 450);
    };
    map.on('moveend', handleMoveEnd);
    return () => {
      window.clearTimeout(timeoutId);
      map.off('moveend', handleMoveEnd);
      featureAbortRef.current?.abort();
    };
  }, [loadFeatures, loadManifest, manifest, map, open]);

  useEffect(() => {
    if (!map || !mapLoaded || !open || !featurePayload || (!warnings && !outlook && !reports)) {
      if (map && mapLoaded) removeStormFeatures(map);
      return;
    }
    try {
      interactionCleanupRef.current?.();
      upsertStormFeatures(map, featurePayload);
      interactionCleanupRef.current = bindStormFeaturePopups(map);
    } catch {
      // style.load will retry.
    }
    return () => {
      interactionCleanupRef.current?.();
      interactionCleanupRef.current = null;
    };
  }, [featurePayload, map, mapLoaded, open, outlook, reports, styleRevision, warnings]);

  useEffect(() => {
    if (!map || open) return;
    interactionCleanupRef.current?.();
    removeStormMapLayers(map);
  }, [map, open]);

  useEffect(() => () => {
    manifestAbortRef.current?.abort();
    featureAbortRef.current?.abort();
    interactionCleanupRef.current?.();
    if (map) {
      try { removeStormMapLayers(map); } catch { /* map already removed */ }
    }
  }, [map]);

  const groupedLayers = useMemo(() => ({
    Observed: manifest?.layers.filter((layer) => layer.group === 'Observed') || [],
    Severe: manifest?.layers.filter((layer) => layer.group === 'Severe') || [],
    Forecast: manifest?.layers.filter((layer) => layer.group === 'Forecast') || [],
  }), [manifest]);

  if (!entitled || !mapLoaded || !map) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="absolute left-5 top-5 z-30 flex h-11 items-center gap-2 rounded-full border border-cyan-200/80 bg-slate-950/90 px-4 text-sm font-semibold text-white shadow-2xl shadow-cyan-950/20 backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        aria-expanded={open}
        aria-controls="storm-maps-panel"
      >
        <CloudLightning className="h-5 w-5 text-cyan-300" />
        Storm Maps
        <span className="rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 px-2 py-0.5 text-[9px] font-bold tracking-[0.16em] text-slate-950">BETA</span>
      </button>

      {open ? (
        <section
          id="storm-maps-panel"
          aria-label="Storm Maps Beta controls"
          className="absolute bottom-3 left-3 right-3 z-30 max-h-[min(76vh,44rem)] overflow-y-auto rounded-3xl border border-white/20 bg-slate-950/92 p-4 text-white shadow-2xl shadow-slate-950/40 backdrop-blur-2xl sm:bottom-auto sm:left-5 sm:right-auto sm:top-20 sm:w-[24rem]"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CloudLightning className="h-5 w-5 text-cyan-300" />
                <h2 className="font-semibold">Storm Maps</h2>
                <Badge className="border-0 bg-gradient-to-r from-cyan-400 to-violet-500 text-[9px] tracking-widest text-slate-950">BETA</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">Radar · hail intelligence · official risk</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Close Storm Maps">
              <X className="h-4 w-4" />
            </button>
          </div>

          {manifestLoading && !manifest ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-8 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-cyan-300" /> Loading weather layers…
            </div>
          ) : manifestError ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              <p>{manifestError}</p>
              <Button size="sm" variant="outline" onClick={() => void loadManifest()} className="mt-3 border-white/20 bg-transparent text-white hover:bg-white/10">
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : manifest && selectedLayer ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="storm-layer-select" className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <Layers3 className="h-3.5 w-3.5" /> Weather layer
                </label>
                <select
                  id="storm-layer-select"
                  value={layerId}
                  onChange={(event) => setLayerId(event.target.value as StormRasterLayerId)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-sm text-white outline-none focus:border-cyan-400"
                >
                  {(['Observed', 'Severe', 'Forecast'] as const).map((group) => (
                    <optgroup key={group} label={group} className="bg-slate-900">
                      {groupedLayers[group].map((layer) => (
                        <option key={layer.id} value={layer.id} disabled={!layer.available} className="bg-slate-900">
                          {layer.label}{layer.premium ? ' · PREMIUM' : ''}{layer.available ? '' : ' · unavailable'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedLayer.premium ? (
                    <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] text-white shadow-lg shadow-fuchsia-950/30">PREMIUM DATA</span>
                  ) : null}
                  {selectedLayer.coverageLabel ? <span className="text-[10px] text-slate-500">{selectedLayer.coverageLabel}</span> : null}
                </div>
                <p className="text-xs leading-relaxed text-slate-400">{selectedLayer.description}</p>
              </div>

              {selectedLayer.id.startsWith('hail') ? (
                <div className="relative overflow-hidden rounded-2xl border border-violet-300/20 bg-gradient-to-br from-cyan-400/10 via-violet-500/15 to-fuchsia-500/10 p-3 shadow-inner shadow-violet-400/5">
                  <div className="absolute -right-7 -top-9 h-24 w-24 rounded-full bg-fuchsia-400/20 blur-2xl" />
                  <div className="relative flex items-start gap-3">
                    <span className="rounded-xl bg-white/10 p-2 text-fuchsia-200"><Sparkles className="h-4 w-4" /></span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-200">Hail intelligence</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">Layer forecast plus ECCC polygons with predicted hail size, gusts, confidence, and severe-risk level where issued.</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {!selectedLayer.available ? (
                <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-xs text-amber-100">
                  {selectedLayer.unavailableReason || 'This provider layer is temporarily unavailable.'}
                </div>
              ) : null}

              {rasterError ? (
                <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 p-3 text-xs text-amber-100">{rasterError}</div>
              ) : null}

              {selectedLayer.frames.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-400">Timeline</p>
                      <p className="text-sm font-semibold text-white">{formatFrameLabel(selectedFrame?.label || '')}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setFrameIndex((current) => (current - 1 + selectedLayer.frames.length) % selectedLayer.frames.length)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Previous weather frame">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      {selectedLayer.id === 'radar' ? (
                        <button type="button" onClick={() => setPlaying((current) => !current)} className="rounded-full bg-cyan-400 p-2 text-slate-950 transition hover:bg-cyan-300" aria-label={playing ? 'Pause radar animation' : 'Play radar animation'}>
                          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setFrameIndex((current) => (current + 1) % selectedLayer.frames.length)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Next weather frame">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <Slider
                    min={0}
                    max={Math.max(0, selectedLayer.frames.length - 1)}
                    step={1}
                    value={[frameIndex]}
                    onValueChange={(value) => setFrameIndex(value[0] || 0)}
                    aria-label="Weather timeline"
                  />
                  {selectedLayer.id === 'radar' ? (
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>Animation speed</span>
                      <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white">
                        <option value={2000}>Slow</option>
                        <option value={1250}>Normal</option>
                        <option value={750}>Fast</option>
                      </select>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4 text-amber-300" /> Official alerts</span>
                  <Switch checked={warnings} onCheckedChange={setWarnings} aria-label="Show official weather alerts" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Sparkles className="h-4 w-4 shrink-0 text-fuchsia-300" />
                    <span className="min-w-0">
                      <span className="block">Canadian Severe Storm Outlook</span>
                      <span className="block text-[10px] leading-tight text-slate-500">ECCC experimental · hail, gusts & risk</span>
                    </span>
                  </span>
                  <Switch checked={outlook} onCheckedChange={setOutlook} aria-label="Show Canadian severe storm outlook" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm"><Gauge className="h-4 w-4 text-rose-300" /> Recent storm reports <span className="text-[10px] text-slate-500">U.S.</span></span>
                  <Switch checked={reports} onCheckedChange={setReports} aria-label="Show recent U.S. storm reports" />
                </div>
                <div className="space-y-2 border-t border-white/10 pt-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Overlay opacity</span><span>{Math.round(opacity * 100)}%</span>
                  </div>
                  <Slider min={20} max={90} step={5} value={[opacity * 100]} onValueChange={(value) => setOpacity((value[0] || 65) / 100)} aria-label="Weather overlay opacity" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-400/10 to-violet-500/10 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">Legend · {selectedLayer.unit}</span>
                  <span className="text-slate-500">{selectedLayer.provider.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {selectedLayer.legend.map((stop) => (
                    <div key={`${stop.value}-${stop.label}`} className="flex items-center gap-2 text-[11px] text-slate-300">
                      <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: stop.color }} /> {stop.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-slate-500">
                <p className={featureError ? 'text-amber-200/90' : ''}>
                  {featureLoading
                    ? 'Refreshing official weather features…'
                    : featureError || `${featurePayload?.features.length || 0} alerts, outlooks, and reports in view${featurePayload?.metadata?.stale ? ` · provider data may be stale${featurePayload.metadata.dataAsOf ? ` (as of ${new Date(featurePayload.metadata.dataAsOf).toLocaleTimeString()})` : ''}` : ''}.`}
                </p>
                <p>Layer timestamp: {formatFrameLabel(selectedFrame?.label || '')} · Manifest refreshed {new Date(manifest.generatedAt).toLocaleTimeString()}.</p>
                {featurePayload?.metadata?.sources?.length ? <p>Feature sources: {featurePayload.metadata.sources.join(' · ')}</p> : null}
                <p>
                  Data: {manifest.attribution.map((source, index) => (
                    <span key={source.label}>{index ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer" className="text-slate-400 underline-offset-2 hover:underline">{source.label}</a></span>
                  ))}
                </p>
                <p className="rounded-lg border border-amber-300/15 bg-amber-300/5 px-2 py-1.5 text-amber-100/80">{manifest.disclaimer}</p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
