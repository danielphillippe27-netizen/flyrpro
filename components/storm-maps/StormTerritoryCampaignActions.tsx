'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { bbox } from '@turf/turf';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
import type { TerritoryCampaignPart } from '@/lib/storm-maps/intelligence/campaign-partitions';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
export function StormTerritoryCampaignActions({ active, workspaceId, onBusyChange, buttonLabel = 'Create campaigns from territory' }: { active: SavedStormTerritory; workspaceId: string; onBusyChange?: (busy: boolean) => void; buttonLabel?: string }) {
  const router = useRouter();
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false), [progress, setProgress] = useState(''), [creationError, setCreationError] = useState('');
  type Batch = { territoryId: string; name: string; context: StormCampaignContext; parts: TerritoryCampaignPart[]; ids: string[]; completed: number };
  const [batch, setBatch] = useState<Batch | null>(null);
  const createCampaigns = async () => {
    if (!active || creatingRef.current) return;
    creatingRef.current = true;
    onBusyChange?.(true); setCreating(true); setCreationError('');
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
    } finally { creatingRef.current = false; onBusyChange?.(false); setCreating(false); setProgress(''); }
  };
  return <div className="space-y-2"><p className="text-[10px] text-slate-400">Up to 1,000 addresses: one campaign. Larger territories automatically split into campaigns of up to 1,000 addresses each.</p><button type="button" disabled={creating} onClick={createCampaigns} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold disabled:opacity-50">{creating ? 'Creating campaigns…' : batch?.territoryId === active.id ? 'Continue creating campaigns' : buttonLabel}</button>{progress && <p role="status" className="text-[11px] text-cyan-200">{progress}</p>}{creationError && <p role="alert" className="text-[11px] text-amber-200">{creationError}</p>}{batch?.territoryId === active.id && batch.ids.map((id, index) => <Link key={id} href={`/campaigns/${id}`} className="block text-xs text-cyan-200 underline">Open campaign {index + 1}{index >= batch.completed ? ' (setup pending)' : ''}</Link>)}</div>;
}
