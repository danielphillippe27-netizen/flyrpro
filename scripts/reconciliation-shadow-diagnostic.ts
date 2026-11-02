/** Read-only diagnostic: npm env vars RECONCILIATION_CAMPAIGN_ID and .env.local required.
 * Makes at most 20 temporary Mapbox address requests, saves no decisions or map data. */
import { createClient } from '@supabase/supabase-js';
import { readCurrentCampaignMapBundle, responseFromCampaignMapBundleRow } from '../lib/services/CampaignMapBundlePrebuilder';
import { loadReconciliationMapboxRoads } from '../lib/services/ReconciliationMapboxRoads';
import { CampaignMapReconciliationService, MAP_RECONCILIATION_ALGORITHM_VERSION, streetSegmentSuggestions, streetLinkConflictSuggestions } from '../lib/services/CampaignMapReconciliationService';

async function main() {
  const id = process.env.RECONCILIATION_CAMPAIGN_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!id || !url || !key) throw new Error('Campaign ID and database configuration are required');
  process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE = 'true';
  process.env.MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN = '20';
  const db = createClient(url, key, { auth: { persistSession: false } });
  const row = await readCurrentCampaignMapBundle(db, id);
  if (!row) throw new Error('Campaign has no current map bundle');
  const b = responseFromCampaignMapBundleRow(row) as any;
  const service = new CampaignMapReconciliationService(db) as any;
  // The background method's progress heartbeat normally writes to the run table.
  // Disable it for this strictly read-only evaluation.
  service.heartbeatRun = async () => {};
  const protectedState = await service.loadProtectedState(id);
  const addresses = b.addresses.features, buildings = b.buildings.features, links = b.links;
  const roads = b.roads.features.length ? b.roads.features : await loadReconciliationMapboxRoads(buildings);
  const streetSuggestions = streetSegmentSuggestions({ roads, addresses, buildings, links,
    protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds });
  const linkIds = (key: string) => new Set<string>(links.map((link: any) => link[key]?.toLowerCase()).filter(Boolean));
  const orphanIds = (rows: any[], key: string) => new Set<string>((rows ?? []).map(x => x[key]?.toLowerCase()).filter(Boolean));
  const streetConflicts = streetLinkConflictSuggestions({ roads, addresses, buildings, links, protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds });
  const started = Date.now();
  const decisions = await service.globalReverseGeocodeDecisions({
    run: { id: '00000000-0000-4000-8000-000000000001', campaign_id: id, source_signature: row.asset_signature,
      algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION, mode: 'shadow', status: 'matching' },
    addresses, buildings, parcels: b.parcels.features, linkedAddressIds: linkIds('address_id'), linkedBuildingIds: linkIds('building_id'),
    orphanAddressIds: orphanIds(b.address_orphans, 'address_id'), orphanBuildingIds: orphanIds(b.building_orphans, 'building_id'),
    protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds, streetSuggestions,
  });
  const proposed = decisions.filter((d: any) => d.status === 'proposed');
  const newlyLinked = proposed.filter((d: any) => d.action === 'link_address').length;
  const reassigned = proposed.filter((d: any) => d.action === 'reassign_address' && !d.proposed_state.assignment_unchanged).length;
  const confirmed = proposed.filter((d: any) => d.proposed_state.assignment_unchanged).length;
  const beforeAddresses = linkIds('address_id').size;
  console.log(JSON.stringify({ addresses: addresses.length, buildings: buildings.length, roads: roads.length, parcels: b.parcels.features.length,
    linkedAddressesBefore: beforeAddresses, linkedAddressesProjected: beforeAddresses + newlyLinked,
    streetSuggestions: streetSuggestions.length + streetConflicts.length, streetConflicts: streetConflicts.length, newlyLinked, reassigned, confirmed,
    requiresReview: decisions.filter((d: any) => d.status === 'requires_review').length,
    temporaryLookups: service.temporaryReverseResults.size, matchingMs: Date.now() - started, mode: 'read-only projection' }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Diagnostic failed'); process.exitCode = 1; });
