export function farmCampaignMarker(farmId: string): string {
  return `[farm:${farmId}]`;
}

export function buildFarmCampaignDescription(
  farmId: string,
  farmDescription?: string | null
): string {
  const marker = farmCampaignMarker(farmId);
  const description = farmDescription?.trim();
  return description ? `${marker}\n${description}` : marker;
}
