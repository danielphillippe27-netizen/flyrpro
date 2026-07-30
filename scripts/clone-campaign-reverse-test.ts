import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { uuidV5 } from '../lib/services/TownhouseUnitIdentity';

type JsonRecord = Record<string, unknown>;

const sourceCampaignId = process.env.REVERSE_TEST_SOURCE_CAMPAIGN_ID;
const targetName = process.env.REVERSE_TEST_TARGET_NAME ?? 'missa — Reverse Geo Test';

if (!sourceCampaignId) throw new Error('REVERSE_TEST_SOURCE_CAMPAIGN_ID is required');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase production credentials are required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function remap(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remap(item, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, child]) => [key, remap(child, ids)])
    );
  }
  return value;
}

async function insertChunks(table: string, rows: JsonRecord[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 200) {
    const result = await supabase.from(table).insert(rows.slice(index, index + 200));
    if (result.error) throw new Error(`Failed to clone ${table}: ${result.error.message}`);
  }
}

async function main(): Promise<void> {
  const [campaignResult, bundleResult, addressesResult, linksResult, orphansResult] =
    await Promise.all([
      supabase.from('campaigns').select('*').eq('id', sourceCampaignId).single(),
      supabase.from('campaign_map_bundles').select('*')
        .eq('campaign_id', sourceCampaignId).eq('is_current', true).single(),
      supabase.from('campaign_addresses').select('*').eq('campaign_id', sourceCampaignId),
      supabase.from('building_address_links').select('*').eq('campaign_id', sourceCampaignId),
      supabase.from('address_orphans').select('*').eq('campaign_id', sourceCampaignId),
    ]);
  for (const result of [
    campaignResult,
    bundleResult,
    addressesResult,
    linksResult,
    orphansResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const duplicate = await supabase.from('campaigns').select('id')
    .eq('workspace_id', campaignResult.data.workspace_id)
    .eq('name', targetName)
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) throw new Error(`${targetName} already exists as ${duplicate.data.id}`);

  const targetCampaignId = randomUUID();
  const idMap = new Map<string, string>();
  for (const row of addressesResult.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:address:${row.id}`));
  }
  for (const row of linksResult.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:link:${row.id}`));
  }
  for (const row of orphansResult.data ?? []) {
    idMap.set(String(row.id), uuidV5(`${targetCampaignId}:orphan:${row.id}`));
  }

  const now = new Date().toISOString();
  const campaign = { ...campaignResult.data } as JsonRecord;
  delete campaign.id;
  delete campaign.created_at;
  delete campaign.updated_at;
  const insertedCampaign = await supabase.from('campaigns').insert({
    ...campaign,
    id: targetCampaignId,
    name: targetName,
    title: targetName,
    description: `Reverse-geocode comparison cloned from ${sourceCampaignId}`,
    created_at: now,
    updated_at: now,
  });
  if (insertedCampaign.error) throw insertedCampaign.error;

  await insertChunks('campaign_addresses', (addressesResult.data ?? []).map((row) => {
    const clone = {
      ...remap(row, idMap) as JsonRecord,
      campaign_id: targetCampaignId,
    };
    delete clone.seq;
    return clone;
  }));
  await insertChunks('building_address_links', (linksResult.data ?? []).map((row) => ({
    ...remap(row, idMap) as JsonRecord,
    campaign_id: targetCampaignId,
    reconciliation_decision_id: null,
  })));
  await insertChunks('address_orphans', (orphansResult.data ?? []).map((row) => ({
    ...remap(row, idMap) as JsonRecord,
    campaign_id: targetCampaignId,
  })));

  const sourceBundle = bundleResult.data as JsonRecord;
  const bundle = { ...sourceBundle };
  for (const key of [
    'id',
    'campaign_id',
    'asset_signature',
    'source_version',
    'created_at',
    'updated_at',
  ]) delete bundle[key];
  const signature = hash({
    targetCampaignId,
    sourceSignature: sourceBundle.asset_signature,
    kind: 'reverse-geocode-linker-comparison-v1',
  });
  const sourceVersion = hash({ targetCampaignId, signature });
  const insertedBundle = await supabase.from('campaign_map_bundles').insert({
    ...remap(bundle, idMap) as JsonRecord,
    id: uuidV5(`${targetCampaignId}:frozen-map-bundle`),
    campaign_id: targetCampaignId,
    asset_signature: signature,
    source_version: sourceVersion,
    counts: {
      ...remap(bundle.counts, idMap) as JsonRecord,
      asset_signature: signature,
      source_version: sourceVersion,
    },
    is_current: true,
    reconciliation: { status: 'not_started' },
    reconciliation_report: {},
    created_at: now,
    updated_at: now,
  });
  if (insertedBundle.error) throw insertedBundle.error;

  console.log(JSON.stringify({
    source_campaign_id: sourceCampaignId,
    source_signature: sourceBundle.asset_signature,
    campaign_id: targetCampaignId,
    name: targetName,
    addresses: addressesResult.data?.length ?? 0,
    links: linksResult.data?.length ?? 0,
    address_orphans: orphansResult.data?.length ?? 0,
    buildings: (sourceBundle.buildings_geojson as { features?: unknown[] })?.features?.length ?? 0,
    building_orphans: Array.isArray(sourceBundle.building_orphans)
      ? sourceBundle.building_orphans.length
      : 0,
    signature,
  }, null, 2));
}

void main();
