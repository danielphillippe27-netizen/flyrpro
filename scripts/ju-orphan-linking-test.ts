import { createHash, randomUUID } from 'node:crypto';
import { createAdminClient } from '../lib/supabase/server';
import {
  CampaignMapReconciliationService,
} from '../lib/services/CampaignMapReconciliationService';
import { uuidV5 } from '../lib/services/TownhouseUnitIdentity';

const SOURCE_CAMPAIGN_ID = '24cb2e62-4e03-4642-a662-7456b111ddfe';
const TARGET_NAME = 'JU — Optimized';
const EXPECTED = {
  addresses: 922,
  buildings: 298,
  links: 387,
  addressOrphans: 535,
  buildingOrphans: 178,
  exactLinks: 11,
};

type JsonRecord = Record<string, unknown>;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function remapDeep(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapDeep(item, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, child]) => [key, remapDeep(child, ids)])
    );
  }
  return value;
}

function bundleArrayLength(value: unknown, featureCollection = false): number {
  if (featureCollection) {
    const features = (value as { features?: unknown[] } | null)?.features;
    return Array.isArray(features) ? features.length : 0;
  }
  return Array.isArray(value) ? value.length : 0;
}

async function insertChunks(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  rows: JsonRecord[]
): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const result = await supabase.from(table).insert(rows.slice(index, index + 200));
    if (result.error) throw new Error(`Failed to clone ${table}: ${result.error.message}`);
  }
}

