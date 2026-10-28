'use client';
import { createContext, useContext, useRef, useState } from 'react';
import { useStormTerritoryAddressCount } from './useStormTerritoryAddressCount';
import { LARGE_STORM_TERRITORY_GUIDANCE, stormNeedsTerritoryOverlay } from '@/lib/storm-maps/intelligence/campaign-policy';
import { useStormMobileNavigation } from '@/lib/storm-maps/mobile-session';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { bbox } from '@turf/turf';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
import type { TerritoryCampaignPart } from '@/lib/storm-maps/intelligence/campaign-partitions';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
export const StormTerritoryDrawingContext = createContext<((territory: SavedStormTerritory) => void) | null>(null);
export function StormTerritoryCampaignActions({ active, workspaceId, onBusyChange, buttonLabel = 'Create campaigns from territory', areaOnly = false, prepareTerritory, draftBoundary, allowAreaCampaign = true, disabled=false }: { active: SavedStormTerritory | null; prepareTerritory?: () => Promise<SavedStormTerritory>; draftBoundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon; allowAreaCampaign?: boolean; disabled?:boolean; workspaceId: string; onBusyChange?: (busy: boolean) => void; buttonLabel?: string; areaOnly?: boolean }) {
  const drawInsideTerritory = useContext(StormTerritoryDrawingContext);
  const count = useStormTerritoryAddressCount(workspaceId, areaOnly ? null : active?.boundary ?? draftBoundary);
  const [largeBoundary, setLargeBoundary] = useState<string | null>(null);
  const [savedForOverlay, setSavedForOverlay] = useState(false);
  const overlayOnly = stormNeedsTerritoryOverlay(count.data?.count) || (!!largeBoundary && largeBoundary === JSON.stringify(active?.boundary ?? draftBoundary));
  const prepared = useRef<SavedStormTerritory | null>(null);
  const resolveTerritory = async () => {
    if(active)return active;
    if(prepared.current)return prepared.current;
    if(!prepareTerritory)throw Error('Select a storm area first.');
    prepared.current=await prepareTerritory();
    return prepared.current;
  };
  const router = useRouter();
  const openNativeCampaign = useStormMobileNavigation();
  const openCampaign = (id: string) => openNativeCampaign ? openNativeCampaign(id) : router.push(`/campaigns/${id}`);
  const [areaId, setAreaId] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false), [progress, setProgress] = useState(''), [creationError, setCreationError] = useState('');
  type Batch = { territoryId: string; name: string; context: StormCampaignContext; parts: TerritoryCampaignPart[]; ids: string[]; completed: number };
  const [batch, setBatch] = useState<Batch | null>(null);
  const createCampaigns = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    onBusyChange?.(true); setCreating(true); setCreationError('');
    const post = async (url: string, body: unknown) => {
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Campaign creation failed.');
      return data;
    };
    try {
      const territory=await resolveTerritory();
      let current = batch?.territoryId === territory.id ? batch : null;
      if (!current) {
        setProgress('Finding addresses and splitting into campaigns of up to 1,000…');
        const plan = await post(`/api/storm-maps/intelligence/campaign-plan?workspaceId=${encodeURIComponent(workspaceId)}`, { territoryId: territory.id });
        if (plan.territoryOnly) { setLargeBoundary(JSON.stringify(territory.boundary)); setSavedForOverlay(true); return; }
        current = { territoryId: territory.id, ...plan, ids: [], completed: 0 };
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
      openCampaign(current.ids[0]);
    } catch (reason) {
      setCreationError(reason instanceof Error ? reason.message : 'Campaign creation failed.');
    } finally { creatingRef.current = false; onBusyChange?.(false); setCreating(false); setProgress(''); }
  };
  const createStormTerritory = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setCreationError(''); onBusyChange?.(true);
    try {
      const territory = await resolveTerritory();
      setSavedForOverlay(true);
      drawInsideTerritory?.(territory);
    } catch (reason) { setCreationError(reason instanceof Error ? reason.message : 'Could not save storm territory.'); }
    finally { creatingRef.current = false; setCreating(false); onBusyChange?.(false); }
  };
  if (overlayOnly) return <div className="space-y-2">
    <button type="button" disabled={creating || disabled} onClick={createStormTerritory} className="min-h-11 w-full rounded-lg bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Saving storm territory…' : 'Create storm territory'}</button>
    <p className="text-xs text-muted-foreground">This area has over 4,000 homes. {LARGE_STORM_TERRITORY_GUIDANCE}</p>
    {savedForOverlay && <p role="status" className="text-xs">Storm territory saved. Select it in Saved storm maps to use its overlay.</p>}
    {creationError && <p role="alert" className="text-xs text-amber-800 dark:text-amber-200">{creationError}</p>}
  </div>;
  const createArea = async () => {
    if (creatingRef.current) return;
    if (areaId) { openCampaign(areaId); return; }
    creatingRef.current = true; setCreating(true); onBusyChange?.(true); setCreationError('');
    try {
      const territory=await resolveTerritory();
      const response = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: territory.name, type: 'flyer', address_source: 'map', workspace_id: workspaceId, area_only: true,
        storm_context: { ...territory.context, territoryId: territory.id, territoryRevision: territory.revision, selectedAt: new Date().toISOString() },
        territory_boundary: territory.boundary, bbox: bbox(territory.boundary),
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create the area campaign.');
      setAreaId(data.id); window.dispatchEvent(new CustomEvent('flyr-campaigns-refresh')); openCampaign(data.id);
    } catch (reason) { setCreationError(reason instanceof Error ? reason.message : 'Could not create the area campaign.'); }
    finally { creatingRef.current = false; setCreating(false); onBusyChange?.(false); }
  };
  if (areaOnly || active?.context.gustSelection?.country==='AU' || active?.context.gustSelection?.country==='NZ') return <div className="space-y-2"><button type="button" disabled={creating||disabled} onClick={createArea} className="min-h-11 w-full rounded-lg bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Creating campaign…' : areaId ? 'Open area campaign' : 'Create area campaign'}</button>{creationError && <p role="alert" className="text-xs text-amber-800 dark:text-amber-200">{creationError}</p>}</div>;
  if(prepareTerritory||active?.context.gustSelection)return <div className="space-y-2">
    <button type="button" disabled={creating||disabled} onClick={createCampaigns} className="min-h-11 w-full rounded-lg bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">{creating?'Creating campaign…':batch?'Continue creating campaign':'Create campaign'}</button>
    {allowAreaCampaign && <><button type="button" disabled={creating||disabled} onClick={createArea} className="min-h-11 w-full rounded-lg border border-border px-3 py-3 text-sm font-semibold disabled:opacity-50">{areaId?'Open area campaign':'Create area campaign'}</button>
    <p className="text-xs text-muted-foreground">Create a campaign with the addresses in this area, or keep the boundary as an area campaign.</p></>}
    {progress&&<p role="status" className="text-xs">{progress}</p>}
    {creationError&&<p role="alert" className="text-xs text-amber-800 dark:text-amber-200">{creationError}</p>}
  </div>;
  if(!active&&!prepareTerritory)return null;
  if (openNativeCampaign) return <div className="space-y-2">
    <button type="button" disabled={creating||disabled} onClick={createCampaigns} className="min-h-11 w-full rounded-lg bg-red-500 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Creating campaign…' : batch && batch.territoryId === active?.id ? 'Continue creating campaign' : 'Create campaign'}</button>
    {active?.context.gustSelection && <><button type="button" disabled={creating||disabled} onClick={createArea} className="min-h-11 w-full rounded-lg border border-border px-3 py-3 text-sm font-semibold disabled:opacity-50">{areaId ? 'Open area campaign' : 'Create area campaign'}</button><p className="text-xs text-muted-foreground">Use an area campaign to keep the selected wind boundary without loading individual homes.</p></>}
    {progress && <p role="status" className="text-xs text-foreground">{progress}</p>}
    {creationError && <p role="alert" className="text-xs text-amber-800 dark:text-amber-200">{creationError}</p>}
  </div>;
  return <div className="space-y-2"><button type="button" disabled={creating||disabled} onClick={createArea} className="min-h-11 w-full rounded-lg border border-cyan-300/50 px-3 py-2 text-sm font-semibold disabled:opacity-50">{areaId ? 'Open area campaign' : 'Create area campaign'}</button><p className="text-xs text-muted-foreground">Keep the entire selected area as one campaign without loading individual homes. You can create address campaigns from the saved territory later.</p><p className="text-[10px] text-slate-400">Up to 1,000 addresses: one campaign. Areas up to 4,000 homes split into campaigns of up to 1,000 addresses each. Larger areas use a storm territory overlay.</p><button type="button" disabled={creating||disabled} onClick={createCampaigns} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold disabled:opacity-50">{creating ? 'Creating campaigns…' : batch && batch.territoryId === active?.id ? 'Continue creating campaigns' : buttonLabel}</button>{progress && <p role="status" className="text-[11px] text-cyan-200">{progress}</p>}{creationError && <p role="alert" className="text-[11px] text-amber-200">{creationError}</p>}{batch && batch.territoryId === active?.id && batch.ids.map((id, index) => <Link key={id} href={`/campaigns/${id}`} className="block text-xs text-cyan-200 underline">Open campaign {index + 1}{index >= batch.completed ? ' (setup pending)' : ''}</Link>)}</div>;
}
