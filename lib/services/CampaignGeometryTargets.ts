import * as turf from '@turf/turf';
import RBush from 'rbush';
import { buildingIdentifiers, interiorCentroid, isAccessoryBuilding } from './ParcelPinPlacement';
import { isDisplayableParcelFeature, isResidentialParcelFeature } from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';

type PolygonFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
export type GeometryTarget = {
  key: string;
  kind: 'building' | 'parcel';
  geometryId: string;
  geometry: PolygonFeature['geometry'];
  coordinate: [number, number];
  houseNumber: string | null;
  streetName: string | null;
  locality: string | null;
  postalCode: string | null;
};
export type ExistingTargetAddress = {
  id: string;
  coordinate?: unknown;
  gers_id?: string | null;
  building_gers_id?: string | null;
};
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() :
  typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
const field = (p: GeoJSON.GeoJsonProperties, ...keys: string[]) => keys.map(k => text(p?.[k])).find(Boolean) ?? null;
const polygon = (f: GeoJSON.Feature): f is PolygonFeature => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type);
function indexed<T extends GeoJSON.Feature>(feature: T) {
  const [minX, minY, maxX, maxY] = turf.bbox(feature);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('Invalid target bounds');
  return { minX, minY, maxX, maxY, feature };
}
export function isEligibleTargetBuilding(f: PolygonFeature): boolean {
  const p = f.properties ?? {};
  const types = [p.building, p.building_type, p.subtype, p.class, p.subclass, p.use, p.type].join(' ').toLowerCase();
  return !isAccessoryBuilding(f) && turf.area(f) >= 30 &&
    !/\b(garage|shed|barn|storage|utility|industrial|commercial|retail|warehouse|school|church|parking)\b/.test(types) &&
    !['address_proxy', 'field_manual_pin', 'manual_pin'].includes(String(p.source));
}
function addressPoint(row: ExistingTargetAddress): GeoJSON.Feature<GeoJSON.Point> | null {
  let c = row.coordinate;
  try { if (typeof c === 'string') c = JSON.parse(c); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const value = c as { lat?: unknown; lon?: unknown; lng?: unknown; coordinates?: unknown[] };
  const lon = value.lon ?? value.lng ?? value.coordinates?.[0];
  const lat = value.lat ?? value.coordinates?.[1];
  if (lon == null || lat == null || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return null;
  return turf.point([Number(lon), Number(lat)], { id: row.id });
}

/** Add only uncovered properties. Never replace existing civic/unit addresses.
 * Geometry identity is independent of labels, order, and the address provider. */
export function planGeometryTargets(input: {
  buildings: GeoJSON.Feature[];
  parcels: GeoJSON.Feature[];
  boundary: GeoJSON.Polygon;
  existing: ExistingTargetAddress[];
  limit: number;
}): GeometryTarget[] {
  const addressTree = new RBush<ReturnType<typeof indexed<GeoJSON.Feature<GeoJSON.Point>>>>();
  addressTree.load(input.existing.flatMap(a => { const p = addressPoint(a); return p ? [indexed(p)] : []; }));
  const occupied = (f: PolygonFeature) => addressTree.search(indexed(f))
    .some(a => turf.booleanPointInPolygon(a.feature, f));
  const knownBuildings = new Set(input.existing.flatMap(a => [a.building_gers_id,
    a.gers_id?.includes(':building-proxy:') ? a.gers_id.split(':building-proxy:')[1] : null,
    a.gers_id?.startsWith('synthetic:geometry-target:building:') ? a.gers_id.slice('synthetic:geometry-target:building:'.length) : null,
  ].filter((id): id is string => Boolean(id)).map(id => id.toLowerCase())));
  const knownKeys = new Set(input.existing.map(a => a.gers_id));
  const buildings = input.buildings.filter(polygon);
  const buildingTree = new RBush<ReturnType<typeof indexed<PolygonFeature>>>();
  for (const building of buildings) {
    try { buildingTree.insert(indexed(building)); } catch { /* malformed geometry cannot create a stop */ }
  }
  // Reserve a nearby roof for an existing road-offset point before generating
  // stops. This does not move or link the source point; the canonical linker
  // still owns that decision. Ambiguous close roofs are left for review.
  for (const entry of addressTree.all()) {
    const [lon, lat] = entry.feature.geometry.coordinates;
    const dy = 12 / 111_320;
    const dx = dy / Math.max(.1, Math.cos(lat * Math.PI / 180));
    const candidates = buildingTree.search({ minX: lon-dx, maxX: lon+dx, minY: lat-dy, maxY: lat+dy })
      .flatMap(({feature}) => {
        try {
          if (!isEligibleTargetBuilding(feature)) return [];
          let distance = turf.booleanPointInPolygon(entry.feature, feature) ? 0 : Infinity;
          if (distance !== 0) turf.segmentEach(turf.polygonToLine(feature), segment => {
            if (segment) distance = Math.min(distance, turf.pointToLineDistance(entry.feature, segment, { units: 'meters' }));
          });
          return distance <= 12 ? [{feature,distance}] : [];
        } catch { return []; }
      }).sort((a,b) => a.distance-b.distance);
    if (candidates.length) {
      const nearest = candidates[0].distance;
      for (const candidate of candidates.filter(c => nearest === 0 ? c.distance === 0 : c.distance <= nearest + 3)) {
        buildingIdentifiers(candidate.feature).forEach(id => knownBuildings.add(id));
      }
    }
  }
  const parcels = input.parcels.filter(polygon).filter(p => isDisplayableParcelFeature(p) && isResidentialParcelFeature(p));
  const parcelTree = new RBush<ReturnType<typeof indexed<PolygonFeature>>>();
  for (const parcel of parcels) {
    try { parcelTree.insert(indexed(parcel)); } catch { /* malformed source parcel */ }
  }
  const targets: GeometryTarget[] = [];
  const seen = new Set<string>();
  const add = (f: PolygonFeature, kind: GeometryTarget['kind'], id: string, attributes = f.properties) => {
    const key = `synthetic:geometry-target:${kind}:${id}`;
    if (seen.has(key) || knownKeys.has(key) || targets.length >= input.limit) return;
    const coordinate = interiorCentroid(f);
    // Map geometry includes a display buffer; buffered neighbours are not stops.
    if (!turf.booleanPointInPolygon(coordinate, input.boundary)) return;
    seen.add(key);
    targets.push({ key, kind, geometryId: id, geometry: f.geometry, coordinate,
      houseNumber: field(attributes, 'house_number', 'street_number', 'addr:housenumber'),
      streetName: field(attributes, 'street_name', 'road_name', 'addr:street'),
      locality: field(attributes, 'locality', 'city', 'municipality'),
      postalCode: field(attributes, 'postal_code', 'postcode'),
    });
  };
  // Parcels own new geometry stops. Existing addresses and legacy building
  // stops remain authoritative; never collapse their units or field history.
  const parcelId = (p: PolygonFeature) => field(p.properties, 'parcel_id', 'external_id', 'id') ?? text(p.id);
  for (const parcel of [...parcels].sort((a,b) => String(parcelId(a)).localeCompare(String(parcelId(b))))) {
    try {
      const id = parcelId(parcel);
      if (!id || occupied(parcel)) continue;
      const children = buildingTree.search(indexed(parcel)).map(b => b.feature)
        .filter(b => turf.booleanPointInPolygon(interiorCentroid(b), parcel));
      if (children.some(b => buildingIdentifiers(b).some(id => knownBuildings.has(id)))) continue;
      const eligible = children.filter(isEligibleTargetBuilding);
      const p = parcel.properties ?? {};
      const use = [p.land_use, p.landuse, p.use, p.property_type, p.parcel_intent, p.description, p.usedesc, p.use_description].join(' ').toLowerCase();
      if (/\b(hospital|industrial|commercial|school|church|cemetery|warehouse)\b/.test(use)) continue;
      if (!eligible.length) {
        // Empty/unknown land and accessory-only parcels do not become doors.
        if (children.length || /\b(vacant|undeveloped|agricultural|forest)\b/.test(use)) continue;
        if (!/\b(residential|residence|dwelling|house|single family|multi family)\b/.test(use) &&
            !(field(p, 'house_number', 'street_number', 'addr:housenumber') && field(p, 'street_name', 'road_name', 'addr:street'))) continue;
      }
      add(parcel, 'parcel', id);
    } catch { /* malformed parcel */ }
  }
  // Building fallback is only for places without a usable parcel identity.
  // If a parcel center is outside the selection, don't replace it with several
  // building stops: parcel-based selection must stay consistent on retries.
  for (const building of [...buildings].sort((a,b) => (buildingIdentifiers(a)[0] ?? '').localeCompare(buildingIdentifiers(b)[0] ?? ''))) {
    try {
      const ids = buildingIdentifiers(building);
      if (!ids.length || !isEligibleTargetBuilding(building) || ids.some(id => knownBuildings.has(id)) || occupied(building)) continue;
      const owners = parcelTree.search(indexed(building)).map(p => p.feature)
        .filter(p => parcelId(p) && turf.booleanPointInPolygon(interiorCentroid(building), p));
      if (owners.length) continue;
      add(building, 'building', ids[0]);
    } catch { /* invalid geometry cannot create a stop */ }
  }
  return targets;
}
