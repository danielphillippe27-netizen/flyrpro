'use client';
import { StormTerritoryAddressCount } from './StormTerritoryAddressCount';
import { StormTerritoryOverlay } from './StormTerritoryOverlay';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { bbox } from '@turf/turf';
import type { TerritoryCampaignPart } from '@/lib/storm-maps/intelligence/campaign-partitions';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import type mapboxgl from 'mapbox-gl';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
type Props = { initiallyOpen?: boolean; renderOverlay?: boolean; map: mapboxgl.Map; workspaceId: string; revision: number; active: SavedStormTerritory | null; onSelect: (territory: SavedStormTerritory | null) => void; onCampaign: (territory: SavedStormTerritory) => void };
export function SavedStormTerritories({ map, workspaceId, revision, active, onSelect, onCampaign, renderOverlay = true, initiallyOpen = false }: Props) {
  const router = useRouter();
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false), [progress, setProgress] = useState(''), [creationError, setCreationError] = useState('');
  type Batch = { territoryId: string; name: string; context: StormCampaignContext; parts: TerritoryCampaignPart[]; ids: string[]; completed: number };
  const [batch, setBatch] = useState<Batch | null>(null);
  const createCampaigns = async () => {
    if (!active || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true); setCreationError('');
    let current = batch?.territoryId === active.id ? batch : null;
    const post = async (url: string, body: unknown) => {
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Campaign creation failed.');
      return data;
    };
    try {
      if (!current) {
        setProgress('Finding addresses and splitting into campaigns of up to 1,000…');
        const plan = await post(`/api/storm-maps/intelligence/campaign-plan?workspaceId=${encodeURIComponent(workspaceId)}`, { territoryId: active.id });
        current = { territoryId: active.id, ...plan, ids: [], completed: 0 };
        setBatch(current);
      }
      if (!current) throw new Error('Campaign plan unavailable.');
      for (let index = current.completed; index < current.parts.length; index++) {
        setProgress(`Creating campaign ${index + 1} of ${current.parts.length}…`);
        let id: string = current.ids[index];
        if (!id) {
          const part = current.parts[index];
          const campaign = await post('/api/campaigns', { name: current.parts.length === 1 ? current.name : `${current.name} · ${index + 1} of ${current.parts.length}`, type: 'flyer', address_source: 'map', workspace_id: workspaceId, storm_context: current.context, territory_boundary: part.boundary, bbox: bbox(part.boundary) });
          id = campaign.id;
          current = { ...current, ids: [...current.ids, id] }; setBatch(current);
          window.dispatchEvent(new CustomEvent('flyr-campaigns-refresh'));
        }
        await post('/api/campaigns/provision', { campaign_id: id });
        current = { ...current, completed: index + 1 }; setBatch(current);
      }
      router.push(`/campaigns/${current.ids[0]}`);
    } catch (reason) {
      setCreationError(reason instanceof Error ? reason.message : 'Campaign creation failed.');
    } finally { creatingRef.current = false; setCreating(false); setProgress(''); }
  };
  const [territories, setTerritories] = useState<SavedStormTerritory[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.territories;
    }).then(data => { if (!abort.signal.aborted) setTerritories(data); }).catch(reason => { if (!abort.signal.aborted) setError(reason.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [workspaceId, revision]);
  const select = (territory: SavedStormTerritory) => {
    onSelect(territory);
    const positions = territory.boundary.coordinates[0];
    map.fitBounds([[Math.min(...positions.map(p => p[0])),Math.min(...positions.map(p => p[1]))],[Math.max(...positions.map(p => p[0])),Math.max(...positions.map(p => p[1]))]], { padding: 100, maxZoom: 12, pitch: 0, bearing: 0, duration: 600 });
  };
  return <>{renderOverlay && <StormTerritoryOverlay map={map} territory={active} />}<details open={initiallyOpen || !!active} className="mt-4 rounded-xl border border-cyan-300/25 p-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-200">Saved storm territories</summary><div className="mt-3 space-y-2">
    {loading && <p role="status" className="text-[11px]">Loading territories…</p>}
    {error && <p role="alert" className="text-[11px] text-amber-200">{error}</p>}
    {!loading && !error && !territories.length && <p className="text-[11px] text-slate-400">Select a hail intensity zone and save its boundary here.</p>}
    {territories.map(territory => <button key={territory.id} type="button" disabled={creating} aria-pressed={active?.id === territory.id} onClick={() => select(territory)} className={`w-full rounded-lg border p-2 text-left text-xs ${active?.id === territory.id ? 'border-cyan-300' : 'border-white/15'}`}><p className="font-semibold">{territory.name}</p><p className="mt-1 text-[10px] text-slate-400">{territory.context.event.start.slice(0,10)} · {territory.context.minimumHailMM == null ? 'Storm inspection area' : `${territory.context.minimumHailMM === 0 ? '>0' : territory.context.minimumHailMM.toFixed(1)} mm${territory.context.maximumHailMM == null ? '+' : `–${territory.context.maximumHailMM.toFixed(1)} mm`}`}</p></button>)}
    {active && <div className="space-y-2 border-t border-white/10 pt-3"><StormTerritoryAddressCount workspaceId={workspaceId} boundary={active.boundary} /><p className="text-xs font-semibold">{active.name}</p><p className="text-[10px] text-slate-400">Up to 1,000 addresses: one campaign. Larger territories automatically split into campaigns of up to 1,000 addresses each.</p><button type="button" disabled={creating} onClick={createCampaigns} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold disabled:opacity-50">{creating ? 'Creating campaigns…' : batch?.territoryId === active.id ? 'Continue creating campaigns' : 'Create campaigns from territory'}</button>{progress && <p role="status" className="text-[11px] text-cyan-200">{progress}</p>}{creationError && <p role="alert" className="text-[11px] text-amber-200">{creationError}</p>}{batch?.territoryId === active.id && batch.ids.map((id, index) => <Link key={id} href={`/campaigns/${id}`} className="block text-xs text-cyan-200 underline">Open campaign {index + 1}{index >= batch.completed ? ' (setup pending)' : ''}</Link>)}<button type="button" disabled={creating} onClick={() => onCampaign(active)} className="w-full rounded-lg border border-white/20 py-2 text-xs disabled:opacity-50">Draw a campaign manually</button><button type="button" disabled={creating} onClick={() => onSelect(null)} className="text-[11px] text-cyan-200 disabled:opacity-50">Hide territory</button></div>}
  </div></details></>;
}
