'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sprout } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useFarmEnabled } from '@/lib/hooks/useFarmEnabled';
import { getClientAsync } from '@/lib/supabase/client';
import { FarmService } from '@/lib/services/FarmService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { farmCampaignMarker } from '@/lib/farms/backingCampaign';

export function SessionFarmLink({ campaignId }: { campaignId?: string | null }) {
  const { currentWorkspaceId } = useWorkspace();
  const { enabled } = useFarmEnabled(currentWorkspaceId);
  const [match, setMatch] = useState<{ workspaceId: string; campaignId: string; farmId: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMatch(null);
    if (!enabled || !currentWorkspaceId || !campaignId) return;
    const workspaceId = currentWorkspaceId;
    void (async () => {
      const client = await getClientAsync();
      const { data: { user } } = await client.auth.getUser();
      if (!user || cancelled) return;
      const farms = await FarmService.fetchFarms(user.id, workspaceId);
      if (cancelled) return;
      let farm = farms.find(item => item.linked_campaign_id === campaignId);
      if (!farm && farms.length > 0) {
        // Older farms identify their backing campaign with a description marker.
        const campaign = await CampaignsService.fetchCampaign(campaignId);
        if (cancelled) return;
        farm = farms.find(item => campaign?.description?.includes(farmCampaignMarker(item.id)));
      }
      if (farm) setMatch({ workspaceId, campaignId, farmId: farm.id, name: farm.name || 'Untitled Farm' });
    })().catch(() => { /* Keep session details usable when farms cannot be loaded. */ });
    return () => { cancelled = true; };
  }, [campaignId, currentWorkspaceId, enabled]);

  if (!enabled || !match || match.workspaceId !== currentWorkspaceId || match.campaignId !== campaignId) return null;

  return (
    <div className="border-t border-border pt-4">
      <Link
        href={`/farms/${match.farmId}`}
        aria-label={`Open farm: ${match.name}`}
        className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-emerald-200/60 bg-black px-3 py-2 text-sm font-semibold text-white hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        <Sprout className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        <span className="shrink-0">Farm</span>
        <span className="truncate font-normal text-emerald-100">{match.name}</span>
      </Link>
    </div>
  );
}
