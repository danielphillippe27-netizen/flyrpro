import { bbox, booleanPointInPolygon } from '@turf/turf';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { BedrockCountryService, snapshotToCampaignSnapshotRow } from '@/lib/services/BedrockCountryService';
import { planGeometryTargets } from '@/lib/services/CampaignGeometryTargets';
import { MAX_CAMPAIGN_HOMES } from '@/lib/services/campaignHomeLimits';
import { resolveScopedCampaignMapGeometry } from '@/lib/services/CampaignMapBundlePrebuilder';
import { mapWithConcurrency } from '@/lib/services/ParcelPinPlacement';
import { partitionStormCampaigns } from './campaign-partitions';
import { stormNeedsTerritoryOverlay } from './campaign-policy';

export type StormCampaignPreview = {
  status: 'ready';
  total: number;
  pendingParcelStops: number;
  addressedParcelStops: number;
  buildingStops: number;
  campaignCount: number;
} | {
  status: 'no-mapped-addresses' | 'territory-only' | 'unavailable';
};

const PREVIEW_SCOPE = 'storm-campaign-preview';

export async function estimateStormCampaign(
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  addresses: ReadonlyMap<string, StandardCampaignAddress>,
  coverage: { partial: boolean; primaryRegion: string },
  service: BedrockCountryService,
): Promise<StormCampaignPreview> {
  if (coverage.partial) return { status: 'unavailable' };
  if (stormNeedsTerritoryOverlay(addresses.size)) return { status: 'territory-only' };
  if (addresses.size === 0) return { status: 'no-mapped-addresses' };

  const pins = [...addresses].map(([id, address]) => ({
    id,
    lon: Number(address.lon ?? address.coordinate?.lon),
    lat: Number(address.lat ?? address.coordinate?.lat),
    gers_id: address.gers_id,
  }));
  if (pins.some(pin => !Number.isFinite(pin.lon) || !Number.isFinite(pin.lat))) return { status: 'unavailable' };

  const contains = (pin: typeof pins[number], polygon: GeoJSON.Polygon) =>
    booleanPointInPolygon([pin.lon, pin.lat], polygon);
  const polygons: GeoJSON.Polygon[] = boundary.type === 'Polygon'
    ? [boundary]
    : boundary.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }));
  const parts = polygons.flatMap(polygon => {
    const inside = pins.filter(pin => contains(pin, polygon));
    return inside.length ? partitionStormCampaigns(polygon, inside) : [];
  });
  // The planner accepts at most 4,000 addresses and the scan bounds the number
  // of connected polygons. Reject ambiguous duplicate or out-of-boundary pins.
  if (parts.reduce((sum, part) => sum + part.addressCount, 0) !== addresses.size) {
    return { status: 'unavailable' };
  }

  const stops = await mapWithConcurrency(parts, 2, async part => {
    const limit = MAX_CAMPAIGN_HOMES - part.addressCount;
    if (limit <= 0) return [];
    const resolution = part.boundary === boundary ? null : await resolveCampaignRegion({ polygon: part.boundary });
    if (resolution?.source === 'default') throw new Error('The campaign region could not be estimated.');
    const snapshot = await service.staticSnapshotForCampaign(PREVIEW_SCOPE, resolution?.regionCode ?? coverage.primaryRegion);
    const geometry = await resolveScopedCampaignMapGeometry({
      campaignId: PREVIEW_SCOPE,
      snapshot: snapshotToCampaignSnapshotRow(snapshot),
      campaignRow: { bbox: bbox(part.boundary), territory_boundary: part.boundary },
      failOnReadError: true,
    });

    // The real campaign first links source addresses to roofs. Before Save we
    // can apply the same target planner to source points and their nearby roofs.
    return planGeometryTargets({
      boundary: part.boundary,
      buildings: geometry.buildings?.features ?? [],
      parcels: geometry.parcels?.features ?? [],
      existing: pins.filter(pin => contains(pin, part.boundary)).map(pin => ({
        id: pin.id,
        coordinate: { lon: pin.lon, lat: pin.lat },
        gers_id: pin.gers_id,
      })),
      limit,
    });
  });

  const geometryStops = stops.flat();
  const pendingParcelStops = geometryStops.filter(stop => stop.kind === 'parcel' && !(stop.houseNumber && stop.streetName)).length;
  const buildingStops = geometryStops.filter(stop => stop.kind === 'building').length;
  return {
    status: 'ready',
    total: addresses.size + geometryStops.length,
    pendingParcelStops,
    addressedParcelStops: geometryStops.length - pendingParcelStops - buildingStops,
    buildingStops,
    campaignCount: parts.length,
  };
}
