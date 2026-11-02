import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';
import { readCurrentCampaignMapBundle, responseFromCampaignMapBundleRow } from '@/lib/services/CampaignMapBundlePrebuilder';
import { loadReconciliationMapboxRoads } from '@/lib/services/ReconciliationMapboxRoads';
import { CampaignMapReconciliationService, MAP_RECONCILIATION_ALGORITHM_VERSION, streetSegmentSuggestions, streetLinkConflictSuggestions } from '@/lib/services/CampaignMapReconciliationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Local diagnostic: evaluates real data without writing a run, decisions, or map. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  if (process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { campaignId } = await params;
  const db = createAdminClient();
  if (!await ensureCampaignAccess(db, campaignId, user.id)) return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  try {
    const row = await readCurrentCampaignMapBundle(db, campaignId);
    if (!row) return NextResponse.json({ error: 'No current map bundle' }, { status: 404 });
    const b = responseFromCampaignMapBundleRow(row) as any;
    const service = new CampaignMapReconciliationService(db) as any;
    service.heartbeatRun = async () => {};
    const protectedState = await service.loadProtectedState(campaignId);
    const addresses = b.addresses.features, buildings = b.buildings.features, links = b.links;
    const roads = b.roads.features.length ? b.roads.features : await loadReconciliationMapboxRoads(buildings);
    const streetSuggestions = streetSegmentSuggestions({ roads, addresses, buildings, links, protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds });
    const linkIds = (key: string) => new Set<string>(links.map((link: any) => link[key]?.toLowerCase()).filter(Boolean));
    const orphanIds = (rows: any[], key: string) => new Set<string>((rows ?? []).map(x => x[key]?.toLowerCase()).filter(Boolean));
    const streetConflicts = streetLinkConflictSuggestions({ roads, addresses, buildings, links, protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds });
    const started = Date.now();
    const decisions = await service.globalReverseGeocodeDecisions({ run: { id: '00000000-0000-4000-8000-000000000001', campaign_id: campaignId, source_signature: row.asset_signature, algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION, mode: 'shadow', status: 'matching' }, addresses, buildings, parcels: b.parcels.features,
      linkedAddressIds: linkIds('address_id'), linkedBuildingIds: linkIds('building_id'), orphanAddressIds: orphanIds(b.address_orphans, 'address_id'), orphanBuildingIds: orphanIds(b.building_orphans, 'building_id'), protectedAddressIds: protectedState.addressIds, protectedBuildingIds: protectedState.buildingIds, streetSuggestions, previewMaxGeocodes: 20 });
    const proposed = decisions.filter((d: any) => d.status === 'proposed');
    const knownAddresses = addresses.filter((feature: any) => !(feature.properties?.geometry_target_kind && !feature.properties?.house_number));
    const knownIds = new Set<string>(knownAddresses.map((feature: any) => String(feature.properties?.address_id ?? feature.properties?.id ?? feature.id).toLowerCase()));
    const linkedIds = linkIds('address_id');
    const newlyLinked = proposed.filter((d: any) => d.action === 'link_address' && knownIds.has(String(d.address_id).toLowerCase()) && !linkedIds.has(String(d.address_id).toLowerCase())).length;
    const before = [...linkedIds].filter(id => knownIds.has(id)).length;
    return NextResponse.json({ total: knownAddresses.length, pendingTargets: addresses.length - knownAddresses.length, before, projected: before + newlyLinked,
      streetSuggestions: streetSuggestions.length + streetConflicts.length, review: decisions.filter((d: any) => d.status === 'requires_review').length + streetConflicts.filter(s => !decisions.some((d: any) => d.address_id?.toLowerCase() === s.addressId || d.building_id?.toLowerCase() === s.buildingId)).length,
      roads: roads.length, lookups: service.temporaryReverseResults.size, elapsedMs: Date.now() - started,
      streetExamples: [...streetSuggestions, ...streetConflicts].slice(0, 5).map(suggestion => {
        const address = addresses.find((feature: any) => String(feature.properties?.address_id ?? feature.properties?.id ?? feature.id).toLowerCase() === suggestion.addressId);
        return { address: String(address?.properties?.formatted ?? 'Address'), evidence: suggestion.evidence };
      }) });
  } catch (error) {
    console.error('[ReconciliationPreview]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: 'Preview could not complete.' }, { status: 500 });
  }
}
