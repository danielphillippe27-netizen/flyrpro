import type { CampaignV2, Farm } from '@/types/database';

export type CampaignListEntry = CampaignV2 & {
  entryKind: 'campaign' | 'farm' | 'storm';
  href: string;
  farm?: Farm;
};

export function campaignListEntries(campaigns: CampaignV2[], farms: Farm[], showFarms: boolean): CampaignListEntry[] {
  const linkedIds = new Set(farms.map(farm => farm.linked_campaign_id).filter(Boolean));
  const entries: CampaignListEntry[] = campaigns
    .filter(campaign => !linkedIds.has(campaign.id) && !/\[farm:[^\]]+\]/i.test(campaign.description ?? ''))
    .map(campaign => ({ ...campaign, entryKind: campaign.storm_context ? 'storm' : 'campaign', href: `/campaigns/${campaign.id}` }));
  if (showFarms) {
    for (const farm of farms) {
      const linked = campaigns.find(campaign => campaign.id === farm.linked_campaign_id);
      entries.push({
        ...linked,
        id: `farm:${farm.id}`, owner_id: farm.owner_id, workspace_id: farm.workspace_id,
        name: farm.name, description: farm.description ?? '', type: linked?.type ?? 'flyer',
        address_source: linked?.address_source ?? 'map', total_flyers: linked?.total_flyers ?? 0,
        scans: linked?.scans ?? 0, conversions: linked?.conversions ?? 0,
        created_at: farm.created_at, status: farm.is_active === false ? 'completed' : 'active',
        progress: farm.progress ?? 0, progress_pct: Math.round((farm.progress ?? 0) * 100),
        entryKind: 'farm', href: `/farms/${farm.id}`, farm,
      });
    }
  }
  return entries.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}
