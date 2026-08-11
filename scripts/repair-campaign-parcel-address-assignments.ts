import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import { normalizeParcelGeometryLongitudes } from '../app/api/campaigns/_utils/scoped-pmtiles-parcels';
import { prebuildCampaignMapBundle } from '../lib/services/CampaignMapBundlePrebuilder';
import { CampaignLinkQualityService } from '../lib/services/CampaignLinkQualityService';
import { CampaignMapModeService } from '../lib/services/CampaignMapModeService';

type JsonRecord = Record<string, any>;

const campaignId = process.env.REPAIR_CAMPAIGN_ID;
const apply = process.env.REPAIR_APPLY === 'true';
if (!campaignId) throw new Error('REPAIR_CAMPAIGN_ID is required');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase production credentials are required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const suffixes: Record<string, string> = {
  avenue: 'ave', boulevard: 'blvd', circle: 'cir', court: 'ct', drive: 'dr',
  lane: 'ln', place: 'pl', road: 'rd', street: 'st', terrace: 'ter', trail: 'trl',
};

function normalized(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((token) => suffixes[token] ?? token)
    .join(' ');
}

function addressIdentity(address: JsonRecord): string {
  return normalized(`${address.house_number ?? ''} ${address.street_name ?? ''}`);
}

function parcelIdentity(parcel: JsonRecord): string {
  const value = normalized(
    parcel.properties?.parceladdr ??
    parcel.properties?.parcel_address ??
    parcel.properties?.site_address ??
    parcel.properties?.address_line ??
    parcel.properties?.address
  );
  const locality = normalized(parcel.properties?.city ?? parcel.properties?.locality ?? 'naples');
  const region = normalized(parcel.properties?.state ?? parcel.properties?.region);
  return value
    .replace(new RegExp(` ${locality} ${region}$`), '')
    .replace(new RegExp(` ${region}$`), '');
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function insertChunks(table: string, rows: JsonRecord[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const result = await supabase.from(table).insert(rows.slice(index, index + 200));
    if (result.error) throw new Error(`Failed to insert ${table}: ${result.error.message}`);
  }
}

async function main(): Promise<void> {
  const [campaignResult, addressesResult, parcelsResult, bundleResult, linksResult, parcelLinksResult, touchesResult] =
    await Promise.all([
      supabase.from('campaigns').select('*').eq('id', campaignId).single(),
      supabase.from('campaign_addresses').select('*').eq('campaign_id', campaignId),
      supabase.from('campaign_parcels').select('*').eq('campaign_id', campaignId),
      supabase.from('campaign_map_bundles').select('*').eq('campaign_id', campaignId).eq('is_current', true).single(),
      supabase.from('building_address_links').select('*').eq('campaign_id', campaignId),
      supabase.from('campaign_address_parcel_links').select('*').eq('campaign_id', campaignId),
      supabase.from('building_touches').select('address_id, building_id').eq('campaign_id', campaignId),
    ]);
  for (const result of [campaignResult, addressesResult, parcelsResult, bundleResult, linksResult, parcelLinksResult, touchesResult]) {
    if (result.error) throw result.error;
  }

  const campaign = campaignResult.data as JsonRecord;
  const bbox = campaign.bbox as [number, number, number, number];
  const addresses = addressesResult.data as JsonRecord[];
  const existingLinks = linksResult.data as JsonRecord[];
  const existingLinkByAddress = new Map(existingLinks.map((link) => [String(link.address_id), link]));
  const protectedAddressIds = new Set<string>();
  const protectedBuildingIds = new Set<string>();
  for (const address of addresses) {
    if (address.visited === true || /manual|field_/i.test(String(address.match_source ?? ''))) {
      protectedAddressIds.add(String(address.id));
    }
  }
  for (const link of existingLinks) {
    if (link.user_confirmed === true || link.locked === true || /manual/i.test(String(link.match_type ?? ''))) {
      protectedAddressIds.add(String(link.address_id));
      protectedBuildingIds.add(String(link.building_id));
    }
  }
  for (const touch of touchesResult.data as JsonRecord[]) {
    if (touch.address_id) protectedAddressIds.add(String(touch.address_id));
    if (touch.building_id) protectedBuildingIds.add(String(touch.building_id));
  }

  const parcels = (parcelsResult.data as JsonRecord[]).map((parcel) => ({
    ...parcel,
    normalizedGeometry: normalizeParcelGeometryLongitudes(parcel.geom, bbox),
    civicIdentity: parcelIdentity(parcel),
  }));
  const parcelsByIdentity = new Map<string, JsonRecord[]>();
  for (const parcel of parcels) {
    if (!parcel.civicIdentity) continue;
    parcelsByIdentity.set(parcel.civicIdentity, [
      ...(parcelsByIdentity.get(parcel.civicIdentity) ?? []),
      parcel,
    ]);
  }

  const buildings = (bundleResult.data as JsonRecord).buildings_geojson.features as GeoJSON.Feature[];
  const assignments: JsonRecord[] = [];
  const unresolved: JsonRecord[] = [];
  for (const address of addresses) {
    const identity = addressIdentity(address);
    const matchingParcels = parcelsByIdentity.get(identity) ?? [];
    if (matchingParcels.length !== 1) {
      unresolved.push({ address_id: address.id, formatted: address.formatted, reason: `parcel_matches_${matchingParcels.length}` });
      continue;
    }
    const parcel = matchingParcels[0];
    const matchingBuildings = buildings.filter((building) => {
      try {
        return turf.booleanPointInPolygon(
          turf.pointOnFeature(building),
          turf.feature(parcel.normalizedGeometry)
        );
      } catch {
        return false;
      }
    });
    if (matchingBuildings.length !== 1) {
      unresolved.push({ address_id: address.id, formatted: address.formatted, reason: `building_matches_${matchingBuildings.length}` });
      continue;
    }
    const building = matchingBuildings[0];
    const buildingId = String(building.id ?? building.properties?.building_id ?? building.properties?.gers_id ?? '');
    if (!buildingId || protectedAddressIds.has(String(address.id)) || protectedBuildingIds.has(buildingId)) {
      unresolved.push({ address_id: address.id, formatted: address.formatted, reason: 'protected_or_missing_building_id' });
      continue;
    }
    const anchor = turf.pointOnFeature(building).geometry.coordinates;
    assignments.push({ address, parcel, building, buildingId, anchor, identity });
  }

  const uniqueAddressCount = new Set(assignments.map((item) => item.address.id)).size;
  const uniqueBuildingCount = new Set(assignments.map((item) => item.buildingId)).size;
  const changed = assignments.filter((item) => existingLinkByAddress.get(String(item.address.id))?.building_id !== item.buildingId).length;
  const summary = {
    campaign_id: campaignId,
    campaign_name: campaign.name ?? campaign.title,
    apply,
    addresses: addresses.length,
    parcels: parcels.length,
    buildings: buildings.length,
    assignments: assignments.length,
    unique_addresses: uniqueAddressCount,
    unique_buildings: uniqueBuildingCount,
    changed_or_new_links: changed,
    unresolved: unresolved.length,
    protected_addresses: protectedAddressIds.size,
    protected_buildings: protectedBuildingIds.size,
  };
  console.log(JSON.stringify({ summary, unresolved }, null, 2));

  if (assignments.length < 200 || uniqueAddressCount !== assignments.length || uniqueBuildingCount !== assignments.length) {
    throw new Error('Safety gate failed: expected at least 200 strict one-to-one parcel/building assignments');
  }
  if (!apply) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(process.cwd(), 'output', 'campaign-map-repairs');
  await mkdir(outputDir, { recursive: true });
  const backupPath = path.join(outputDir, `${campaignId}-${timestamp}.json`);
  const rollbackBackupPath = process.env.REPAIR_BACKUP_PATH ?? backupPath;
  await writeFile(backupPath, JSON.stringify({
    summary,
    campaign,
    affected_addresses: assignments.map((item) => item.address),
    existing_links: existingLinks,
    existing_parcel_links: parcelLinksResult.data,
    existing_parcels: parcelsResult.data,
  }, null, 2));

  const algorithmVersion = 'map-reconciliation-v18-parcel-address-1to1';
  const existingRunResult = await supabase.from('map_reconciliation_runs').select('*')
    .eq('campaign_id', campaignId).eq('algorithm_version', algorithmVersion)
    .in('status', ['applying', 'completed']).order('queued_at', { ascending: false }).limit(1).maybeSingle();
  if (existingRunResult.error) throw existingRunResult.error;
  const runId = existingRunResult.data?.id ?? randomUUID();
  if (!existingRunResult.data) {
    const runInsert = await supabase.from('map_reconciliation_runs').insert({
      id: runId,
      campaign_id: campaignId,
      source_signature: bundleResult.data.asset_signature,
      idempotency_key: hash({ campaignId, algorithmVersion, source: bundleResult.data.asset_signature }),
      algorithm_version: algorithmVersion,
      mode: 'apply_high_confidence',
      status: 'applying',
      phase: 'applying',
      before_metrics: { links: existingLinks.length, address_orphans: addresses.length - existingLinks.length },
    });
    if (runInsert.error) throw runInsert.error;
  }

  const decisions = assignments.map((item) => {
    const decisionId = randomUUID();
    return {
      id: decisionId,
      run_id: runId,
      campaign_id: campaignId,
      action: existingLinkByAddress.has(String(item.address.id)) ? 'reassign_address' : 'link_address',
      status: 'proposed',
      address_id: item.address.id,
      building_id: item.buildingId,
      address_identity: item.identity,
      evidence_codes: ['exact_parcel_civic_identity', 'unique_parcel', 'unique_building_in_parcel', 'global_one_to_one'],
      score: 0.995,
      runner_up_margin: 1,
      precondition_hash: hash({ address: item.address, old_link: existingLinkByAddress.get(String(item.address.id)) ?? null }),
      before_state: { address: item.address, link: existingLinkByAddress.get(String(item.address.id)) ?? null },
      proposed_state: {
        building_id: item.buildingId,
        parcel_id: item.parcel.external_id,
        global_assignment: true,
        move_source: true,
        source_longitude: item.anchor[0],
        source_latitude: item.anchor[1],
        source: 'reconciliation_parcel_address',
      },
      assignment: {
        decision_id: decisionId,
        address_id: item.address.id,
        building_id: item.buildingId,
        score: 0.995,
        evidence_codes: ['exact_parcel_civic_identity', 'unique_parcel', 'unique_building_in_parcel', 'global_one_to_one'],
        source_longitude: item.anchor[0],
        source_latitude: item.anchor[1],
      },
    };
  });
  const appliedDecisionsResult = await supabase.from('map_reconciliation_decisions')
    .select('id', { count: 'exact', head: true }).eq('run_id', runId).eq('status', 'applied');
  if (appliedDecisionsResult.error) throw appliedDecisionsResult.error;
  if ((appliedDecisionsResult.count ?? 0) !== assignments.length) {
    await insertChunks('map_reconciliation_decisions', decisions.map(({ assignment: _assignment, ...decision }) => decision));
    const appliedResult = await supabase.rpc('apply_global_reverse_assignment', {
      p_campaign_id: campaignId,
      p_run_id: runId,
      p_assignments: decisions.map((decision) => decision.assignment),
      p_algorithm_version: algorithmVersion,
    });
    if (appliedResult.error) throw appliedResult.error;
    if (Number(appliedResult.data) !== assignments.length) {
      throw new Error(`Applied ${appliedResult.data} assignments; expected ${assignments.length}`);
    }
  }

  const unresolvedAddressIds = unresolved.map((item) => String(item.address_id));
  if (unresolvedAddressIds.length > 0) {
    const [deleteLinks, resetAddresses, deleteParcelLinks] = await Promise.all([
      supabase.from('building_address_links').delete()
        .eq('campaign_id', campaignId).in('address_id', unresolvedAddressIds),
      supabase.from('campaign_addresses').update({
        building_id: null,
        building_gers_id: null,
        match_source: null,
        confidence: null,
      }).eq('campaign_id', campaignId).in('id', unresolvedAddressIds),
      supabase.from('campaign_address_parcel_links').delete()
        .eq('campaign_id', campaignId).in('address_id', unresolvedAddressIds),
    ]);
    for (const result of [deleteLinks, resetAddresses, deleteParcelLinks]) {
      if (result.error) throw result.error;
    }
  }

  for (let index = 0; index < parcels.length; index += 50) {
    const results = await Promise.all(parcels.slice(index, index + 50).map((parcel) =>
      supabase.from('campaign_parcels').update({
        geom: parcel.normalizedGeometry.type === 'Polygon'
          ? { type: 'MultiPolygon', coordinates: [parcel.normalizedGeometry.coordinates] }
          : parcel.normalizedGeometry,
      }).eq('id', parcel.id)
    ));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }

  const parcelLinkRows = assignments.map((item) => ({
    campaign_id: campaignId,
    address_id: item.address.id,
    campaign_parcel_id: item.parcel.id,
    parcel_id: item.parcel.external_id,
    match_type: 'address_identity',
    confidence: 0.995,
    distance_meters: 0,
    source_version: bundleResult.data.source_version,
    updated_at: new Date().toISOString(),
  }));
  for (let index = 0; index < parcelLinkRows.length; index += 200) {
    const result = await supabase.from('campaign_address_parcel_links').upsert(
      parcelLinkRows.slice(index, index + 200),
      { onConflict: 'campaign_id,address_id' }
    );
    if (result.error) throw result.error;
  }

  const normalizedParcels: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: parcels.map((parcel) => ({
      type: 'Feature',
      id: parcel.external_id,
      geometry: parcel.normalizedGeometry,
      properties: { ...parcel.properties, parcel_id: parcel.external_id, external_id: parcel.external_id },
    })),
  };
  const rebuilt = await prebuildCampaignMapBundle(supabase, campaignId, undefined, {
    scopedGeometry: { buildings: bundleResult.data.buildings_geojson, parcels: normalizedParcels },
    parcelDisplayMode: 'raw',
    forceRebuild: true,
  });
  const qualityService = new CampaignLinkQualityService(supabase);
  const quality = await qualityService.assessPersistedLinks(campaignId);
  await qualityService.persist(campaignId, quality);
  await new CampaignMapModeService(supabase).computeAndPersist(campaignId);

  const completedAt = new Date().toISOString();
  const report = {
    assignments_applied: assignments.length,
    unique_buildings: uniqueBuildingCount,
    unresolved_addresses: unresolved.length,
    source_coordinates_corrected: assignments.length,
    backup_path: rollbackBackupPath,
  };
  const runUpdate = await supabase.from('map_reconciliation_runs').update({
    status: 'completed',
    phase: 'completed',
    after_metrics: { links: assignments.length, unresolved_addresses: unresolved.length },
    report,
    applied_bundle_signature: rebuilt?.asset_signature ?? null,
    completed_at: completedAt,
    updated_at: completedAt,
  }).eq('id', runId);
  if (runUpdate.error) throw runUpdate.error;

  console.log(JSON.stringify({ ok: true, run_id: runId, applied: assignments.length, backup_path: rollbackBackupPath, quality }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : JSON.stringify(error));
  process.exitCode = 1;
});
