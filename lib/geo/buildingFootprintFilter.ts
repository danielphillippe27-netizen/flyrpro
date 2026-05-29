export const MIN_LINKABLE_BUILDING_AREA_SQM = 45;

export const NON_LINKABLE_BUILDING_TYPES = new Set([
  'shed',
  'garage',
  'garages',
  'carport',
  'parking',
  'parking_garage',
  'outbuilding',
  'accessory',
  'ancillary',
]);

type FeatureLike = {
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
  properties?: Record<string, unknown> | null;
};

type BuildingLike = {
  area_sqm?: unknown;
  area?: unknown;
  building_type?: unknown;
  subtype?: unknown;
  class?: unknown;
  type?: unknown;
};

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizedTypeValues(value: BuildingLike | FeatureLike): string[] {
  const source = 'properties' in value && value.properties
    ? value.properties
    : value as Record<string, unknown>;
  return [
    stringValue(source.building_type),
    stringValue(source.subtype),
    stringValue(source.class),
    stringValue(source.type),
  ]
    .map((entry) => entry?.toLowerCase())
    .filter((entry): entry is string => Boolean(entry));
}

export function hasNonLinkableBuildingType(value: BuildingLike | FeatureLike): boolean {
  return normalizedTypeValues(value).some((type) => NON_LINKABLE_BUILDING_TYPES.has(type));
}

function ringAreaSqm(ring: unknown): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;

  const points = ring
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { lon, lat };
    })
    .filter((point): point is { lon: number; lat: number } => Boolean(point));

  if (points.length < 4) return 0;

  const avgLatRad = (points.reduce((sum, point) => sum + point.lat, 0) / points.length) * Math.PI / 180;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(Math.cos(avgLatRad), 0.01) * 111_320;
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (current.lon * metersPerDegreeLon) * (next.lat * metersPerDegreeLat);
    area -= (next.lon * metersPerDegreeLon) * (current.lat * metersPerDegreeLat);
  }

  return Math.abs(area) / 2;
}

function polygonAreaSqm(coordinates: unknown): number {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return 0;
  const [outer, ...holes] = coordinates;
  const outerArea = ringAreaSqm(outer);
  const holeArea = holes.reduce((sum, hole) => sum + ringAreaSqm(hole), 0);
  return Math.max(outerArea - holeArea, 0);
}

export function featureGeometryAreaSqm(feature: FeatureLike): number | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  if (geometry.type === 'Polygon') {
    return polygonAreaSqm(geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSqm(polygon), 0);
  }

  return null;
}

export function buildingAreaSqm(value: BuildingLike | FeatureLike): number | null {
  const source = 'properties' in value && value.properties
    ? value.properties
    : value as Record<string, unknown>;
  return (
    numberValue(source.area_sqm) ??
    numberValue(source.area) ??
    ('geometry' in value ? featureGeometryAreaSqm(value) : null)
  );
}

export function isLinkableBuildingFootprint(
  value: BuildingLike | FeatureLike,
  options: { minAreaSqm?: number; allowManual?: boolean } = {}
): boolean {
  const area = buildingAreaSqm(value);
  const minAreaSqm = options.minAreaSqm ?? MIN_LINKABLE_BUILDING_AREA_SQM;
  return area == null || area >= minAreaSqm;
}

export function filterLinkableBuildingFootprints<T extends BuildingLike | FeatureLike>(
  values: T[],
  options: { minAreaSqm?: number; allowManual?: boolean } = {}
): T[] {
  return values.filter((value) => isLinkableBuildingFootprint(value, options));
}
