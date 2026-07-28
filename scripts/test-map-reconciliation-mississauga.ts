import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import {
  CampaignMapReconciliationService,
  MAP_RECONCILIATION_ALGORITHM_VERSION,
  buildLinkedNeighborhoodEvidence,
  buildingAllowsMultipleAddresses,
  isBuildingAvailableForCivicAssignment,
  neighborhoodContextForCandidate,
  scoreReconciliationCandidate,
} from '../lib/services/CampaignMapReconciliationService';
import {
  readCurrentCampaignMapBundle,
  responseFromCampaignMapBundleRow,
} from '../lib/services/CampaignMapBundlePrebuilder';

type JsonRecord = Record<string, unknown>;
type BundleFeature = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;
type Candidate = {
  addressId: string;
  addressLabel: string;
  buildingId: string;
  score: number;
  margin: number;
  distanceMeters: number;
  status: 'proposed' | 'requires_review';
  evidenceCodes: string[];
};
type OrphanDiagnostic = {
  addressId: string;
  addressLabel: string;
  candidateBuildingId: string | null;
  score: number;
  distanceMeters: number | null;
  evidenceCodes: string[];
  outcome: 'candidate' | 'below_review_threshold' | 'missing_address_feature' | 'no_building_geometry';
};
type InternalDecision = {
  action: string;
  status: string;
  address_id: string | null;
  building_id: string | null;
  secondary_building_id: string | null;
  score: number;
  runner_up_margin: number | null;
  evidence_codes: string[];
  proposed_state: JsonRecord;
};

