import type MapboxDraw from '@mapbox/mapbox-gl-draw';

export type AssignmentSelectableAddress = {
  id: string;
  lat: number;
  lon: number;
};

function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [lon, lat] = point;
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentLon, currentLat] = ring[current];
    const [previousLon, previousLat] = ring[previous];
    const crosses =
      (currentLat > lat) !== (previousLat > lat) &&
      lon < ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat || Number.EPSILON) + currentLon;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoordinates(point: [number, number], coordinates: number[][][]): boolean {
  const [outerRing, ...holes] = coordinates;
  if (!outerRing || !pointInRing(point, outerRing)) return false;
  return holes.every((hole) => !pointInRing(point, hole));
}

export function addressInsideFeature(address: AssignmentSelectableAddress, feature: GeoJSON.Feature): boolean {
  if (!Number.isFinite(address.lon) || !Number.isFinite(address.lat)) return false;
  if (address.lon === 0 && address.lat === 0) return false;
  if (!feature.geometry) return false;

  const point: [number, number] = [address.lon, address.lat];
  if (feature.geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(point, feature.geometry.coordinates);
  }
  if (feature.geometry.type === 'MultiPolygon') {
    return feature.geometry.coordinates.some((coordinates) => pointInPolygonCoordinates(point, coordinates));
  }
  return false;
}

export function selectedAddressIdsFromFeatures(
  features: GeoJSON.Feature[],
  addresses: AssignmentSelectableAddress[]
): string[] {
  const polygonFeatures = features.filter((feature) =>
    feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
  );
  if (polygonFeatures.length === 0) return [];

  return addresses
    .filter((address) => polygonFeatures.some((feature) => addressInsideFeature(address, feature)))
    .map((address) => address.id);
}

export function selectedAddressIdsFromDraw(
  draw: MapboxDraw,
  addresses: AssignmentSelectableAddress[]
): string[] {
  return selectedAddressIdsFromFeatures(draw.getAll().features, addresses);
}
