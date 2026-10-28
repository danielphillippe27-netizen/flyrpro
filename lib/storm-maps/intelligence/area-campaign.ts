/** Area campaigns deliberately have no home scan or snapshot to wait for. */
export function areaCampaignMapBundle(campaignId: string, boundary: unknown, updatedAt: string | null) {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  return {
    campaign_id: campaignId, status: 'ready', phase: 'map_ready', map_ready: true,
    campaign_mode: 'area', territory_boundary: boundary,
    asset_signature: `area:${campaignId}:${updatedAt ?? '1'}`, source_version: 'storm-area-v1',
    display_mode_hint: 'addresses', links_status: 'ready',
    addresses: empty, buildings: empty, parcels: empty, roads: empty,
    links: [], address_orphans: [], building_orphans: [], building_units: [],
    reconciliation: { status: 'not_started' }, reconciliation_report: {},
    counts: { addresses: 0, buildings: 0, parcels: 0, roads: 0, links: 0, building_units: 0 },
    layer_fetched_at: {}, built_at: updatedAt, updated_at: updatedAt, expires_at: null,
  };
}
