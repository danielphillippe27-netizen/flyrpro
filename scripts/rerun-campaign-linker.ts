import { createClient } from '@supabase/supabase-js';
import {
  StableLinkerService,
  type BuildingFeature,
} from '../lib/services/StableLinkerService';
import {
  prebuildCampaignMapBundle,
  readCurrentCampaignMapBundle,
  responseFromCampaignMapBundleRow,
} from '../lib/services/CampaignMapBundlePrebuilder';
import { CampaignMapReconciliationService } from '../lib/services/CampaignMapReconciliationService';

type JsonRecord = Record<string, unknown>;

const campaignId = process.env.RERUN_CAMPAIGN_ID;
const geometryCampaignId = process.env.RERUN_GEOMETRY_CAMPAIGN_ID ?? campaignId;
if (!campaignId) throw new Error('RERUN_CAMPAIGN_ID is required');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase production credentials are required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function linkMetrics(): Promise<JsonRecord> {
  const [{ data: links, error: linksError }, { count: orphanCount, error: orphanError }] =
    await Promise.all([
      supabase
        .from('building_address_links')
        .select('match_type, distance_meters')
        .eq('campaign_id', campaignId),
      supabase
        .from('address_orphans')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId),
    ]);
  if (linksError) throw linksError;
  if (orphanError) throw orphanError;

  const breakdown = new Map<string, { count: number; distances: number[] }>();
  for (const link of links ?? []) {
    const type = String(link.match_type ?? 'unknown');
    const value = breakdown.get(type) ?? { count: 0, distances: [] };
    value.count += 1;
    const distance = Number(link.distance_meters);
    if (Number.isFinite(distance)) value.distances.push(distance);
    breakdown.set(type, value);
  }

  return {
    links: links?.length ?? 0,
    address_orphans: orphanCount ?? 0,
    match_types: Object.fromEntries(Array.from(breakdown.entries()).map(([type, value]) => [
      type,
      {
        count: value.count,
        average_distance_m: value.distances.length
          ? Number((value.distances.reduce((sum, distance) => sum + distance, 0) / value.distances.length).toFixed(2))
          : null,
        maximum_distance_m: value.distances.length
          ? Number(Math.max(...value.distances).toFixed(2))
          : null,
      },
    ])),
  };
}

async function main(): Promise<void> {
  const [{ data: campaign, error: campaignError }, sourceBundle] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, provision_source, has_parcels')
      .eq('id', campaignId)
      .single(),
    readCurrentCampaignMapBundle(supabase, geometryCampaignId),
  ]);
  if (campaignError) throw campaignError;
  if (!sourceBundle) throw new Error('Campaign has no current canonical map bundle');

  const source = responseFromCampaignMapBundleRow(sourceBundle);
  const buildings = source.buildings as GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon,
    BuildingFeature['properties']
  >;
  const parcels = source.parcels as GeoJSON.FeatureCollection;
  if (!Array.isArray(buildings?.features) || buildings.features.length === 0) {
    throw new Error('Campaign bundle has no building geometry');
  }

  const before = await linkMetrics();
  const linker = new StableLinkerService(supabase);
  const linkerSummary = await linker.runSpatialJoin(
    campaignId,
    buildings as unknown as { features: BuildingFeature[] },
    '2026-01-21.0',
    {
      resetExisting: true,
      persistenceMode: campaign.provision_source === 'diamond' ? 'gold' : 'silver',
      parcelsGeoJSON: parcels?.features?.length ? parcels as never : null,
    }
  );

  const rebuilt = await prebuildCampaignMapBundle(supabase, campaignId, undefined, {
    scopedGeometry: { buildings, parcels },
    forceRebuild: true,
  });
  const reconciliation = new CampaignMapReconciliationService(supabase);
  const run = await reconciliation.enqueue(
    campaignId,
    typeof rebuilt?.asset_signature === 'string' ? rebuilt.asset_signature : undefined
  );
  if (run) await reconciliation.processRun(run);

  const after = await linkMetrics();
  const finalBundle = await readCurrentCampaignMapBundle(supabase, campaignId);
  const finalResponse = finalBundle ? responseFromCampaignMapBundleRow(finalBundle) : null;

  console.log(JSON.stringify({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      has_parcels: campaign.has_parcels,
      source_parcel_features: parcels?.features?.length ?? 0,
      building_features: buildings.features.length,
    },
    before,
    linker_summary: linkerSummary,
    reconciliation_run: run ? {
      id: run.id,
      algorithm_version: run.algorithm_version,
      mode: run.mode,
    } : null,
    after,
    final_bundle: finalBundle ? {
      asset_signature: finalBundle.asset_signature,
      reconciliation: finalResponse?.reconciliation,
      report: finalResponse?.reconciliation_report,
      building_orphans: Array.isArray(finalResponse?.building_orphans)
        ? finalResponse.building_orphans.length
        : null,
    } : null,
  }, null, 2));
}

void main();
