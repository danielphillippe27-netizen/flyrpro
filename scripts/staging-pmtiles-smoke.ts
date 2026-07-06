#!/usr/bin/env tsx
/**
 * Verify the staging PMTiles/map-bundle contract for one campaign.
 *
 * Required:
 *   STAGING_TEST_EMAIL + STAGING_TEST_PASSWORD, or STAGING_ACCESS_TOKEN
 *   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npm run staging:pmtiles:smoke -- <campaign-id>
 *   npm run staging:pmtiles:smoke -- --campaign-id=<id> --api-base-url=https://staging.flyrpro.app
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });
dotenv.config({ path: '.env.local' });
dotenv.config();

const PRODUCTION_SUPABASE_REFS = new Set([
  'kfnsnwqylsdsbgnwgxva',
]);

type JsonRecord = Record<string, unknown>;

const args = process.argv.slice(2);
const campaignId = readFlag('campaign-id') ?? args.find((arg) => !arg.startsWith('--'));
const apiBaseUrl = (
  readFlag('api-base-url') ??
  process.env.FLYR_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.APP_BASE_URL ??
  'https://staging.flyrpro.app'
).replace(/\/+$/, '');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geometryStage = process.env.GEOMETRY_STAGE?.trim();
const geometryStagePrefix = process.env.GEOMETRY_STAGE_PREFIX?.trim();

if (!campaignId) {
  fail('Campaign id is required. Usage: npm run staging:pmtiles:smoke -- <campaign-id>');
}
if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  fail('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.');
}
if (supabaseProjectRef(supabaseUrl) && PRODUCTION_SUPABASE_REFS.has(supabaseProjectRef(supabaseUrl)!)) {
  fail(`Refusing to run staging PMTiles smoke against production Supabase ref ${supabaseProjectRef(supabaseUrl)}.`);
}
if (geometryStage !== 'staging' || geometryStagePrefix !== 'staging') {
  fail('GEOMETRY_STAGE and GEOMETRY_STAGE_PREFIX must both be "staging" for this smoke.');
}
if (apiBaseUrl === 'https://www.flyrpro.app' || apiBaseUrl === 'https://flyrpro.app') {
  fail(`Refusing to smoke production API base URL: ${apiBaseUrl}`);
}

const admin = createClient(supabaseUrl!, serviceRoleKey!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const authClient = createClient(supabaseUrl!, anonKey!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const accessToken = await resolveAccessToken();
  const snapshot = await loadSnapshot();
  const [addressCount, statusCount] = await Promise.all([
    countRows('campaign_addresses'),
    countRows('address_statuses'),
  ]);

  const manifest = await fetchJson(`${apiBaseUrl}/api/campaigns/${encodeURIComponent(campaignId!)}/diamond-manifest`, accessToken);
  assertManifest(manifest);

  const mapBundle = await fetchJson(`${apiBaseUrl}/api/campaigns/${encodeURIComponent(campaignId!)}/map-bundle`, accessToken);
  assertMapBundle(mapBundle);
  const mapBundleCounts = asRecord(mapBundle.counts);

  const report = {
    ok: true,
    campaign_id: campaignId,
    api_base_url: apiBaseUrl,
    supabase_ref: supabaseProjectRef(supabaseUrl!),
    geometry_stage: geometryStage,
    geometry_stage_prefix: geometryStagePrefix,
    data: {
      campaign_addresses: addressCount,
      address_statuses: statusCount,
      snapshot_buildings_count: snapshot.buildings_count ?? null,
      snapshot_addresses_count: snapshot.addresses_count ?? null,
    },
    snapshot: {
      bucket: snapshot.bucket,
      prefix: snapshot.prefix,
      buildings_key: snapshot.buildings_key,
      addresses_key: snapshot.addresses_key,
      metadata_key: snapshot.metadata_key,
      geometry_provider: stringMetric(snapshot.tile_metrics, 'geometry_provider'),
      pmtiles_key: stringMetric(snapshot.tile_metrics, 'pmtiles_key'),
      addresses_pmtiles_key: stringMetric(snapshot.tile_metrics, 'addresses_pmtiles_key'),
      geometry_build_status: stringMetric(snapshot.tile_metrics, 'geometry_build_status'),
      stale_geometry: snapshot.tile_metrics?.stale_geometry === true,
    },
    manifest: {
      geometry_build_status: manifest.geometry_build_status,
      geometry_stage: manifest.geometry_stage,
      geometry_stage_prefix: manifest.geometry_stage_prefix,
      geometry_provider: manifest.geometry_provider,
      primary_state_layer: manifest.primary_state_layer,
      promote_ids: manifest.promote_ids,
      address_vector_tile_url_template: Boolean(manifest.address_vector_tile_url_template),
      parcel_vector_tile_url_template: Boolean(manifest.parcel_vector_tile_url_template),
    },
    map_bundle: {
      status: mapBundle.status,
      cache_contract: 'map-bundle endpoint returned PMTiles-backed geometry metadata',
      counts: {
        addresses: mapBundleCounts.addresses,
        buildings: mapBundleCounts.buildings,
        parcels: mapBundleCounts.parcels,
        geometry_source: mapBundleCounts.geometry_source,
        building_geometry_source: mapBundleCounts.building_geometry_source,
        parcel_geometry_source: mapBundleCounts.parcel_geometry_source,
        pmtiles_backed_bundle: mapBundleCounts.pmtiles_backed_bundle,
        render_version: mapBundleCounts.render_version,
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

function readFlag(name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function supabaseProjectRef(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : null;
  } catch {
    return null;
  }
}

function stringMetric(metrics: unknown, key: string): string | null {
  const value = metrics && typeof metrics === 'object' ? (metrics as JsonRecord)[key] : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function resolveAccessToken() {
  const token =
    process.env.STAGING_ACCESS_TOKEN ??
    process.env.FLYR_ACCESS_TOKEN ??
    process.env.API_ACCESS_TOKEN;
  if (token?.trim()) return token.trim();

  const email = process.env.STAGING_TEST_EMAIL ?? process.env.FLYR_TEST_EMAIL;
  const password = process.env.STAGING_TEST_PASSWORD ?? process.env.FLYR_TEST_PASSWORD;
  if (!email || !password) {
    fail('Set STAGING_ACCESS_TOKEN, or STAGING_TEST_EMAIL + STAGING_TEST_PASSWORD for a staging user with campaign access.');
  }

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    fail(`Staging sign-in failed: ${error?.message ?? 'missing access token'}`);
  }
  return data.session.access_token;
}

async function loadSnapshot() {
  const { data, error } = await admin
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, addresses_key, metadata_key, buildings_count, addresses_count, tile_metrics')
    .eq('campaign_id', campaignId!)
    .maybeSingle();
  if (error) fail(`Failed to load campaign_snapshots: ${error.message}`);
  if (!data) fail(`No campaign_snapshots row exists for campaign ${campaignId}. Run the staging PMTiles build first.`);

  const metrics = data.tile_metrics as JsonRecord | null;
  const keys = [
    data.buildings_key,
    data.addresses_key,
    stringMetric(metrics, 'pmtiles_key'),
    stringMetric(metrics, 'addresses_pmtiles_key'),
    stringMetric(metrics, 'parcels_pmtiles_key'),
  ].filter(Boolean) as string[];
  if (!keys.some((key) => key.endsWith('.pmtiles'))) {
    fail('Campaign snapshot exists, but no PMTiles artifact key was found.');
  }
  if (!keys.some((key) => key.startsWith('staging/'))) {
    fail(`Campaign snapshot PMTiles keys are not under staging/: ${keys.join(', ')}`);
  }

  return data as {
    bucket: string | null;
    prefix: string | null;
    buildings_key: string | null;
    addresses_key: string | null;
    metadata_key: string | null;
    buildings_count: number | null;
    addresses_count: number | null;
    tile_metrics: JsonRecord | null;
  };
}

async function countRows(table: string) {
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId!);
  if (error) return null;
  return count ?? 0;
}

async function fetchJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`${url} failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as JsonRecord;
}

function assertManifest(manifest: JsonRecord) {
  const promoteIds = manifest.promote_ids && typeof manifest.promote_ids === 'object'
    ? manifest.promote_ids as JsonRecord
    : {};
  const errors = [
    manifest.geometry_build_status === 'ready' ? null : `geometry_build_status=${String(manifest.geometry_build_status)}`,
    manifest.geometry_stage === 'staging' ? null : `geometry_stage=${String(manifest.geometry_stage)}`,
    manifest.geometry_stage_prefix === 'staging' ? null : `geometry_stage_prefix=${String(manifest.geometry_stage_prefix)}`,
    promoteIds.buildings === 'building_id' ? null : `promote_ids.buildings=${String(promoteIds.buildings)}`,
    promoteIds.addresses === 'address_id' ? null : `promote_ids.addresses=${String(promoteIds.addresses)}`,
    promoteIds.address_circles === 'address_id' ? null : `promote_ids.address_circles=${String(promoteIds.address_circles)}`,
    manifest.primary_state_layer === 'addresses' ? null : `primary_state_layer=${String(manifest.primary_state_layer)}`,
    manifest.address_vector_tile_url_template ? null : 'address_vector_tile_url_template is missing',
  ].filter(Boolean);

  if (errors.length > 0) {
    fail(`Manifest does not match staging PMTiles contract: ${errors.join('; ')}`);
  }
}

function assertMapBundle(mapBundle: JsonRecord) {
  const counts = mapBundle.counts && typeof mapBundle.counts === 'object'
    ? mapBundle.counts as JsonRecord
    : {};
  const errors = [
    mapBundle.status === 'ready' ? null : `status=${String(mapBundle.status)}`,
    counts.pmtiles_backed_bundle === true ? null : `counts.pmtiles_backed_bundle=${String(counts.pmtiles_backed_bundle)}`,
    counts.geometry_source === 'pmtiles_snapshot' ? null : `counts.geometry_source=${String(counts.geometry_source)}`,
    typeof counts.render_version === 'string' ? null : 'counts.render_version is missing',
  ].filter(Boolean);

  if (errors.length > 0) {
    fail(`Map bundle does not match PMTiles-backed contract: ${errors.join('; ')}`);
  }
}
