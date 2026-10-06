export type CampaignTargetAddress = { id: string; gers_id: string | null; address: string | null };
export type ConversationTarget = { id: string; label: string; addressIds: string[]; ambiguous: boolean };

/** Input rows must already be scoped to the recording's campaign/workspace. */
export function labelConversationTargets(ids: string[], addresses: CampaignTargetAddress[]): ConversationTarget[] {
  return [...new Set(ids.map(id => id.toLowerCase()))].map(id => {
    const matches = addresses.filter(row => row.id.toLowerCase() === id || row.gers_id?.toLowerCase() === id);
    const addressIds = [...new Set(matches.map(row => row.id.toLowerCase()))];
    const labels = [...new Set(matches.map(row => row.address?.trim()).filter((label): label is string => !!label))];
    const ambiguous = addressIds.length > 1;
    const label = labels.length ? labels.slice(0, 2).join(' / ') + (labels.length > 2 ? ` + ${labels.length - 2} more` : '') : `Unresolved target ${id}`;
    return { id, label: ambiguous ? `${label} (multiple addresses)` : label, addressIds, ambiguous };
  });
}
