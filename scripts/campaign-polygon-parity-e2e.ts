#!/usr/bin/env tsx
/**
 * Campaign polygon parity E2E harness.
 *
 * Creates disposable QA campaigns through the web, iOS-wire, and Android-wire
 * paths, provisions each one, then compares returned map data and timing.
 *
 * Usage:
 *   npm run test:campaign-polygon-parity
 *
 * Optional environment:
 *   API_BASE_URL=http://127.0.0.1:3000
 *   E2E_RUNS=3
 *   E2E_SURFACES=flyr_pro,ios_wire,android_wire
 *   E2E_CAPTURE_SCREENSHOT=0
 *   E2E_REQUIRE_OPTIMIZED=1
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type Surface = 'flyr_pro' | 'ios_wire' | 'android_wire';

type JsonObject = Record<string, unknown>;

type Timings = Record<string, number>;

type FixtureExpected = {
  addresses?: number | null;
  snapshotBuildings?: number | null;
  bundleBuildings?: number | null;
  endpointBuildings?: number | null;
  roads?: number | null;
  parcels?: number | null;
};

type PolygonFixture = {
  id: string;
  name: string;
  region: string;
  seedQuery: string;
  baselineCampaignId?: string | null;
  polygon: {
    type: 'Polygon';
    coordinates: readonly (readonly (readonly number[])[])[];
  };
  expected: FixtureExpected;
};

type TimedValue<T> = {
  value: T;
  seconds: number;
};

type CampaignRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  region?: string | null;
  bbox?: unknown;
  territory_boundary?: unknown;
  address_source?: string | null;
  provision_status?: string | null;
  provision_phase?: string | null;
  provision_source?: string | null;
  map_mode?: string | null;
};

type SnapshotRow = {
  buildings_count?: number | null;
  addresses_count?: number | null;
  tile_metrics?: JsonObject | null;
};

type EndpointSnapshot = {
  status: number;
  seconds: number;
  count: number;
  hash: string;
  bytes: number;
  headers: {
    serverTiming: string | null;
    parcelCache: string | null;
    parcelTiles: string | null;
    parcelFeatures: string | null;
    etag: string | null;
    mapBundleCache: string | null;
  };
  body?: unknown;
};

type BundleWorkflow = {
  status: string | null;
  phase: string | null;
  source: string | null;
  linksStatus: string | null;
  sourceVersion: string | null;
  assetSignature: string | null;
  links: number;
  addressOrphans: number;
  buildingOrphans: number;
  units: number;
  hasCanonicalFields: boolean;
};

type SurfaceResult = {
  runId: string;
  ordinal: number;
  surface: Surface;
  campaignId?: string;
  workspaceId?: string;
  userId?: string;
  timings: Timings;
  campaign?: CampaignRow | null;
  snapshot?: SnapshotRow | null;
  provisionResponse?: unknown;
  endpoints?: {
    mapBundle: EndpointSnapshot;
    mapBundleWarm304?: EndpointSnapshot;
    addresses: EndpointSnapshot;
    buildingsCold: EndpointSnapshot;
    buildingsBypass: EndpointSnapshot;
    parcels: EndpointSnapshot;
  };
  counts?: {
    addressesTable: number | null;
    snapshotAddresses: number | null;
    snapshotBuildings: number | null;
    mapBundleAddresses: number;
    mapBundleBuildings: number;
    mapBundleRoads: number;
    mapBundleParcels: number;
    addressesEndpoint: number;
    buildingsEndpoint: number;
    parcelsEndpoint: number;
  };
  workflow?: BundleWorkflow;
  hashes?: {
    territory: string;
    bbox: string;
    addresses: string;
    buildings: string;
    parcels: string;
  };
  screenshotPath?: string | null;
  warnings: string[];
  errors: string[];
};

type QaIdentity = Awaited<ReturnType<typeof setupQaIdentity>>;
type RunContext = QaIdentity & {
  outputDir: string;
  runId: string;
};

const ALL_SURFACES: Surface[] = ['flyr_pro', 'ios_wire', 'android_wire'];
const CREATE_TARGET_SECONDS = 3;
const PROVISION_TIMEOUT_SECONDS = 300;
const MAP_BUNDLE_TARGET_SECONDS = 5;
const BUILDINGS_TARGET_SECONDS = 10;
const POLL_INTERVAL_MS = 2_000;

const FIXTURES: PolygonFixture[] = [
  {
    id: 'oshawa-on',
    name: 'Oshawa, Ontario',
    region: 'ON',
    seedQuery: 'ON',
    baselineCampaignId: 'e375825f-672c-4ebc-9f09-05eb566730fb',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-78.7842254687073, 43.92552044236356],
          [-78.77887337137338, 43.926841389352035],
          [-78.77749783233911, 43.92380917196115],
          [-78.78284159307286, 43.92254219970988],
          [-78.7842254687073, 43.92552044236356],
        ],
      ],
    },
    expected: {
      addresses: 172,
      snapshotBuildings: 185,
      endpointBuildings: 240,
      roads: 0,
      parcels: 133,
    },
  },
  {
    id: 'fort-worth-tx',
    name: 'Fort Worth, Texas',
    region: 'TX',
    seedQuery: 'TX',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-97.374146, 32.752274],
          [-97.369417, 32.752399],
          [-97.369198, 32.748908],
          [-97.373947, 32.748743],
          [-97.374146, 32.752274],
        ],
      ],
    },
    expected: { roads: 0 },
  },
  {
    id: 'austin-tx-building-proxy',
    name: 'Austin, Texas Building Proxy',
    region: 'TX',
    seedQuery: 'TX',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [-97.6429772171783, 30.388837676685682],
          [-97.6406208491556, 30.38703681955164],
          [-97.63876572608457, 30.388908997077124],
          [-97.6398870678847, 30.391436379831575],
          [-97.64143214253208, 30.39041562817691],
          [-97.6429772171783, 30.388837676685682],
        ],
      ],
    },
    expected: {
      addresses: 169,
      snapshotBuildings: 169,
      bundleBuildings: 164,
      endpointBuildings: 169,
      roads: 0,
      parcels: 4,
    },
  },
  {
    id: 'au-sydney',
    name: 'Sydney, Australia',
    region: 'AU',
    seedQuery: 'AU',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [151.205837, -33.879971],
          [151.211309, -33.879812],
          [151.211025, -33.884063],
          [151.205511, -33.884204],
          [151.205837, -33.879971],
        ],
      ],
    },
    expected: { roads: 0 },
  },
  {
    id: 'nz-auckland',
    name: 'Auckland, New Zealand',
    region: 'NZ',
    seedQuery: 'NZ',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [174.739611, -36.862124],
          [174.744547, -36.861899],
          [174.744116, -36.866095],
          [174.739134, -36.866226],
          [174.739611, -36.862124],
        ],
      ],
    },
    expected: { roads: 0 },
  },
  {
    id: 'za-cape-town',
    name: 'Cape Town, South Africa',
    region: 'ZA',
    seedQuery: 'ZA',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [18.406587, -33.929072],
          [18.411926, -33.928785],
          [18.411607, -33.933018],
          [18.406151, -33.933185],
          [18.406587, -33.929072],
        ],
      ],
    },
    expected: { roads: 0 },
  },
];

const FIXTURE = selectFixture(process.env.E2E_FIXTURE);
const FIXTURE_NAME = FIXTURE.id;
const EXPECTED_REGION = FIXTURE.region;
const EXPECTED_BBOX = bboxForPolygon(FIXTURE.polygon);
const POLYGON = FIXTURE.polygon;

const apiBaseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const runs = intEnv('E2E_RUNS', 3);
const captureScreenshot = process.env.E2E_CAPTURE_SCREENSHOT !== '0';
const strictBaseline = process.env.E2E_STRICT_BASELINE === '1';
const strictPerformance = process.env.E2E_STRICT_PERFORMANCE === '1';
const requireOptimized = process.env.E2E_REQUIRE_OPTIMIZED === '1';
const selectedSurfaces = parseSurfaces(process.env.E2E_SURFACES);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error('Missing required Supabase environment variables.');
  console.error('Need NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const runId = `polygon-parity-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outputDir = path.join(process.cwd(), '..', '.tmp', 'campaign-polygon-parity', runId);
  await mkdir(outputDir, { recursive: true });

  console.log(`Campaign polygon parity run: ${runId}`);
  console.log(`API base URL: ${apiBaseUrl}`);
  console.log(`Fixture: ${FIXTURE.name} (${FIXTURE.id}) region=${FIXTURE.region}`);
  console.log(`Surfaces: ${selectedSurfaces.join(', ')}`);
  console.log(`Runs per surface: ${runs}`);
  console.log(`Require optimized: ${requireOptimized ? 'yes' : 'no'}`);
  console.log(`Report directory: ${outputDir}`);

  const setup = await timeAsync(() => setupQaIdentity(runId));
  const context = {
    ...setup.value,
    outputDir,
    runId,
  };
  console.log(`QA setup complete in ${setup.seconds}s: workspace=${context.workspaceId}`);

  const results: SurfaceResult[] = [];
  for (let ordinal = 1; ordinal <= runs; ordinal += 1) {
    for (const surface of selectedSurfaces) {
      console.log(`[${surface} ${ordinal}/${runs}] starting`);
      const result = await runSurface(context, surface, ordinal, setup.seconds);
      results.push(result);
      const status = result.errors.length ? 'failed' : 'passed';
      console.log(`[${surface} ${ordinal}/${runs}] ${status} campaign=${result.campaignId ?? 'none'}`);
    }
  }

  const validationErrors = validateRun(results);
  const report = {
    runId,
    createdAt: new Date().toISOString(),
    fixture: {
      name: FIXTURE_NAME,
      label: FIXTURE.name,
      baselineCampaignId: FIXTURE.baselineCampaignId ?? null,
      polygon: POLYGON,
      bbox: EXPECTED_BBOX,
      expected: {
        region: EXPECTED_REGION,
        addresses: FIXTURE.expected.addresses ?? null,
        snapshotBuildings: FIXTURE.expected.snapshotBuildings ?? null,
        bundleBuildings: FIXTURE.expected.bundleBuildings ?? null,
        endpointBuildings: FIXTURE.expected.endpointBuildings ?? null,
        roads: FIXTURE.expected.roads ?? null,
        parcels: FIXTURE.expected.parcels ?? null,
      },
    },
    apiBaseUrl,
    workspaceId: context.workspaceId,
    userId: context.userId,
    surfaces: selectedSurfaces,
    runs,
    validationErrors,
    stats: timingStats(results),
    results,
  };

  const jsonPath = path.join(outputDir, 'report.json');
  const markdownPath = path.join(outputDir, 'report.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, markdownReport(report));

  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);

  if (validationErrors.length > 0) {
    console.error('Validation failed:');
    for (const error of validationErrors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('Campaign polygon parity E2E passed.');
}

async function setupQaIdentity(runId: string) {
  const stamp = Date.now();
  const email = `campaign-polygon-parity-${stamp}@example.com`;
  const password = `PolygonParity${stamp}!`;

  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { qa_run_id: runId, qa_fixture: FIXTURE_NAME },
  });
  if (createUserError || !created.user) {
    throw new Error(`Failed to create QA user: ${createUserError?.message ?? 'missing user'}`);
  }
  const userId = created.user.id;

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .insert({
      name: `Campaign Polygon Parity ${stamp}`,
      owner_id: userId,
    })
    .select('id')
    .single();
  if (workspaceError || !workspace?.id) {
    throw new Error(`Failed to create QA workspace: ${workspaceError?.message ?? 'missing workspace'}`);
  }
  const workspaceId = workspace.id as string;

  const { error: memberError } = await admin.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: userId,
    role: 'owner',
  });
  if (memberError) {
    throw new Error(`Failed to create QA workspace membership: ${memberError.message}`);
  }

  const userClient = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session?.access_token) {
    throw new Error(`Failed to sign in QA user: ${signInError?.message ?? 'missing session'}`);
  }
  const accessToken = signIn.session.access_token;
  const authedSupabase = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  return {
    email,
    password,
    userId,
    workspaceId,
    accessToken,
    authedSupabase,
  };
}

async function runSurface(
  context: RunContext,
  surface: Surface,
  ordinal: number,
  setupSeconds: number
): Promise<SurfaceResult> {
  const result: SurfaceResult = {
    runId: context.runId,
    ordinal,
    surface,
    workspaceId: context.workspaceId,
    userId: context.userId,
    timings: { setup: setupSeconds },
    warnings: [],
    errors: [],
  };

  try {
    const created = await createCampaignForSurface(context, surface, ordinal);
    result.campaignId = created.campaignId;
    Object.assign(result.timings, created.timings);

    const provision = await timeAsync(() => provisionCampaign(context.accessToken, created.campaignId));
    result.timings.provisionRequest = provision.seconds;
    result.provisionResponse = provision.value;

    const ready = await timeAsync(() => waitForCampaignReady(created.campaignId));
    result.timings.waitUntilReady = ready.seconds;

    const fetched = await collectData(context, created.campaignId, surface, ordinal);
    Object.assign(result.timings, fetched.timings);
    result.campaign = fetched.campaign;
    result.snapshot = fetched.snapshot;
    result.endpoints = fetched.endpoints;
    result.counts = fetched.counts;
    result.workflow = fetched.workflow;
    result.hashes = fetched.hashes;
    result.warnings.push(...fetched.warnings);

    if (surface === 'flyr_pro' && captureScreenshot) {
      const screenshot = await captureCampaignScreenshot(context, created.campaignId, ordinal);
      result.screenshotPath = screenshot.path;
      result.timings.detailLoad = screenshot.seconds;
      if (screenshot.warning) result.warnings.push(screenshot.warning);
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

async function createCampaignForSurface(
  context: RunContext,
  surface: Surface,
  ordinal: number
): Promise<{ campaignId: string; timings: Timings }> {
  if (surface === 'flyr_pro') {
    const created = await timeAsync(async () => {
      const response = await authFetch(context.accessToken, '/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignName(context.runId, surface, ordinal),
          description: descriptionFor(context.runId, surface, ordinal),
          type: 'door_knock',
          address_source: 'map',
          workspace_id: context.workspaceId,
          region: EXPECTED_REGION,
          seed_query: FIXTURE.seedQuery,
          tags: tagsFor(context.runId, surface, ordinal),
          bbox: EXPECTED_BBOX,
          territory_boundary: POLYGON,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.id !== 'string') {
        throw new Error(`FLYR-PRO create failed ${response.status}: ${JSON.stringify(body)}`);
      }
      return body.id as string;
    });
    return { campaignId: created.value, timings: { createShell: created.seconds } };
  }

  if (surface === 'ios_wire') {
    const inserted = await timeAsync(() =>
      insertCampaignShell(context.authedSupabase, {
        name: campaignName(context.runId, surface, ordinal),
        description: descriptionFor(context.runId, surface, ordinal),
        type: 'door_knock',
        ownerId: context.userId,
        workspaceId: context.workspaceId,
        region: EXPECTED_REGION,
        tags: tagsFor(context.runId, surface, ordinal),
        includeSeedQuery: false,
      })
    );
    const boundary = await timeAsync(() =>
      updateCampaignBoundary(context.authedSupabase, inserted.value, {
        region: EXPECTED_REGION,
        bbox: EXPECTED_BBOX,
      })
    );
    return {
      campaignId: inserted.value,
      timings: { createShell: inserted.seconds, boundaryWrite: boundary.seconds },
    };
  }

  const inserted = await timeAsync(() =>
    insertCampaignShell(context.authedSupabase, {
      name: 'Untitled Campaign',
      description: '',
      type: 'door_knock',
      ownerId: context.userId,
      workspaceId: context.workspaceId,
      region: EXPECTED_REGION,
      seedQuery: FIXTURE.seedQuery,
      tags: tagsFor(context.runId, surface, ordinal),
      includeSeedQuery: true,
    })
  );
  const boundary = await timeAsync(() =>
    updateCampaignBoundary(context.authedSupabase, inserted.value, {
      region: EXPECTED_REGION,
      bbox: androidBboxFromVertices(),
    })
  );
  const details = await timeAsync(() =>
    updateCampaignDetails(context.authedSupabase, inserted.value, {
      name: campaignName(context.runId, surface, ordinal),
      description: descriptionFor(context.runId, surface, ordinal),
      type: 'door_knock',
    })
  );
  return {
    campaignId: inserted.value,
    timings: { createShell: inserted.seconds, boundaryWrite: boundary.seconds, detailsWrite: details.seconds },
  };
}

async function insertCampaignShell(
  supabase: SupabaseClient,
  input: {
    name: string;
    description: string;
    type: string;
    ownerId: string;
    workspaceId: string;
    region: string;
    seedQuery?: string;
    tags: string;
    includeSeedQuery: boolean;
  }
) {
  const row: JsonObject = {
    owner_id: input.ownerId,
    workspace_id: input.workspaceId,
    title: input.name,
    name: input.name,
    description: input.description,
    type: input.type,
    address_source: 'map',
    status: 'draft',
    scans: 0,
    conversions: 0,
    region: input.region,
    tags: input.tags,
  };
  if (input.includeSeedQuery) row.seed_query = input.seedQuery ?? input.region;

  const { data, error } = await supabase.from('campaigns').insert(row).select('id').single();
  if (error || !data?.id) {
    throw new Error(`Supabase campaign insert failed: ${error?.message ?? 'missing campaign id'}`);
  }
  return data.id as string;
}

async function updateCampaignBoundary(
  supabase: SupabaseClient,
  campaignId: string,
  input: { region: string; bbox: number[] }
) {
  const { error } = await supabase
    .from('campaigns')
    .update({
      territory_boundary: POLYGON,
      region: input.region,
      bbox: input.bbox,
    })
    .eq('id', campaignId);
  if (error) throw new Error(`Supabase boundary update failed: ${error.message}`);
}

async function updateCampaignDetails(
  supabase: SupabaseClient,
  campaignId: string,
  input: { name: string; description: string; type: string }
) {
  const { error } = await supabase
    .from('campaigns')
    .update({
      name: input.name,
      title: input.name,
      description: input.description,
      type: input.type,
    })
    .eq('id', campaignId);
  if (error) throw new Error(`Supabase details update failed: ${error.message}`);
}

async function provisionCampaign(accessToken: string, campaignId: string) {
  const response = await authFetch(accessToken, '/api/campaigns/provision', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      wait_for_postprocess: requireOptimized,
      require_linked_homes: requireOptimized,
    }),
    timeoutSeconds: PROVISION_TIMEOUT_SECONDS,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Provision failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForCampaignReady(campaignId: string) {
  const started = Date.now();
  while (Date.now() - started < PROVISION_TIMEOUT_SECONDS * 1000) {
    const campaign = await fetchCampaign(campaignId);
    if (campaign?.provision_status === 'failed') {
      throw new Error(`Campaign provisioning failed for ${campaignId}`);
    }
    if (requireOptimized && isOptimized(campaign)) return campaign;
    if (!requireOptimized && isMapUsable(campaign)) return campaign;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Campaign was not ${requireOptimized ? 'optimized' : 'ready'} after ${PROVISION_TIMEOUT_SECONDS}s`);
}

async function collectData(
  context: RunContext,
  campaignId: string,
  surface: Surface,
  ordinal: number
) {
  const warnings: string[] = [];
  const campaign = await fetchCampaign(campaignId);
  const snapshot = await fetchSnapshot(campaignId);
  const timings: Timings = {};

  const mapBundle = await endpointSnapshot(context.accessToken, `/api/campaigns/${campaignId}/map-bundle`, 'mapBundle');
  timings.mapBundle = mapBundle.seconds;
  const mapBundleCounts = countsFromMapBundle(mapBundle.body);
  const workflow = bundleWorkflowFromMapBundle(mapBundle.body);
  const mapBundleWarm304 = workflow.assetSignature
    ? await endpointSnapshot(
        context.accessToken,
        `/api/campaigns/${campaignId}/map-bundle?signature=${encodeURIComponent(workflow.assetSignature)}`,
        'mapBundleWarm304',
        { allowedStatuses: [304] }
      )
    : undefined;
  if (mapBundleWarm304) {
    timings.mapBundleWarm304 = mapBundleWarm304.seconds;
    if (mapBundleWarm304.status !== 304) {
      warnings.push(`${surface} #${ordinal} warm bundle refresh returned ${mapBundleWarm304.status} instead of 304`);
    }
  }
  const addresses = await endpointSnapshot(context.accessToken, `/api/campaigns/${campaignId}/addresses`, 'addresses');
  timings.addresses = addresses.seconds;
  const buildingsCold = await endpointSnapshot(context.accessToken, `/api/campaigns/${campaignId}/buildings`, 'buildings');
  timings.buildingsCold = buildingsCold.seconds;
  const buildingsBypass = await endpointSnapshot(
    context.accessToken,
    `/api/campaigns/${campaignId}/buildings?cache=bypass`,
    'buildings'
  );
  timings.buildingsBypass = buildingsBypass.seconds;
  const parcels = await endpointSnapshot(context.accessToken, `/api/campaigns/${campaignId}/parcels`, 'parcels');
  timings.parcels = parcels.seconds;

  const addressesTable = await exactCount('campaign_addresses', campaignId);
  const territoryHash = hash(normalizePolygon(campaign?.territory_boundary));
  const bboxHash = hash(normalizeNumberArray(campaign?.bbox));
  const addressHash = hash(normalizeAddressPayload(bundleLayerPayload(mapBundle.body, 'addresses')));
  const buildingHash = hash(normalizeBuildingPayload(bundleLayerPayload(mapBundle.body, 'buildings')));
  const parcelHash = hash(normalizeFeaturePayload(bundleLayerPayload(mapBundle.body, 'parcels'), ['id', 'campaign_id', 'campaignId']));

  if (timings.createShell && timings.createShell > CREATE_TARGET_SECONDS) {
    warnings.push(`${surface} #${ordinal} create shell exceeded ${CREATE_TARGET_SECONDS}s`);
  }
  if (mapBundle.seconds > MAP_BUNDLE_TARGET_SECONDS) {
    warnings.push(`${surface} #${ordinal} map bundle exceeded ${MAP_BUNDLE_TARGET_SECONDS}s`);
  }
  if (buildingsCold.seconds > BUILDINGS_TARGET_SECONDS) {
    warnings.push(`${surface} #${ordinal} buildings cold exceeded ${BUILDINGS_TARGET_SECONDS}s`);
  }

  return {
    timings,
    campaign,
    snapshot,
    endpoints: { mapBundle, mapBundleWarm304, addresses, buildingsCold, buildingsBypass, parcels },
    counts: {
      addressesTable,
      snapshotAddresses: snapshot?.addresses_count ?? null,
      snapshotBuildings: snapshot?.buildings_count ?? null,
      mapBundleAddresses: mapBundleCounts.addresses,
      mapBundleBuildings: mapBundleCounts.buildings,
      mapBundleRoads: mapBundleCounts.roads,
      mapBundleParcels: mapBundleCounts.parcels,
      addressesEndpoint: addresses.count,
      buildingsEndpoint: buildingsBypass.count,
      parcelsEndpoint: parcels.count,
    },
    workflow,
    hashes: {
      territory: territoryHash,
      bbox: bboxHash,
      addresses: addressHash,
      buildings: buildingHash,
      parcels: parcelHash,
    },
    warnings,
  };
}

async function endpointSnapshot(
  accessToken: string,
  endpoint: string,
  kind: string,
  options: { allowedStatuses?: number[] } = {}
): Promise<EndpointSnapshot> {
  const started = performance.now();
  let response: Response;
  try {
    response = await authFetch(accessToken, endpoint, { method: 'GET' });
  } catch (error) {
    throw new Error(`${kind} endpoint ${endpoint} failed to fetch: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  const seconds = roundSeconds(performance.now() - started);
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    if (options.allowedStatuses?.includes(response.status)) {
      return {
        status: response.status,
        seconds,
        count: 0,
        hash: hash(null),
        bytes: Buffer.byteLength(text),
        headers: {
          ...endpointHeaders(response),
        },
        body,
      };
    }
    throw new Error(`${kind} endpoint failed ${response.status}: ${text.slice(0, 500)}`);
  }
  const normalized =
    kind === 'addresses'
      ? normalizeAddressPayload(body)
      : kind === 'buildings'
        ? normalizeBuildingPayload(body)
        : normalizeFeaturePayload(body, ['id', 'campaign_id', 'campaignId']);
  return {
    status: response.status,
    seconds,
    count: countPayload(body),
    hash: hash(normalized),
    bytes: Buffer.byteLength(text),
    headers: {
      ...endpointHeaders(response),
    },
    body,
  };
}

function endpointHeaders(response: Response) {
  return {
    serverTiming: response.headers.get('server-timing') ?? response.headers.get('x-flyr-server-timing'),
    parcelCache: response.headers.get('x-flyr-parcels-cache'),
    parcelTiles: response.headers.get('x-flyr-parcels-tiles'),
    parcelFeatures: response.headers.get('x-flyr-parcels-features'),
    etag: response.headers.get('etag'),
    mapBundleCache: response.headers.get('x-flyr-map-bundle-cache'),
  };
}

async function fetchCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { data, error } = await admin
    .from('campaigns')
    .select('id,name,title,region,bbox,territory_boundary,address_source,provision_status,provision_phase,provision_source,map_mode')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load campaign ${campaignId}: ${error.message}`);
  return data as CampaignRow | null;
}

async function fetchSnapshot(campaignId: string): Promise<SnapshotRow | null> {
  const { data, error } = await admin
    .from('campaign_snapshots')
    .select('buildings_count,addresses_count,tile_metrics')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load snapshot ${campaignId}: ${error.message}`);
  return data as SnapshotRow | null;
}

async function exactCount(table: string, campaignId: string): Promise<number | null> {
  const { count, error } = await admin.from(table).select('id', { head: true, count: 'exact' }).eq('campaign_id', campaignId);
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count;
}

async function captureCampaignScreenshot(
  context: RunContext,
  campaignId: string,
  ordinal: number
): Promise<{ path: string | null; seconds: number; warning?: string }> {
  const started = performance.now();
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const next = `/campaigns/${campaignId}`;
      const authUrl = `${apiBaseUrl}/api/dev/auth-session?email=${encodeURIComponent(context.email)}&password=${encodeURIComponent(
        context.password
      )}&next=${encodeURIComponent(next)}`;
      await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => undefined);
      const screenshotPath = path.join(context.outputDir, `flyr-pro-detail-${ordinal}-${campaignId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      return { path: screenshotPath, seconds: roundSeconds(performance.now() - started) };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      path: null,
      seconds: roundSeconds(performance.now() - started),
      warning: `Screenshot skipped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateRun(results: SurfaceResult[]) {
  const errors: string[] = [];
  for (const result of results) {
    errors.push(...result.errors.map((error) => `${result.surface} #${result.ordinal}: ${error}`));
    if (result.errors.length > 0) continue;
    const label = `${result.surface} #${result.ordinal}`;
    const campaign = result.campaign;
    const counts = result.counts;
    const hashes = result.hashes;
    if (!campaign || !counts || !hashes) {
      errors.push(`${label}: missing collected data`);
      continue;
    }
    if (campaign.region !== EXPECTED_REGION) errors.push(`${label}: expected region ${EXPECTED_REGION}, got ${campaign.region}`);
    if (campaign.address_source !== 'map') errors.push(`${label}: expected address_source map, got ${campaign.address_source}`);
    if (!isMapUsable(campaign)) {
      errors.push(`${label}: campaign is not map usable (${campaign.provision_status}/${campaign.provision_phase})`);
    }
    if (requireOptimized && !isOptimized(campaign)) {
      errors.push(`${label}: campaign is not optimized (${campaign.provision_status}/${campaign.provision_phase})`);
    }
    if (!sameJson(normalizePolygon(campaign.territory_boundary), normalizePolygon(POLYGON))) {
      errors.push(`${label}: territory_boundary does not match fixture`);
    }
    if (!sameJson(normalizeNumberArray(campaign.bbox), EXPECTED_BBOX)) {
      errors.push(`${label}: bbox does not match fixture`);
    }
    if (FIXTURE.expected.addresses != null && counts.addressesTable !== FIXTURE.expected.addresses) {
      baselineMismatch(result, errors, `${label}: expected ${FIXTURE.expected.addresses} table addresses, got ${counts.addressesTable}`);
    }
    if (FIXTURE.expected.addresses != null && counts.addressesEndpoint !== FIXTURE.expected.addresses) {
      baselineMismatch(result, errors, `${label}: expected ${FIXTURE.expected.addresses} endpoint addresses, got ${counts.addressesEndpoint}`);
    }
    if (FIXTURE.expected.snapshotBuildings != null && counts.snapshotBuildings !== FIXTURE.expected.snapshotBuildings) {
      baselineMismatch(
        result,
        errors,
        `${label}: expected ${FIXTURE.expected.snapshotBuildings} snapshot buildings, got ${counts.snapshotBuildings}`
      );
    }
    if (counts.snapshotBuildings != null && counts.mapBundleBuildings !== counts.snapshotBuildings) {
      if (FIXTURE.expected.bundleBuildings != null && counts.mapBundleBuildings === FIXTURE.expected.bundleBuildings) {
        result.warnings.push(
          `Renderable building filter: bundle buildings ${counts.mapBundleBuildings}, snapshot buildings ${counts.snapshotBuildings}`
        );
      } else {
        baselineMismatch(
          result,
          errors,
          `${label}: bundle buildings ${counts.mapBundleBuildings} do not match snapshot buildings ${counts.snapshotBuildings}`
        );
      }
    }
    if (FIXTURE.expected.endpointBuildings != null && counts.buildingsEndpoint !== FIXTURE.expected.endpointBuildings) {
      baselineMismatch(
        result,
        errors,
        `${label}: expected ${FIXTURE.expected.endpointBuildings} endpoint buildings, got ${counts.buildingsEndpoint}`
      );
    }
    if (FIXTURE.expected.roads != null && counts.mapBundleRoads !== FIXTURE.expected.roads) {
      baselineMismatch(result, errors, `${label}: expected ${FIXTURE.expected.roads} roads, got ${counts.mapBundleRoads}`);
    }
    if (FIXTURE.expected.parcels != null && counts.parcelsEndpoint !== FIXTURE.expected.parcels) {
      baselineMismatch(
        result,
        errors,
        `${label}: expected ${FIXTURE.expected.parcels} endpoint parcels, got ${counts.parcelsEndpoint}`
      );
    }
    if (counts.parcelsEndpoint > 0 && counts.mapBundleParcels !== counts.parcelsEndpoint) {
      baselineMismatch(
        result,
        errors,
        `${label}: bundle parcels ${counts.mapBundleParcels} do not match /parcels ${counts.parcelsEndpoint}`
      );
    }
    if (counts.mapBundleAddresses !== counts.addressesEndpoint || counts.mapBundleAddresses !== counts.addressesTable) {
      baselineMismatch(
        result,
        errors,
        `${label}: bundle addresses ${counts.mapBundleAddresses}, endpoint addresses ${counts.addressesEndpoint}, table addresses ${counts.addressesTable}`
      );
    }
    if (!result.workflow?.hasCanonicalFields) {
      baselineMismatch(result, errors, `${label}: bundle is missing canonical workflow metadata (links_status/source_version/asset_signature)`);
    }
    if (result.workflow?.linksStatus && !['fresh', 'ready'].includes(result.workflow.linksStatus.toLowerCase())) {
      baselineMismatch(result, errors, `${label}: bundle links_status is ${result.workflow.linksStatus}`);
    }
    if (requireOptimized && counts.mapBundleAddresses > 0 && (result.workflow?.links ?? 0) <= 0) {
      errors.push(`${label}: optimized bundle has ${counts.mapBundleAddresses} addresses but ${result.workflow?.links ?? 0} links`);
    }
    if ((result.timings.createShell ?? 0) > CREATE_TARGET_SECONDS) {
      performanceMismatch(
        result,
        errors,
        `${label}: create shell exceeded ${CREATE_TARGET_SECONDS}s (${result.timings.createShell}s)`
      );
    }
    if ((result.timings.mapBundle ?? 0) > MAP_BUNDLE_TARGET_SECONDS) {
      performanceMismatch(
        result,
        errors,
        `${label}: map bundle exceeded ${MAP_BUNDLE_TARGET_SECONDS}s (${result.timings.mapBundle}s)`
      );
    }
    if ((result.timings.buildingsCold ?? 0) > BUILDINGS_TARGET_SECONDS) {
      performanceMismatch(
        result,
        errors,
        `${label}: buildings cold exceeded ${BUILDINGS_TARGET_SECONDS}s (${result.timings.buildingsCold}s)`
      );
    }
  }

  const successful = results.filter((result) => result.errors.length === 0 && result.hashes);
  const reference = successful[0];
  if (reference?.hashes) {
    for (const result of successful.slice(1)) {
      for (const key of ['territory', 'bbox', 'addresses', 'buildings', 'parcels'] as const) {
        if (result.hashes?.[key] !== reference.hashes[key]) {
          errors.push(
            `${result.surface} #${result.ordinal}: ${key} hash differs from ${reference.surface} #${reference.ordinal}`
          );
        }
      }
    }
  }

  return errors;
}

function baselineMismatch(result: SurfaceResult, errors: string[], message: string) {
  if (strictBaseline) {
    errors.push(message);
  } else {
    result.warnings.push(`Baseline drift: ${message}`);
  }
}

function performanceMismatch(result: SurfaceResult, errors: string[], message: string) {
  if (strictPerformance) {
    errors.push(message);
  } else {
    result.warnings.push(`Performance target missed: ${message}`);
  }
}

function timingStats(results: SurfaceResult[]) {
  const stats: Record<string, Record<string, { min: number; p50: number; max: number }>> = {};
  for (const surface of ALL_SURFACES) {
    const surfaceResults = results.filter((result) => result.surface === surface && result.errors.length === 0);
    if (surfaceResults.length === 0) continue;
    const keys = Array.from(new Set(surfaceResults.flatMap((result) => Object.keys(result.timings))));
    stats[surface] = {};
    for (const key of keys) {
      const values = surfaceResults
        .map((result) => result.timings[key])
        .filter((value): value is number => Number.isFinite(value))
        .sort((a, b) => a - b);
      if (values.length === 0) continue;
      stats[surface][key] = {
        min: values[0],
        p50: values[Math.floor((values.length - 1) / 2)],
        max: values[values.length - 1],
      };
    }
  }
  return stats;
}

function markdownReport(report: {
  runId: string;
  createdAt: string;
  apiBaseUrl: string;
  workspaceId: string;
  userId: string;
  validationErrors: string[];
  stats: ReturnType<typeof timingStats>;
  results: SurfaceResult[];
}) {
  const lines: string[] = [];
  lines.push(`# Campaign Polygon Parity E2E`);
  lines.push('');
  lines.push(`Run: \`${report.runId}\``);
  lines.push(`Created: \`${report.createdAt}\``);
  lines.push(`API: \`${report.apiBaseUrl}\``);
  lines.push(`Workspace: \`${report.workspaceId}\``);
  lines.push(`User: \`${report.userId}\``);
  lines.push('');
  lines.push(`## Results`);
  lines.push('');
  lines.push('| Surface | Run | Campaign | Status | Bundle Addr | Bundle Bldgs | Bundle Parcels | Links | Links Status | Legacy Addr | Legacy Bldgs | Legacy Parcels | Provision | Bundle | Screenshot |');
  lines.push('| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const result of report.results) {
    lines.push(
      [
        result.surface,
        String(result.ordinal),
        result.campaignId ? `\`${result.campaignId}\`` : '',
        result.errors.length ? 'failed' : 'passed',
        String(result.counts?.mapBundleAddresses ?? ''),
        String(result.counts?.mapBundleBuildings ?? ''),
        String(result.counts?.mapBundleParcels ?? ''),
        String(result.workflow?.links ?? ''),
        result.workflow?.linksStatus ?? '',
        String(result.counts?.addressesEndpoint ?? ''),
        String(result.counts?.buildingsEndpoint ?? ''),
        String(result.counts?.parcelsEndpoint ?? ''),
        secondsCell(result.timings.provisionRequest),
        secondsCell(result.timings.mapBundle),
        result.screenshotPath ? `\`${result.screenshotPath}\`` : '',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')
    );
  }
  lines.push('');
  lines.push(`## Timing Stats`);
  lines.push('');
  for (const [surface, surfaceStats] of Object.entries(report.stats)) {
    lines.push(`### ${surface}`);
    lines.push('');
    lines.push('| Step | Min | P50 | Max |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const [step, values] of Object.entries(surfaceStats)) {
      lines.push(`| ${step} | ${values.min}s | ${values.p50}s | ${values.max}s |`);
    }
    lines.push('');
  }
  lines.push(`## Validation`);
  lines.push('');
  if (report.validationErrors.length === 0) {
    lines.push('Passed.');
  } else {
    for (const error of report.validationErrors) lines.push(`- ${error}`);
  }
  lines.push('');
  lines.push(`## Warnings`);
  lines.push('');
  const warnings = report.results.flatMap((result) => result.warnings.map((warning) => `${result.surface} #${result.ordinal}: ${warning}`));
  if (warnings.length === 0) {
    lines.push('None.');
  } else {
    for (const warning of warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function authFetch(
  accessToken: string,
  endpoint: string,
  init: RequestInit & { timeoutSeconds?: number } = {}
) {
  const attempts = init.method === 'GET' ? 3 : 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (init.timeoutSeconds ?? 120) * 1000);
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status < 500 || attempt === attempts) return response;
      await response.arrayBuffer().catch(() => undefined);
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timeout);
    }
    await sleep(250 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'fetch failed'));
}

async function timeAsync<T>(fn: () => Promise<T>): Promise<TimedValue<T>> {
  const started = performance.now();
  const value = await fn();
  return { value, seconds: roundSeconds(performance.now() - started) };
}

function roundSeconds(ms: number) {
  return Math.round((ms / 1000) * 100) / 100;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseSurfaces(raw: string | undefined): Surface[] {
  if (!raw) return ALL_SURFACES;
  const requested = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  const surfaces = requested.filter((entry): entry is Surface => ALL_SURFACES.includes(entry as Surface));
  if (surfaces.length === 0) throw new Error(`No valid E2E_SURFACES found in ${raw}`);
  return surfaces;
}

function selectFixture(raw: string | undefined): PolygonFixture {
  const requested = (raw || 'oshawa-on').trim().toLowerCase();
  const fixture = FIXTURES.find((entry) => entry.id === requested);
  if (!fixture) {
    throw new Error(`Unknown E2E_FIXTURE "${raw}". Valid fixtures: ${FIXTURES.map((entry) => entry.id).join(', ')}`);
  }
  return fixture;
}

function campaignName(runId: string, surface: Surface, ordinal: number) {
  return `QA Polygon Parity ${FIXTURE.id} ${surface} ${ordinal} ${runId}`;
}

function descriptionFor(runId: string, surface: Surface, ordinal: number) {
  return `[qa:${runId}] surface=${surface} ordinal=${ordinal} fixture=${FIXTURE_NAME}`;
}

function tagsFor(runId: string, surface: Surface, ordinal: number) {
  return `qa,polygon-parity,${FIXTURE_NAME},${runId},${surface},run-${ordinal}`;
}

function bboxForPolygon(polygon: { coordinates: readonly (readonly (readonly number[])[])[] }) {
  const positions = polygon.coordinates.flat();
  return normalizeNumberArray([
    Math.min(...positions.map((position) => position[0])),
    Math.min(...positions.map((position) => position[1])),
    Math.max(...positions.map((position) => position[0])),
    Math.max(...positions.map((position) => position[1])),
  ]);
}

function androidBboxFromVertices() {
  const vertices = POLYGON.coordinates[0].slice(0, -1).map(([longitude, latitude]) => ({ latitude, longitude }));
  return normalizeNumberArray([
    Math.min(...vertices.map((vertex) => vertex.longitude)),
    Math.min(...vertices.map((vertex) => vertex.latitude)),
    Math.max(...vertices.map((vertex) => vertex.longitude)),
    Math.max(...vertices.map((vertex) => vertex.latitude)),
  ]);
}

function isMapUsable(campaign: CampaignRow | null | undefined) {
  const status = String(campaign?.provision_status ?? '').trim().toLowerCase();
  const phase = String(campaign?.provision_phase ?? '').trim().toLowerCase();
  return status === 'ready' && ['', 'map_ready', 'linking_failed', 'linked', 'optimizing', 'optimized'].includes(phase);
}

function isOptimized(campaign: CampaignRow | null | undefined) {
  const status = String(campaign?.provision_status ?? '').trim().toLowerCase();
  const phase = String(campaign?.provision_phase ?? '').trim().toLowerCase();
  return status === 'ready' && phase === 'optimized';
}

function countPayload(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const object = value as JsonObject;
  if (Array.isArray(object.features)) return object.features.length;
  if (Array.isArray(object.addresses)) return object.addresses.length;
  if (Array.isArray(object.buildings)) return object.buildings.length;
  if (object.counts && typeof object.counts === 'object') {
    const counts = object.counts as JsonObject;
    return Number(counts.addresses ?? counts.buildings ?? counts.parcels ?? 0);
  }
  return 0;
}

function countsFromMapBundle(value: unknown) {
  const counts = value && typeof value === 'object' ? (value as JsonObject).counts : null;
  const bundle = value && typeof value === 'object' ? (value as JsonObject) : {};
  const object = counts && typeof counts === 'object' ? (counts as JsonObject) : {};
  return {
    addresses: numberValue(object.addresses, countBundleCollection(bundle.addresses)),
    buildings: numberValue(object.buildings, countBundleCollection(bundle.buildings)),
    roads: numberValue(object.roads, countBundleCollection(bundle.roads)),
    parcels: numberValue(object.parcels, countBundleCollection(bundle.parcels)),
  };
}

function bundleWorkflowFromMapBundle(value: unknown): BundleWorkflow {
  const bundle = value && typeof value === 'object' ? (value as JsonObject) : {};
  const counts = isJsonObject(bundle.counts) ? bundle.counts : {};
  const linksStatus = stringValue(bundle.links_status ?? bundle.linksStatus ?? bundle.links_status_v2);
  const sourceVersion = stringValue(bundle.source_version ?? bundle.sourceVersion ?? counts.source_version);
  const assetSignature = stringValue(bundle.asset_signature ?? bundle.assetSignature ?? bundle.signature);
  return {
    status: stringValue(bundle.status),
    phase: stringValue(bundle.phase),
    source: stringValue(bundle.source),
    linksStatus,
    sourceVersion,
    assetSignature,
    links: countBundleCollection(bundle.links),
    addressOrphans: countBundleCollection(bundle.address_orphans ?? bundle.addressOrphans),
    buildingOrphans: countBundleCollection(bundle.building_orphans ?? bundle.buildingOrphans),
    units: numberValue(bundle.units_count ?? bundle.unitsCount ?? counts.units, countBundleCollection(bundle.units)),
    hasCanonicalFields: Boolean(linksStatus || sourceVersion || assetSignature),
  };
}

function countBundleCollection(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const object = value as JsonObject;
  if (Array.isArray(object.features)) return object.features.length;
  if (Array.isArray(object.items)) return object.items.length;
  return 0;
}

function bundleLayerPayload(value: unknown, layer: 'addresses' | 'buildings' | 'parcels') {
  if (!value || typeof value !== 'object') return { type: 'FeatureCollection', features: [] };
  const object = value as JsonObject;
  const candidate = object[layer];
  if (
    candidate &&
    typeof candidate === 'object' &&
    (candidate as JsonObject).type === 'FeatureCollection' &&
    Array.isArray((candidate as JsonObject).features)
  ) {
    return candidate;
  }
  return { type: 'FeatureCollection', features: [] };
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePolygon(value: unknown) {
  const parsed = typeof value === 'string' ? safeParse(value) : value;
  if (!parsed || typeof parsed !== 'object') return null;
  const object = parsed as JsonObject;
  if (object.type !== 'Polygon' || !Array.isArray(object.coordinates)) return null;
  return {
    type: 'Polygon',
    coordinates: normalizeCoordinates(object.coordinates),
  };
}

function normalizeAddressPayload(value: unknown) {
  return featuresFromPayload(value).map((feature) => {
    const properties = featureProperties(feature);
    const point = pointFromFeature(feature);
    return sortObject({
      formatted: text(properties.formatted ?? properties.address ?? properties.address_text),
      house_number: text(properties.house_number),
      street_name: text(properties.street_name),
      locality: text(properties.locality ?? properties.city),
      postal_code: text(properties.postal_code),
      source: text(properties.source),
      source_id: text(properties.source_id ?? properties.gers_id ?? properties.building_gers_id ?? properties.building_id),
      lon: point ? roundCoord(point[0]) : null,
      lat: point ? roundCoord(point[1]) : null,
    });
  }).sort(compareStable);
}

function normalizeBuildingPayload(value: unknown) {
  return normalizeFeaturePayload(value, [
    'id',
    'campaign_id',
    'campaignId',
    'campaign_address_id',
    'campaignAddressId',
    'address_id',
    'addressId',
    'address_ids',
    'addressUUIDs',
    'visited',
    'status',
    'lead_status',
    'selected',
  ]);
}

function normalizeFeaturePayload(value: unknown, ignoredPropertyKeys: string[]) {
  return featuresFromPayload(value).map((feature) => {
    const properties = featureProperties(feature);
    const cleanedProperties: JsonObject = {};
    const ignored = new Set(ignoredPropertyKeys);
    for (const [key, entry] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
      if (ignored.has(key)) continue;
      if (entry == null || typeof entry === 'function') continue;
      cleanedProperties[key] = normalizeUnknown(entry);
    }
    return sortObject({
      geometry: normalizeUnknown((feature as JsonObject).geometry ?? null),
      properties: cleanedProperties,
    });
  }).sort(compareStable);
}

function featuresFromPayload(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isJsonObject);
  if (!value || typeof value !== 'object') return [];
  const object = value as JsonObject;
  if (Array.isArray(object.features)) return object.features.filter(isJsonObject);
  for (const key of ['addresses', 'buildings', 'parcels', 'roads']) {
    const nested = object[key];
    if (nested && typeof nested === 'object' && Array.isArray((nested as JsonObject).features)) {
      return ((nested as JsonObject).features as unknown[]).filter(isJsonObject);
    }
  }
  return [];
}

function featureProperties(feature: JsonObject): JsonObject {
  return isJsonObject(feature.properties) ? feature.properties : feature;
}

function pointFromFeature(feature: JsonObject): [number, number] | null {
  const geometry = isJsonObject(feature.geometry) ? feature.geometry : null;
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
  const properties = featureProperties(feature);
  const lon = Number(properties.lon ?? properties.lng ?? properties.longitude);
  const lat = Number(properties.lat ?? properties.latitude);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function normalizeUnknown(value: unknown): unknown {
  if (typeof value === 'number') return roundCoord(value);
  if (Array.isArray(value)) return value.map(normalizeUnknown);
  if (isJsonObject(value)) {
    const output: JsonObject = {};
    for (const [key, entry] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      output[key] = normalizeUnknown(entry);
    }
    return output;
  }
  return value;
}

function normalizeCoordinates(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => (Array.isArray(entry) ? normalizeCoordinates(entry) : roundCoord(Number(entry))));
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => roundCoord(Number(entry)));
}

function roundCoord(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(7)) : value;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sortObject(value: JsonObject) {
  const sorted: JsonObject = {};
  for (const [key, entry] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    sorted[key] = entry;
  }
  return sorted;
}

function compareStable(a: unknown, b: unknown) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function secondsCell(value: number | undefined) {
  return Number.isFinite(value) ? `${value}s` : '';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
