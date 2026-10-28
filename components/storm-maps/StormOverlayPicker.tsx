'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { bbox } from '@turf/turf';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { CloudLightning } from 'lucide-react';
import { StormCampaignHailOverlay } from './StormCampaignHailOverlay';
import { StormTerritoryOverlay } from './StormTerritoryOverlay';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';

const StormMapWorkspace = dynamic(() => import('./StormMapWorkspace').then(module => module.StormMapWorkspace), { ssr: false, loading: () => <p role="status" className="p-5">Loading storm map…</p> });

type Props = { inline?: boolean; campaignCreation?: boolean; onStormModeChange?: (active: boolean) => void; map: mapboxgl.Map | null; mapLoaded: boolean; workspaceId: string | null; onStormCampaign?: (context: StormCampaignContext) => void };
export function StormOverlayPicker({ map, mapLoaded, workspaceId, onStormCampaign, campaignCreation = false, onStormModeChange, inline = false }: Props) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocusId = useRef<string | null>(null);
  useEffect(() => { onStormModeChange?.(workspaceOpen); }, [workspaceOpen, onStormModeChange]);
  const [hailVisible,setHailVisible]=useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ workspace: string; territories: SavedStormTerritory[]; error: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const appliedLink = useRef('');
  const callback = useRef(onStormCampaign); callback.current = onStormCampaign;
  const territories = useMemo(() => result?.workspace === workspaceId ? result.territories : [], [result, workspaceId]);
  const active = territories.find(item => item.id === activeId) ?? null;
  const focusTerritory = useCallback((territory: SavedStormTerritory) => {
    if (!map) return;
    const bounds = bbox(territory.boundary);
    const container = map.getContainer();
    const padding = Math.min(80, Math.max(24, Math.min(container.clientWidth, container.clientHeight) * 0.12));
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
      padding, maxZoom: 16, pitch: 0, bearing: 0, retainPadding: false,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
    });
  }, [map]);
  useEffect(() => {
    if (!workspaceId || !mapLoaded) return;
    const abort = new AbortController();
    fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load storm territories.');
      if (!abort.signal.aborted) setResult({ workspace: workspaceId, territories: data.territories, error: '' });
    }).catch(error => { if (!abort.signal.aborted) setResult({ workspace: workspaceId, territories: [], error: error.message }); });
    return () => abort.abort();
  }, [workspaceId, mapLoaded, open, workspaceOpen]);
  useEffect(() => {
    if (!map || !mapLoaded || result?.workspace !== workspaceId) return;
    const id = new URLSearchParams(window.location.search).get('stormTerritory');
    const territory = territories.find(item => item.id === id);
    const key = `${workspaceId}:${id}`;
    if (!territory || appliedLink.current === key) return;
    appliedLink.current = key; setActiveId(territory.id);
    callback.current?.({ ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() });
    focusTerritory(territory);
  }, [map, mapLoaded, result, workspaceId, territories, focusTerritory]);
  useEffect(() => {
    const territory = territories.find(item => item.id === pendingFocusId.current);
    if (!territory || workspaceOpen) return;
    pendingFocusId.current = null;
    focusTerritory(territory);
  }, [territories, workspaceOpen, focusTerritory]);
  if (!map || !mapLoaded || !workspaceId) return null;
  return <>
    {campaignCreation && <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
      <DialogContent id="campaign-storm-workspace" className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12 text-left">
          <DialogTitle>Storms</DialogTitle>
          <DialogDescription>Choose a storm territory to use in your campaign.</DialogDescription>
        </DialogHeader>
        {workspaceOpen && <StormMapWorkspace key={workspaceId} initiallyOpenDiscovery workspaceId={workspaceId} onStormCampaign={context => {
          setActiveId(context.territoryId ?? null);
          pendingFocusId.current = context.territoryId ?? null;
          callback.current?.(context);
          setWorkspaceOpen(false);
        }} />}
      </DialogContent>
    </Dialog>}
    <StormTerritoryOverlay map={map} territory={active} />
    <StormCampaignHailOverlay map={map} workspaceId={workspaceId} territory={active} enabled={hailVisible} />
    <div className={inline ? "relative shrink-0 text-white" : "absolute left-3 md:left-[5.5rem] top-3 z-30 text-white"}>
      <button ref={triggerRef} type="button" aria-haspopup={campaignCreation ? "dialog" : undefined} aria-expanded={campaignCreation ? workspaceOpen : open} aria-controls={campaignCreation ? "campaign-storm-workspace" : "storm-overlay-picker"} onClick={() => campaignCreation ? setWorkspaceOpen(true) : setOpen(value => !value)} className="flex h-9 items-center gap-2 rounded-full border border-cyan-200/60 bg-slate-950/95 px-3 text-xs font-semibold"><CloudLightning className="h-3 w-3 text-cyan-300" />Storm</button>
      {open && <div id="storm-overlay-picker" className="mt-2 max-h-[calc(100dvh-10rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-white/15 bg-slate-950/95 p-3 shadow-xl">
        <p className="mb-2 text-xs font-semibold">Storm territory overlays</p>
        {!result || result.workspace !== workspaceId ? <p role="status" className="text-xs">Loading territories…</p> : result.error ? <p role="alert" className="text-xs text-amber-200">{result.error}</p> : !territories.length ? <p className="text-xs text-slate-400">No saved storm territories yet.</p> : <div className="max-h-60 space-y-1 overflow-y-auto">{territories.map(territory => <button key={territory.id} type="button" aria-pressed={activeId === territory.id} onClick={() => { setActiveId(territory.id); focusTerritory(territory); callback.current?.({ ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() }); setOpen(false); }} className={`block w-full rounded-lg p-2 text-left text-xs ${activeId === territory.id ? 'bg-cyan-300/20 text-cyan-200' : 'hover:bg-white/10'}`}>{territory.name}<span className="mt-1 block text-[10px] text-slate-400">{territory.context.event.start.slice(0, 10)} · {territory.context.event.hazard}</span></button>)}</div>}
        {active&&<label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={hailVisible} onChange={event=>setHailVisible(event.target.checked)} />Show hail shading</label>}
        {active && <button type="button" onClick={() => setActiveId(null)} className="mt-2 text-xs text-cyan-200">Hide storm outline</button>}
        <Link href="/storms" className="mt-3 block rounded-lg bg-red-500 px-3 py-2 text-center text-xs font-semibold">Create storm territory</Link>
      </div>}
    </div>
  </>;
}
