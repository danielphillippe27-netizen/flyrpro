export const MAX_STORM_CAMPAIGN_HOMES = 4_000;
export const LARGE_STORM_TERRITORY_GUIDANCE = 'Use this storm territory as an overlay, then draw a smaller area to create a campaign.';
export function stormNeedsTerritoryOverlay(count: number | null | undefined): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count > MAX_STORM_CAMPAIGN_HOMES;
}