const AUTO_LINK_SCORE = 0.92;
const AUTO_LINK_MARGIN = 0.15;
const REVIEW_SCORE = 0.70;
const DEFAULT_CAMPAIGN_IDS = [
  // Streetsville and Missauga are existing suburban campaigns used only as
  // read-only data fixtures. Override with MISSISSAUGA_CAMPAIGN_IDS.
  '14267077-5c0c-4050-ab6d-95bc9a9b9c59',
  '3c6f5184-e4d9-4ad6-8914-14ac25f09f7a',
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function featureId(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(
    properties.canonical_building_id ??
    properties.public_building_id ??
    properties.building_id ??
    properties.gers_id ??
    properties.id ??
    feature.id
  );
}

function addressId(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(properties.address_id ?? properties.id ?? feature.id);
}

function addressLabel(feature: BundleFeature): string {
  const properties = asRecord(feature.properties);
  return stringValue(
    properties.formatted ??
    properties.full_address ??
    [
      stringValue(properties.house_number),
      stringValue(properties.street_name),
    ].filter(Boolean).join(' ')
  ) ?? addressId(feature) ?? 'Unknown address';
}

function orphanAddressId(orphan: JsonRecord): string | null {
  return stringValue(orphan.address_id ?? orphan.id);
}

function buildCandidateAssignments(input: {
  addresses: BundleFeature[];
  buildings: BundleFeature[];
  links: JsonRecord[];
  addressOrphans: JsonRecord[];
  protectedAddressIds: Set<string>;
  protectedBuildingIds: Set<string>;
}): Candidate[] {
  const linkedAddressIds = new Set(input.links.flatMap((link) => {
    const id = stringValue(link.address_id ?? link.addressId);
    return id ? [id.toLowerCase()] : [];
  }));
  const linkedBuildingIds = new Set(input.links.flatMap((link) => {
    const id = stringValue(link.building_id ?? link.buildingId);
    return id ? [id.toLowerCase()] : [];
  }));
  const addressById = new Map(input.addresses.flatMap((feature) => {
    const id = addressId(feature);
    return id ? [[id.toLowerCase(), feature] as const] : [];
  }));
  const buildingById = new Map(input.buildings.flatMap((feature) => {
    const id = featureId(feature);
    return id ? [[id.toLowerCase(), feature] as const] : [];
  }));
  const neighborhoodEvidence = buildLinkedNeighborhoodEvidence({
    links: input.links,
    addressesById: addressById,
    buildingsById: buildingById,
  });
  const linkedMultiAddressBuildingIds = new Set(input.links.flatMap((link) => {
    const id = stringValue(link.building_id ?? link.buildingId);
    const unitCount = Number(link.unit_count ?? link.unitCount ?? 0);
    return id && (link.is_multi_unit === true || link.isMultiUnit === true || unitCount > 1)
      ? [id.toLowerCase()]
      : [];
  }));
  const allowsMultipleAddresses = (building: BundleFeature): boolean => {
    const id = featureId(building);
    return buildingAllowsMultipleAddresses(building) ||
      Boolean(id && linkedMultiAddressBuildingIds.has(id.toLowerCase()));
  };
  const orphanIds = new Set(input.addressOrphans.flatMap((orphan) => {
    const id = orphanAddressId(orphan);
    return id ? [id.toLowerCase()] : [];
  }));
  const graphs = input.addresses.flatMap((address) => {
    const id = addressId(address);
    if (
      !id ||
      linkedAddressIds.has(id.toLowerCase()) ||
      input.protectedAddressIds.has(id.toLowerCase()) ||
      (orphanIds.size > 0 && !orphanIds.has(id.toLowerCase()))
    ) return [];
    const ranked = input.buildings
      .flatMap((building) => {
        const idValue = featureId(building);
        if (!idValue || input.protectedBuildingIds.has(idValue.toLowerCase())) return [];
        const score = scoreReconciliationCandidate(
          address,
          building,
          neighborhoodContextForCandidate({
            address,
            building,
            linkedEvidence: neighborhoodEvidence,
          })
        );
        return score.score >= REVIEW_SCORE ? [{ building, ...score }] : [];
      })
      .sort((left, right) => right.score - left.score || left.distance - right.distance);
    return ranked.length > 0 ? [{ address, addressIdValue: id, ranked }] : [];
  });
  graphs.sort((left, right) => {
    const leftMargin = (left.ranked[0]?.score ?? 0) - (left.ranked[1]?.score ?? 0);
    const rightMargin = (right.ranked[0]?.score ?? 0) - (right.ranked[1]?.score ?? 0);
    return (
      (right.ranked[0]?.score ?? 0) - (left.ranked[0]?.score ?? 0) ||
      rightMargin - leftMargin ||
      left.addressIdValue.localeCompare(right.addressIdValue)
    );
  });

  const occupied = new Set(linkedBuildingIds);
  const assignments: Candidate[] = [];
  for (const graph of graphs) {
    const ranked = graph.ranked.filter(({ building }) => {
      const id = featureId(building);
      return Boolean(id && isBuildingAvailableForCivicAssignment(
        id,
        allowsMultipleAddresses(building),
        occupied
      ));
    });
    const best = ranked[0];
    const buildingId = best ? featureId(best.building) : null;
    if (!best || !buildingId) continue;
    const margin = best.score - (ranked[1]?.score ?? 0);
    const hardConstraintsSatisfied =
      best.evidence.includes('footprint_containment') ||
      best.evidence.includes('same_parcel');
    const status = (
      best.score >= AUTO_LINK_SCORE &&
      margin >= AUTO_LINK_MARGIN &&
      hardConstraintsSatisfied
    )
      ? 'proposed'
      : 'requires_review';
    assignments.push({
      addressId: graph.addressIdValue,
      addressLabel: addressLabel(graph.address),
      buildingId,
      score: Number(best.score.toFixed(3)),
      margin: Number(margin.toFixed(3)),
      distanceMeters: Number(best.distance.toFixed(1)),
      status,
      evidenceCodes: best.evidence,
    });
    if (!allowsMultipleAddresses(best.building)) {
      occupied.add(buildingId.toLowerCase());
    }
  }
  return assignments;
}

function buildOrphanDiagnostics(input: {
  addresses: BundleFeature[];
  buildings: BundleFeature[];
  links: JsonRecord[];
  addressOrphans: JsonRecord[];
}): OrphanDiagnostic[] {
  const addressById = new Map(input.addresses.flatMap((feature) => {
    const id = addressId(feature);
    return id ? [[id.toLowerCase(), feature] as const] : [];
  }));
  const buildingById = new Map(input.buildings.flatMap((feature) => {
    const id = featureId(feature);
    return id ? [[id.toLowerCase(), feature] as const] : [];
  }));
  const neighborhoodEvidence = buildLinkedNeighborhoodEvidence({
    links: input.links,
    addressesById: addressById,
    buildingsById: buildingById,
  });
  return input.addressOrphans.map((orphan) => {
    const id = orphanAddressId(orphan);
    const address = id ? addressById.get(id.toLowerCase()) : null;
    if (!id || !address) {
      return {
        addressId: id ?? 'unknown',
        addressLabel: stringValue(orphan.formatted ?? orphan.full_address) ?? 'Unknown address',
        candidateBuildingId: null,
        score: 0,
        distanceMeters: null,
        evidenceCodes: [],
        outcome: 'missing_address_feature' as const,
      };
    }
    const ranked = input.buildings
      .flatMap((building) => {
        const buildingId = featureId(building);
        if (!buildingId) return [];
        return [{
          buildingId,
          ...scoreReconciliationCandidate(
            address,
            building,
            neighborhoodContextForCandidate({
              address,
              building,
              linkedEvidence: neighborhoodEvidence,
            })
          ),
        }];
      })
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((left, right) => right.score - left.score || left.distance - right.distance);
    const best = ranked[0];
    if (!best) {
      return {
        addressId: id,
        addressLabel: addressLabel(address),
        candidateBuildingId: null,
        score: 0,
        distanceMeters: null,
        evidenceCodes: [],
        outcome: 'no_building_geometry' as const,
      };
    }
    return {
      addressId: id,
      addressLabel: addressLabel(address),
      candidateBuildingId: best.buildingId,
      score: Number(best.score.toFixed(3)),
      distanceMeters: Number(best.distance.toFixed(1)),
      evidenceCodes: best.evidence,
      outcome: best.score >= REVIEW_SCORE
        ? 'candidate' as const
        : 'below_review_threshold' as const,
    };
  });
}

async function loadProtectedState(
  admin: ReturnType<typeof createClient>,
  campaignId: string
): Promise<{ addressIds: Set<string>; buildingIds: Set<string> }> {
  const [addresses, links, touches] = await Promise.all([
    admin
      .from('campaign_addresses')
      .select('id, visited, match_source')
      .eq('campaign_id', campaignId),
    admin
      .from('building_address_links')
      .select('address_id, building_id, match_type')
      .eq('campaign_id', campaignId),
    admin
      .from('building_touches')
      .select('address_id, building_id')
      .eq('campaign_id', campaignId),
  ]);
  if (addresses.error) throw new Error(addresses.error.message);
  if (links.error) throw new Error(links.error.message);
  const addressIds = new Set<string>();
  const buildingIds = new Set<string>();
  for (const row of addresses.data ?? []) {
    const source = String(row.match_source ?? '').toLowerCase();
    if (row.visited === true || source.includes('manual') || source === 'field_manual_pin') {
      addressIds.add(String(row.id).toLowerCase());
    }
  }
  for (const row of links.data ?? []) {
    if (!String(row.match_type ?? '').toLowerCase().includes('manual')) continue;
    if (row.address_id) addressIds.add(String(row.address_id).toLowerCase());
    if (row.building_id) buildingIds.add(String(row.building_id).toLowerCase());
  }
  for (const row of touches.data ?? []) {
    if (row.address_id) addressIds.add(String(row.address_id).toLowerCase());
    if (row.building_id) buildingIds.add(String(row.building_id).toLowerCase());
  }
  return { addressIds, buildingIds };
}

async function testCampaign(
  admin: ReturnType<typeof createClient>,
  campaignId: string
): Promise<JsonRecord> {
  const [{ data: campaign, error: campaignError }, bundleRow] = await Promise.all([
    admin
      .from('campaigns')
      .select('id, name, bbox, provision_status, provision_phase')
      .eq('id', campaignId)
      .single(),
    readCurrentCampaignMapBundle(admin, campaignId),
  ]);
  if (campaignError) throw new Error(campaignError.message);
  if (!bundleRow) throw new Error(`Campaign ${campaignId} has no current map bundle`);
  assert.equal(campaign.provision_status, 'ready');
  assert.equal(bundleRow.links_status, 'ready');

  const bundle = responseFromCampaignMapBundleRow(bundleRow);
  const addresses = asArray<BundleFeature>(asRecord(bundle.addresses).features);
  const buildings = asArray<BundleFeature>(asRecord(bundle.buildings).features)
    .filter((feature) =>
      feature.geometry?.type === 'Polygon' ||
      feature.geometry?.type === 'MultiPolygon'
    );
  const links = asArray<JsonRecord>(bundle.links);
  const addressOrphans = asArray<JsonRecord>(bundle.address_orphans);
  const buildingOrphans = asArray<JsonRecord>(bundle.building_orphans);
  const protectedState = await loadProtectedState(admin, campaignId);
  const assignments = buildCandidateAssignments({
    addresses,
    buildings,
    links,
    addressOrphans,
    protectedAddressIds: protectedState.addressIds,
    protectedBuildingIds: protectedState.buildingIds,
  });
  const orphanDiagnostics = buildOrphanDiagnostics({
    addresses,
    buildings,
    links,
    addressOrphans,
  });
  const autoAssignments = assignments.filter((item) => item.status === 'proposed');
  const reviewAssignments = assignments.filter((item) => item.status === 'requires_review');
  for (const candidate of autoAssignments) {
    assert.ok(candidate.score >= AUTO_LINK_SCORE);
    assert.ok(candidate.margin >= AUTO_LINK_MARGIN);
    assert.ok(!protectedState.addressIds.has(candidate.addressId.toLowerCase()));
    assert.ok(!protectedState.buildingIds.has(candidate.buildingId.toLowerCase()));
  }

  const linkedBuildingIds = new Set(links.flatMap((link) => {
    const id = stringValue(link.building_id ?? link.buildingId);
    return id ? [id.toLowerCase()] : [];
  }));
  const inspector = new CampaignMapReconciliationService(admin) as unknown as {
    duplicateBuildingDecisions(input: {
      run: JsonRecord;
      buildings: BundleFeature[];
      linkedBuildingIds: Set<string>;
      protectedBuildingIds: Set<string>;
    }): InternalDecision[];
  };
  const duplicateDecisions = inspector.duplicateBuildingDecisions({
    run: {
      id: `00000000-0000-5000-8000-${campaignId.replaceAll('-', '').slice(0, 12)}`,
      campaign_id: campaignId,
      source_signature: bundleRow.asset_signature,
      algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
      mode: 'shadow',
      status: 'matching',
    },
    buildings,
    linkedBuildingIds,
    protectedBuildingIds: protectedState.buildingIds,
  });
  for (const decision of duplicateDecisions) {
    assert.equal(decision.action, 'hide_duplicate');
    assert.ok(decision.score >= 0.90);
    assert.ok(decision.evidence_codes.includes('same_parcel'));
    assert.ok(!protectedState.buildingIds.has(String(decision.building_id).toLowerCase()));
  }

  const coverageBefore = addresses.length > 0
    ? Number((links.length / addresses.length * 100).toFixed(2))
    : 100;
  const projectedLinks = autoAssignments.length + reviewAssignments.length;
  const coverageAfterReview = addresses.length > 0
    ? Number((Math.min(addresses.length, links.length + projectedLinks) / addresses.length * 100).toFixed(2))
    : 100;
  return {
    campaign_id: campaignId,
    campaign_name: campaign.name,
    bbox: campaign.bbox,
    provision_phase: campaign.provision_phase,
    source_bundle_signature: bundleRow.asset_signature,
    addresses: addresses.length,
    buildings: buildings.length,
    existing_links: links.length,
    address_orphans_before: addressOrphans.length,
    building_orphans_before: buildingOrphans.length,
    protected_addresses: protectedState.addressIds.size,
    protected_buildings: protectedState.buildingIds.size,
    high_confidence_links: autoAssignments.length,
    links_needing_review: reviewAssignments.length,
    duplicate_building_decisions: duplicateDecisions.length,
    coverage_before: coverageBefore,
    projected_coverage_after_review: coverageAfterReview,
    candidate_samples: assignments.slice(0, 8),
    orphan_diagnostics: orphanDiagnostics,
    duplicate_samples: duplicateDecisions.slice(0, 5).map((decision) => ({
      hidden_building_id: decision.building_id,
      canonical_building_id: decision.secondary_building_id,
      score: decision.score,
      evidence_codes: decision.evidence_codes,
      proposed_state: decision.proposed_state,
    })),
  };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const campaignIds = String(process.env.MISSISSAUGA_CAMPAIGN_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const targets = campaignIds.length > 0 ? campaignIds : DEFAULT_CAMPAIGN_IDS;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const results: JsonRecord[] = [];
  for (const campaignId of targets) {
    results.push(await testCampaign(admin, campaignId));
  }
  console.log(JSON.stringify({
    mode: 'read_only_shadow_preview',
    algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
    campaigns: results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
