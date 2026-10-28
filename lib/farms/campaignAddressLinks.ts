/** Match imported farm homes to campaign addresses without changing farm IDs or history. */
type FarmHome = { id: string; campaign_address_id: string | null; gers_id: string | null; formatted: string };
type CampaignHome = { campaign_address_id: string | null; gers_id: string | null; formatted: string };
const key = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

export function planFarmCampaignAddressLinks(farms: FarmHome[], campaigns: CampaignHome[]) {
  const farmByAddress = new Map<string, FarmHome[]>();
  const campaignByAddress = new Map<string, CampaignHome[]>();
  for (const home of farms) {
    const address = key(home.formatted);
    if (address) farmByAddress.set(address, [...(farmByAddress.get(address) ?? []), home]);
  }
  for (const home of campaigns) {
    const address = key(home.formatted);
    if (address && home.campaign_address_id) campaignByAddress.set(address, [...(campaignByAddress.get(address) ?? []), home]);
  }
  const alreadyLinked = new Set(farms.flatMap(home => home.campaign_address_id ? [home.campaign_address_id] : []));
  const links: Array<{ farmId: string; campaignAddressId: string }> = [];
  for (const [address, farmMatches] of farmByAddress) {
    const campaignMatches = campaignByAddress.get(address) ?? [];
    if (farmMatches.length !== 1 || campaignMatches.length !== 1) continue;
    const farm = farmMatches[0], campaign = campaignMatches[0];
    const campaignId = campaign.campaign_address_id!;
    if (farm.campaign_address_id || alreadyLinked.has(campaignId)) continue;
    // Conflicting external identities indicate a different home; do not guess.
    if (farm.gers_id && campaign.gers_id && key(farm.gers_id) !== key(campaign.gers_id)) continue;
    links.push({ farmId: farm.id, campaignAddressId: campaignId });
  }
  return links;
}
