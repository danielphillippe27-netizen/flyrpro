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

/** Keep the legacy farm link marker out of the notes editor. */
export function farmNotesForDisplay(value: string | null | undefined, farmId: string): string {
  const marker = farmCampaignMarker(farmId);
  return (value ?? '').split('\n').filter(line => line.trim() !== marker).join('\n').trim();
}
