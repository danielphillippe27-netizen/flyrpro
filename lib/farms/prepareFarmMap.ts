import type { SupabaseClient } from '@supabase/supabase-js';
import { BedrockCountryService, BEDROCK_CANADA_CONFIG, BEDROCK_US_CONFIG } from '@/lib/services/BedrockCountryService';
import { prebuildCampaignMapBundle } from '@/lib/services/CampaignMapBundlePrebuilder';
import { StableLinkerService, type BuildingFeature } from '@/lib/services/StableLinkerService';
import { ParcelEnrichmentService } from '@/lib/services/ParcelEnrichmentService';
import { isParcelRegionSupported } from '@/lib/geo/parcelRegions';
import { DiamondMunicipalService } from '@/lib/services/DiamondMunicipalService';

/** Publish a canonical farm map; the existing worker then builds its PMTiles archive. */
export async function prepareFarmMap(db: SupabaseClient, farmId: string, country: 'CA' | 'US', region: string) {
  let campaignId = '';
  let afterId: string | null = null;
  do {
    const seeded: { data: { campaign_id: string; next_id: string | null } | null; error: { message: string } | null } = await db.rpc('prepare_farm_map_addresses', { p_farm_id: farmId, p_after_id: afterId });
    if (seeded.error || !seeded.data) throw new Error(seeded.error?.message ?? 'Farm map addresses could not be prepared.');
    campaignId = seeded.data.campaign_id;
    afterId = seeded.data.next_id;
  } while (afterId);
  const service = new BedrockCountryService(country === 'CA' ? BEDROCK_CANADA_CONFIG : BEDROCK_US_CONFIG);
  // Regular campaigns probe municipal Diamond before falling back to Bedrock.
  // Keep an existing snapshot when links already exist: changing footprint IDs
  // under saved links would break established field corrections.
  const [{ data: campaign, error: campaignError }, { count: existingLinks, error: linksError }] = await Promise.all([
    db.from('campaigns').select('territory_boundary').eq('id', campaignId).single(),
    db.from('building_address_links').select('address_id', { count: 'exact', head: true }).eq('campaign_id', campaignId),
  ]);
  if (campaignError) throw campaignError;
  if (linksError) throw linksError;
  const boundary = campaign?.territory_boundary as GeoJSON.Polygon | null;
  const diamond = !existingLinks && boundary?.type === 'Polygon' && DiamondMunicipalService.isSupportedRegion(region)
    ? await DiamondMunicipalService.provisionCampaign({ campaignId, polygon: boundary, regionCode: region, addressLimit: 1 })
    : null;
  const snapshot = diamond?.snapshot ?? await service.staticSnapshotForCampaign(campaignId, region);
  const { count, error: countError } = await db.from('campaign_addresses').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (countError) throw countError;
  const { error } = existingLinks ? { error: null } : await db.from('campaign_snapshots').upsert({
    campaign_id: campaignId, bucket: snapshot.bucket, prefix: snapshot.prefix,
    buildings_key: snapshot.s3_keys.buildings, addresses_key: snapshot.s3_keys.addresses,
    metadata_key: snapshot.s3_keys.metadata, buildings_url: snapshot.urls.buildings,
    addresses_url: snapshot.urls.addresses, metadata_url: snapshot.urls.metadata,
    buildings_count: 0, addresses_count: count ?? 0,
    overture_release: snapshot.metadata?.overture_release, tile_metrics: snapshot.metadata?.tile_metrics ?? null,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  }, { onConflict: 'campaign_id' });
  if (error) throw error;
  // Use the same backend matcher as campaign provisioning. Farm addresses
  // already have stable IDs and visit history, so only add missing links.
  let parcelGeometry: { features: GeoJSON.Feature[] } | null = null;
  const { count: existingParcels, error: parcelCountError } = await db.from('campaign_parcels')
    .select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (parcelCountError) throw parcelCountError;
  // Parcel preparation replaces rows; do not replace parcels on an existing farm.
  if (isParcelRegionSupported(region) && existingParcels === 0) {
    const preparation = await new ParcelEnrichmentService(db).prepareParcelsForProvision(campaignId);
    if (preparation.status === 'ready') {
      parcelGeometry = { features: preparation.parcels.map(parcel => ({
        type: 'Feature' as const, geometry: parcel.geometry,
        properties: { ...parcel.properties, external_id: parcel.externalId, parcel_id: parcel.externalId },
      })) };
    } else {
      console.warn('[farm map] Parcel source unavailable:', preparation.error ?? preparation.status);
    }
  }
  const bundle = await prebuildCampaignMapBundle(db, campaignId);
  const buildings = bundle.buildings as unknown as { features: BuildingFeature[] };
  const parcelCount = parcelGeometry?.features.length ?? bundle.parcels?.features.length ?? 0;
  if (!buildings.features.length && !parcelCount) throw new Error('Farm map has no buildings or parcels available.');
  // A parcel-only farm is a valid starting point for manual field collection.
  if (buildings.features.length) await new StableLinkerService(db).runSpatialJoin(campaignId, buildings,
    snapshot.metadata?.overture_release ?? '2026-01-21.0', {
      persistenceMode: 'silver', preserveExisting: true,
      parcelsGeoJSON: (parcelGeometry ?? bundle.parcels) as NonNullable<Parameters<StableLinkerService['runSpatialJoin']>[3]>['parcelsGeoJSON'],
    });
  await prebuildCampaignMapBundle(db, campaignId, undefined, { forceRebuild: true });
  const readyAt = new Date().toISOString();
  const { error: readyError } = await db.from('campaigns').update({
    provision_status: 'ready', provision_phase: 'optimized', provisioned_at: readyAt,
    addresses_ready_at: readyAt, map_ready_at: readyAt, optimized_at: readyAt,
    provision_error: null, provision_message: null,
  }).eq('id', campaignId);
  if (readyError) throw readyError;
  return campaignId;
}
