import * as turf from '@turf/turf';
import RBush from 'rbush';

type Feature = GeoJSON.Feature;
type PolygonFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
export type ParcelPinPlacement = {
  addressId: string;
  parcelId: string;
  buildingId: string | null;
  coordinate: [number, number];
  method: 'parcel_center' | 'building_centroid' | 'building_parcel_centroid';
};
const text = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function buildingIdentifiers(feature: Feature): string[] {
  const p = feature.properties ?? {};
  return [...new Set([p.canonical_building_id, p.public_building_id, p.building_id, p.gers_id, p.id, feature.id].map(text).filter(Boolean))];
}
export function isAccessoryBuilding(feature: Feature): boolean {
  const p = feature.properties ?? {};
  const markers = [p.building, p.building_type, p.building_subtype, p.subtype, p.class, p.subclass, p.use, p.feature_type, p.resolution_type];
  return p.is_accessory === true || p.is_auxiliary === true || markers.some(value =>
    /(^|[\s_\-;])(garage|garages|carport|shed|sheds|outbuilding|accessory|auxiliary)([\s_\-;]|$)/.test(text(value)));
}
function polygon(feature: Feature): feature is PolygonFeature {
  return feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon';
}
export function interiorCentroid(feature: PolygonFeature): [number, number] {
  // centerOfMass is area weighted; vertex averaging is biased by detailed edges.
  const center = turf.centerOfMass(feature);
  return (turf.booleanPointInPolygon(center, feature) ? center : turf.pointOnFeature(feature)).geometry.coordinates as [number, number];
}
function movable(feature: Feature): boolean {
  const p = feature.properties ?? {};
  return ![p.source, p.feature_type].some(v => ['manual', 'field_manual_pin', 'manual_pin', 'manual_fallback'].includes(text(v))) &&
    p.user_confirmed !== true && p.locked !== true;
}

/** Shared render placement. Input parcel ownership must already be authoritative.
 * Never infer ownership from the nearest parcel, or primary use from footprint size.
 */
export function planParcelPinPlacements(input: {
  addresses: Feature[];
  buildings: Feature[];
  parcels: Feature[];
  protectedAddressIds?: Set<string>;
}): ParcelPinPlacement[] {
  const parcels = new Map(input.parcels.filter(polygon).map(p => [text(p.properties?.parcel_id ?? p.properties?.external_id ?? p.id), p]));
  const byAlias = new Map<string, PolygonFeature>();
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; feature: PolygonFeature }>();
  for (const building of input.buildings) {
    if (!polygon(building) || isAccessoryBuilding(building)) continue;
    const p = building.properties ?? {};
    if (['address_proxy', 'field_manual_pin', 'manual_pin'].includes(text(p.source)) ||
        ['commercial', 'industrial', 'retail', 'warehouse', 'parking'].includes(text(p.building ?? p.building_type))) continue;
    try {
      const [minX, minY, maxX, maxY] = turf.bbox(building);
      if (![minX, minY, maxX, maxY].every(Number.isFinite) || turf.area(building) < 30) continue;
      tree.insert({ minX, minY, maxX, maxY, feature: building });
      for (const alias of buildingIdentifiers(building)) byAlias.set(alias, building);
    } catch { /* Invalid footprints cannot support automatic placement. */ }
  }
  const groups = new Map<string, Feature[]>();
  for (const address of input.addresses) {
    const parcel = text(address.properties?.parcel_id);
    if (parcel) groups.set(parcel, [...(groups.get(parcel) ?? []), address]);
  }
  const placements: ParcelPinPlacement[] = [];
  for (const [parcelId, addresses] of groups) {
    const parcel = parcels.get(parcelId);
    // Shared parcels need a unit layout; never collapse sibling addresses.
    if (!parcel || addresses.length !== 1) continue;
    const address = addresses[0];
    const p = address.properties ?? {};
    const addressId = text(p.address_id ?? p.id ?? address.id);
    if (!addressId || !movable(address) || input.protectedAddressIds?.has(addressId)) continue;
    try {
      // Geometry-backed parcel stops represent the property, not a chosen roof.
      // Ordinary civic/unit addresses continue through the existing placement rules.
      if (p.geometry_target_kind === 'parcel' && text(p.geometry_target_id) === parcelId) {
        placements.push({ addressId, parcelId, buildingId: null, coordinate: interiorCentroid(parcel), method: 'parcel_center' });
        continue;
      }
      const [minX, minY, maxX, maxY] = turf.bbox(parcel);
      const candidates = tree.search({ minX, minY, maxX, maxY }).flatMap(({ feature }) => {
        const intersection = turf.intersect(turf.featureCollection([parcel, feature]));
        // Ignore slivers at parcel seams. A townhouse portion may be a small
        // fraction of the whole row, but must occupy meaningful parcel area.
        if (!intersection || turf.area(intersection) < 10 || turf.area(intersection) / Math.min(turf.area(parcel), turf.area(feature)) < 0.1) return [];
        return [{ feature, intersection }];
      });
      const linkedId = text(p.building_gers_id ?? p.linked_building_id ?? p.building_id);
      const linked = linkedId ? byAlias.get(linkedId) : null;
      // Never substitute another footprint for an existing association. A
      // missing footprint can still use parcel-only placement when no eligible
      // replacement exists; the original building link remains untouched.
      const winner = linkedId ? candidates.find(c => c.feature === linked) : candidates.length === 1 ? candidates[0] : null;
      if (linkedId && !winner && (linked || candidates.length > 0)) continue;
      if (!winner && candidates.length > 0) continue;
      if (winner) {
        const whole = turf.area(winner.intersection) / turf.area(winner.feature) >= 0.98;
        const coordinate = interiorCentroid(whole ? winner.feature : winner.intersection);
        // Even a mostly-contained building can have its centroid outside an
        // irregular parcel. The intersection is always the final boundary.
        const safeCoordinate = turf.booleanPointInPolygon(coordinate, winner.intersection)
          ? coordinate : interiorCentroid(winner.intersection);
        placements.push({ addressId, parcelId, buildingId: buildingIdentifiers(winner.feature)[0] ?? null,
          coordinate: safeCoordinate, method: whole ? 'building_centroid' : 'building_parcel_centroid' });
      } else {
        placements.push({ addressId, parcelId, buildingId: null, coordinate: interiorCentroid(parcel), method: 'parcel_center' });
      }
    } catch { /* Ambiguous or invalid geometry remains unchanged. */ }
  }
  return placements;
}

export function applyParcelPinPlacements(collection: GeoJSON.FeatureCollection, placements: ParcelPinPlacement[]): GeoJSON.FeatureCollection {
  const byAddress = new Map(placements.map(p => [p.addressId, p]));
  return { ...collection, features: collection.features.map(feature => {
    const p = feature.properties ?? {};
    const placement = byAddress.get(text(p.address_id ?? p.id ?? feature.id));
    if (!placement || feature.geometry?.type !== 'Point') return feature;
    return { ...feature, geometry: { type: 'Point' as const, coordinates: placement.coordinate }, properties: {
      ...p,
      source_geometry: p.source_geometry ?? feature.geometry,
      pin_placement: placement.method,
      pin_building_id: placement.buildingId,
      label_anchor_lon: placement.coordinate[0], label_anchor_lat: placement.coordinate[1],
      coordinate: { longitude: placement.coordinate[0], latitude: placement.coordinate[1], lon: placement.coordinate[0], lat: placement.coordinate[1] },
    } };
  }) };
}

/** Ordered results with bounded provider concurrency. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(limit))) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}