async function currentBundle(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<JsonRecord> {
  const result = await supabase
    .from('campaign_map_bundles')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_current', true)
    .single();
  if (result.error) throw new Error(`Failed to read map bundle: ${result.error.message}`);
  return result.data as JsonRecord;
}

async function loadCounts(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<JsonRecord> {
  const [addresses, links, addressOrphans, bundle] = await Promise.all([
    supabase.from('campaign_addresses').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
    supabase.from('building_address_links').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
    supabase.from('address_orphans').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
    currentBundle(supabase, campaignId),
  ]);
  for (const result of [addresses, links, addressOrphans]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    addresses: addresses.count ?? 0,
    buildings: bundleArrayLength(bundle.buildings_geojson, true),
    links: links.count ?? 0,
    address_orphans: addressOrphans.count ?? 0,
    bundle_address_orphans: bundleArrayLength(bundle.address_orphans),
    building_orphans: bundleArrayLength(bundle.building_orphans),
    asset_signature: bundle.asset_signature,
  };
}

function assertCounts(label: string, counts: JsonRecord, expected: JsonRecord): void {
  for (const [key, value] of Object.entries(expected)) {
    if (counts[key] !== value) {
      throw new Error(`${label} ${key}: expected ${value}, received ${String(counts[key])}`);
    }
  }
}

async function processShadowRun(
  service: CampaignMapReconciliationService,
  campaignId: string
): Promise<JsonRecord> {
  const run = await service.enqueue(campaignId);
  if (!run) throw new Error('Reconciliation was not queued');
  await service.processRun(run);
  return run as unknown as JsonRecord;
}

async function exactLinkDecisions(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string
): Promise<JsonRecord[]> {
  const result = await supabase
    .from('map_reconciliation_decisions')
    .select('*')
    .eq('run_id', runId)
    .eq('action', 'link_address')
    .eq('status', 'proposed')
    .gte('score', 0.92)
    .gte('runner_up_margin', 0.15)
    .order('score', { ascending: false });
  if (result.error) throw new Error(`Failed to read decisions: ${result.error.message}`);
  return (result.data as JsonRecord[]).filter((decision) => {
    const evidence = Array.isArray(decision.evidence_codes)
      ? decision.evidence_codes.map(String)
      : [];
    const orphanPair = evidence.includes('orphan_address') && evidence.includes('orphan_building');
    const hardEvidence =
      evidence.includes('exact_orphan_address_identity') ||
      evidence.includes('footprint_containment') ||
      evidence.includes('same_parcel');
    return orphanPair && hardEvidence;
  });
}

async function applyLinkOnly(
  service: CampaignMapReconciliationService,
  decisions: JsonRecord[],
  reviewerId: string
): Promise<void> {
  for (const decision of decisions) {
    await service.reviewDecision(
      String(decision.id),
      reviewerId,
      'approve',
      'JU orphan-to-orphan link-only comparison; preserve source coordinates',
      false,
      { preserveSourceCoordinates: true }
    );
  }
}

async function rebuildFrozenBundle(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  frozenBundle: JsonRecord,
  reconciliationRunId: string,
  report: JsonRecord
): Promise<void> {
  const [addressResult, linkResult, orphanResult] = await Promise.all([
    supabase
      .from('campaign_addresses')
      .select('id,formatted,building_id,building_gers_id,match_source,confidence')
      .eq('campaign_id', campaignId),
    supabase
      .from('building_address_links')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('link_state', 'active'),
    supabase
      .from('address_orphans')
      .select('*')
      .eq('campaign_id', campaignId),
  ]);
  for (const result of [addressResult, linkResult, orphanResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const addresses = structuredClone(frozenBundle.addresses_geojson) as {
    type: string;
    features: Array<{ properties?: JsonRecord }>;
  };
  const buildings = structuredClone(frozenBundle.buildings_geojson) as {
    type: string;
    features: Array<{ properties?: JsonRecord }>;
  };
  const links = (linkResult.data ?? []) as JsonRecord[];
  const addressRows = new Map(
    (addressResult.data ?? []).map((row) => [String(row.id), row])
  );
  const linksByAddress = new Map(
    links.map((link) => [String(link.address_id), link])
  );
  const linksByBuilding = new Map<string, JsonRecord[]>();
  for (const link of links) {
    const buildingId = String(link.building_id);
    linksByBuilding.set(buildingId, [...(linksByBuilding.get(buildingId) ?? []), link]);
  }

  for (const feature of addresses.features ?? []) {
    const properties = feature.properties ?? {};
    const addressId = String(properties.address_id ?? properties.id ?? '');
    const link = linksByAddress.get(addressId);
    const row = addressRows.get(addressId);
    if (!link || !row) continue;
    feature.properties = {
      ...properties,
      building_id: link.building_id,
      building_gers_id: link.building_id,
      match_source: row.match_source,
      confidence: row.confidence,
      is_linked: true,
    };
  }

  for (const feature of buildings.features ?? []) {
    const properties = feature.properties ?? {};
    const buildingId = String(
      properties.building_id ?? properties.gers_id ?? properties.id ?? ''
    );
    const buildingLinks = linksByBuilding.get(buildingId) ?? [];
    const addressIds = buildingLinks.map((link) => String(link.address_id));
    const primaryAddress = addressRows.get(addressIds[0]);
    feature.properties = {
      ...properties,
      is_linked: addressIds.length > 0,
      address_ids: addressIds,
      linked_address_ids: addressIds,
      address_count: addressIds.length,
      linked_address_count: addressIds.length,
      primary_address_id: addressIds[0] ?? null,
      primary_display_address: primaryAddress?.formatted ?? null,
    };
  }

  const linkedBuildingIds = new Set(links.map((link) => String(link.building_id)));
  const buildingOrphans = (structuredClone(frozenBundle.building_orphans) as JsonRecord[])
    .filter((orphan) => {
      const buildingId = String(orphan.building_id ?? orphan.buildingId ?? '');
      return !linkedBuildingIds.has(buildingId);
    });
  const addressOrphans = (orphanResult.data ?? []) as JsonRecord[];
  const counts = {
    ...frozenBundle.counts as JsonRecord,
    addresses: addresses.features.length,
    buildings: buildings.features.length,
    links: links.length,
    address_orphans: addressOrphans.length,
    building_orphans: buildingOrphans.length,
  };
  const signature = hash({
    campaignId,
    frozenSignature: frozenBundle.asset_signature,
    runId: reconciliationRunId,
    links: links
      .map((link) => `${String(link.address_id)}:${String(link.building_id)}`)
      .sort(),
    addressOrphans: addressOrphans.length,
    buildingOrphans: buildingOrphans.length,
  });
  const sourceVersion = hash({ campaignId, signature });
  counts.asset_signature = signature;
  counts.source_version = sourceVersion;
  const builtAt = new Date().toISOString();
  const upsert = await supabase.rpc('rpc_upsert_campaign_map_bundle', {
    p_campaign_id: campaignId,
    p_asset_signature: signature,
    p_source_version: sourceVersion,
    p_buildings_geojson: buildings,
    p_addresses_geojson: addresses,
    p_parcels_geojson: frozenBundle.parcels_geojson,
    p_roads_geojson: frozenBundle.roads_geojson,
    p_links: links,
    p_address_orphans: addressOrphans,
    p_building_orphans: buildingOrphans,
    p_display_mode_hint: frozenBundle.display_mode_hint,
    p_counts: counts,
    p_layer_fetched_at: frozenBundle.layer_fetched_at,
    p_links_status: 'ready',
    p_built_at: builtAt,
    p_expires_at: frozenBundle.expires_at ?? builtAt,
  });
  if (upsert.error) throw new Error(`Failed to rebuild frozen bundle: ${upsert.error.message}`);
  const metadata = await supabase
    .from('campaign_map_bundles')
    .update({
      reconciliation: {
        status: 'completed',
        run_id: reconciliationRunId,
        coordinate_policy: 'preserve_source',
      },
      reconciliation_report: report,
    })
    .eq('campaign_id', campaignId)
    .eq('asset_signature', signature);
  if (metadata.error) throw new Error(`Failed to store reconciliation metadata: ${metadata.error.message}`);
}

async function main(): Promise<void> {
  const supabase = createAdminClient();
  const sourceCampaign = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', SOURCE_CAMPAIGN_ID)
    .single();
  if (sourceCampaign.error) throw new Error(sourceCampaign.error.message);

  const duplicate = await supabase
    .from('campaigns')
    .select('id')
    .eq('workspace_id', sourceCampaign.data.workspace_id)
    .eq('name', TARGET_NAME)
    .maybeSingle();
  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data) {
    throw new Error(`${TARGET_NAME} already exists as ${duplicate.data.id}`);
  }

  const sourceBundle = await currentBundle(supabase, SOURCE_CAMPAIGN_ID);
  const sourceCounts = await loadCounts(supabase, SOURCE_CAMPAIGN_ID);
  assertCounts('source', sourceCounts, {
    addresses: EXPECTED.addresses,
    buildings: EXPECTED.buildings,
    links: EXPECTED.links,
    address_orphans: EXPECTED.addressOrphans,
    bundle_address_orphans: EXPECTED.addressOrphans,
    building_orphans: EXPECTED.buildingOrphans,
  });
  const frozenSourceSignature = String(sourceBundle.asset_signature);

  const [addresses, links, addressOrphans] = await Promise.all([
    supabase.from('campaign_addresses').select('*').eq('campaign_id', SOURCE_CAMPAIGN_ID),
    supabase.from('building_address_links').select('*').eq('campaign_id', SOURCE_CAMPAIGN_ID),
    supabase.from('address_orphans').select('*').eq('campaign_id', SOURCE_CAMPAIGN_ID),
  ]);
  for (const result of [addresses, links, addressOrphans]) {
    if (result.error) throw new Error(result.error.message);
  }

  const targetCampaignId = randomUUID();
  const idMap = new Map<string, string>();
  for (const row of addresses.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:cloned-address:${row.id}`));
  }
  for (const row of links.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:cloned-link:${row.id}`));
  }
  for (const row of addressOrphans.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:cloned-orphan:${row.id}`));
  }

  const now = new Date().toISOString();
  const campaignFields = { ...sourceCampaign.data } as JsonRecord;
  delete campaignFields.id;
  delete campaignFields.created_at;
  delete campaignFields.updated_at;
  const campaignInsert = await supabase.from('campaigns').insert({
    ...campaignFields,
    id: targetCampaignId,
    name: TARGET_NAME,
    title: TARGET_NAME,
    description: `Frozen optimization comparison of ${SOURCE_CAMPAIGN_ID} at ${frozenSourceSignature}`,
    created_at: now,
    updated_at: now,
  });
  if (campaignInsert.error) throw new Error(`Failed to create optimized campaign: ${campaignInsert.error.message}`);

  await insertChunks(supabase, 'campaign_addresses', (addresses.data ?? []).map((row) => {
    const clone = {
      ...remapDeep(row, idMap) as JsonRecord,
      campaign_id: targetCampaignId,
    };
    delete clone.seq;
    return clone;
  }));
  await insertChunks(supabase, 'building_address_links', (links.data ?? []).map((row) => ({
    ...remapDeep(row, idMap) as JsonRecord,
    campaign_id: targetCampaignId,
    reconciliation_decision_id: null,
  })));
  await insertChunks(supabase, 'address_orphans', (addressOrphans.data ?? []).map((row) => ({
    ...remapDeep(row, idMap) as JsonRecord,
    campaign_id: targetCampaignId,
  })));

  const bundleFields = { ...sourceBundle };
  delete bundleFields.id;
  delete bundleFields.campaign_id;
  delete bundleFields.asset_signature;
  delete bundleFields.source_version;
  delete bundleFields.created_at;
  delete bundleFields.updated_at;
  const cloneSignature = hash({
    targetCampaignId,
    frozenSourceSignature,
    kind: 'ju-orphan-linking-test-v1',
  });
  const frozenCloneBundle = {
    ...remapDeep(bundleFields, idMap) as JsonRecord,
    asset_signature: cloneSignature,
    source_version: hash({ targetCampaignId, frozenSourceSignature }),
    counts: {
      ...remapDeep(bundleFields.counts, idMap) as JsonRecord,
      asset_signature: cloneSignature,
      source_version: hash({ targetCampaignId, frozenSourceSignature }),
    },
  };
  const bundleInsert = await supabase.from('campaign_map_bundles').insert({
    ...frozenCloneBundle,
    id: uuidV5(`${targetCampaignId}:frozen-map-bundle`),
    campaign_id: targetCampaignId,
    is_current: true,
    reconciliation: { status: 'not_started' },
    reconciliation_report: {},
    created_at: now,
    updated_at: now,
  });
  if (bundleInsert.error) throw new Error(`Failed to clone map bundle: ${bundleInsert.error.message}`);

  const clonedBaseline = await loadCounts(supabase, targetCampaignId);
  assertCounts('cloned baseline', clonedBaseline, {
    addresses: EXPECTED.addresses,
    buildings: EXPECTED.buildings,
    links: EXPECTED.links,
    address_orphans: EXPECTED.addressOrphans,
    bundle_address_orphans: EXPECTED.addressOrphans,
    building_orphans: EXPECTED.buildingOrphans,
  });

  const service = new CampaignMapReconciliationService(supabase);
  const firstRun = await processShadowRun(service, targetCampaignId);
  const firstDecisions = await exactLinkDecisions(supabase, String(firstRun.id));
  if (firstDecisions.length !== EXPECTED.exactLinks) {
    throw new Error(`Expected ${EXPECTED.exactLinks} exact links, found ${firstDecisions.length}`);
  }

  const targetAddressIds = firstDecisions.map((decision) => String(decision.address_id));
  const beforeCoordinates = await supabase
    .from('campaign_addresses')
    .select('id,geom,coordinate')
    .eq('campaign_id', targetCampaignId)
    .in('id', targetAddressIds)
    .order('id');
  if (beforeCoordinates.error) throw new Error(beforeCoordinates.error.message);
  const coordinateHash = hash(beforeCoordinates.data);

  await applyLinkOnly(
    service,
    firstDecisions,
    String(sourceCampaign.data.owner_id)
  );
  await rebuildFrozenBundle(
    supabase,
    targetCampaignId,
    frozenCloneBundle,
    String(firstRun.id),
    { exact_orphan_links: EXPECTED.exactLinks, source_coordinates_preserved: true }
  );
  const appliedCounts = await loadCounts(supabase, targetCampaignId);
  assertCounts('applied', appliedCounts, {
    addresses: EXPECTED.addresses,
    buildings: EXPECTED.buildings,
    links: EXPECTED.links + EXPECTED.exactLinks,
    address_orphans: EXPECTED.addressOrphans - EXPECTED.exactLinks,
    bundle_address_orphans: EXPECTED.addressOrphans - EXPECTED.exactLinks,
    building_orphans: EXPECTED.buildingOrphans - EXPECTED.exactLinks,
  });

  const afterCoordinates = await supabase
    .from('campaign_addresses')
    .select('id,geom,coordinate')
    .eq('campaign_id', targetCampaignId)
    .in('id', targetAddressIds)
    .order('id');
  if (afterCoordinates.error) throw new Error(afterCoordinates.error.message);
  if (hash(afterCoordinates.data) !== coordinateHash) {
    throw new Error('Source coordinates changed during link-only application');
  }

  let rolledBack = 0;
  for (const decision of [...firstDecisions].reverse()) {
    const result = await service.rollbackDecision(
      String(decision.id),
      String(sourceCampaign.data.owner_id),
      'JU rollback verification before final reapplication',
      false
    );
    if (result.status === 'rolled_back') rolledBack += 1;
  }
  if (rolledBack !== EXPECTED.exactLinks) {
    throw new Error(`Rollback restored ${rolledBack} decisions`);
  }
  await supabase
    .from('map_reconciliation_runs')
    .update({ status: 'superseded', phase: 'rolled_back' })
    .eq('id', String(firstRun.id));
  await rebuildFrozenBundle(
    supabase,
    targetCampaignId,
    frozenCloneBundle,
    String(firstRun.id),
    { exact_orphan_links: 0, rollback_verified: true }
  );
  const rolledBackCounts = await loadCounts(supabase, targetCampaignId);
  assertCounts('rolled back', rolledBackCounts, {
    links: EXPECTED.links,
    address_orphans: EXPECTED.addressOrphans,
    bundle_address_orphans: EXPECTED.addressOrphans,
    building_orphans: EXPECTED.buildingOrphans,
  });

  const secondRun = await processShadowRun(service, targetCampaignId);
  const finalDecisions = await exactLinkDecisions(supabase, String(secondRun.id));
  if (finalDecisions.length !== EXPECTED.exactLinks) {
    throw new Error(`Expected ${EXPECTED.exactLinks} final exact links, found ${finalDecisions.length}`);
  }
  await applyLinkOnly(
    service,
    finalDecisions,
    String(sourceCampaign.data.owner_id)
  );
  await rebuildFrozenBundle(
    supabase,
    targetCampaignId,
    frozenCloneBundle,
    String(secondRun.id),
    {
      exact_orphan_links: EXPECTED.exactLinks,
      source_coordinates_preserved: true,
      rollback_verified: true,
    }
  );

  const finalCounts = await loadCounts(supabase, targetCampaignId);
  assertCounts('final', finalCounts, {
    addresses: EXPECTED.addresses,
    buildings: EXPECTED.buildings,
    links: EXPECTED.links + EXPECTED.exactLinks,
    address_orphans: EXPECTED.addressOrphans - EXPECTED.exactLinks,
    bundle_address_orphans: EXPECTED.addressOrphans - EXPECTED.exactLinks,
    building_orphans: EXPECTED.buildingOrphans - EXPECTED.exactLinks,
  });
  const sourceAfter = await loadCounts(supabase, SOURCE_CAMPAIGN_ID);
  assertCounts('source after', sourceAfter, {
    addresses: EXPECTED.addresses,
    buildings: EXPECTED.buildings,
    links: EXPECTED.links,
    address_orphans: EXPECTED.addressOrphans,
    bundle_address_orphans: EXPECTED.addressOrphans,
    building_orphans: EXPECTED.buildingOrphans,
    asset_signature: frozenSourceSignature,
  });

  const finalCoordinates = await supabase
    .from('campaign_addresses')
    .select('id,geom,coordinate')
    .eq('campaign_id', targetCampaignId)
    .in('id', finalDecisions.map((decision) => String(decision.address_id)))
    .order('id');
  if (finalCoordinates.error) throw new Error(finalCoordinates.error.message);

  console.log(JSON.stringify({
    source_campaign_id: SOURCE_CAMPAIGN_ID,
    source_signature: frozenSourceSignature,
    optimized_campaign_id: targetCampaignId,
    optimized_name: TARGET_NAME,
    first_run_id: firstRun.id,
    rollback_verified: true,
    final_run_id: secondRun.id,
    source_coordinates_preserved: hash(finalCoordinates.data) === coordinateHash,
    source_counts: sourceAfter,
    optimized_counts: finalCounts,
    links: finalDecisions.map((decision) => ({
      decision_id: decision.id,
      address_id: decision.address_id,
      building_id: decision.building_id,
      score: decision.score,
      runner_up_margin: decision.runner_up_margin,
      evidence_codes: decision.evidence_codes,
    })),
  }, null, 2));
}

void main();
