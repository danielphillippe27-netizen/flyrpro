type RegionSource = 'campaign' | 'mapbox' | 'bbox' | 'default';
type RegionReason = 'missing' | 'legacy_on_default' | null;

interface Point {
  lng: number;
  lat: number;
}

export interface ResolveCampaignRegionInput {
  currentRegion?: unknown;
  polygon?: unknown;
  bbox?: unknown;
}

export interface ResolveCampaignRegionResult {
  regionCode: string;
  source: RegionSource;
  shouldPersist: boolean;
  reason: RegionReason;
  centroid: Point | null;
}

interface MapboxContext {
  short_code?: string;
  text?: string;
}

interface MapboxFeature {
  short_code?: string;
  text?: string;
  context?: MapboxContext[];
}

interface MapboxReverseResponse {
  features?: MapboxFeature[];
}

type Bounds = [number, number, number, number];

interface RegionBoundsRow {
  code: string;
  country: string;
  bbox: [number, number, number, number];
}

import regionBounds from '../../scripts/regions.json';

// Coarse province/territory bounds for fallback inference when Mapbox is unavailable.
const CANADA_REGION_BOUNDS: Record<string, Bounds> = {
  BC: [-139.06, 48.2, -114.03, 60.01],
  AB: [-120.0, 48.9, -109.0, 60.0],
  SK: [-110.0, 49.0, -101.3, 60.0],
  MB: [-102.0, 49.0, -89.0, 60.0],
  ON: [-95.2, 41.6, -74.0, 56.9],
  QC: [-79.9, 44.9, -57.1, 62.6],
  NB: [-69.1, 44.5, -63.5, 48.2],
  NS: [-66.5, 43.3, -59.7, 47.2],
  PE: [-64.6, 45.9, -61.8, 47.1],
  NL: [-67.9, 46.5, -52.5, 60.7],
  YT: [-141.1, 59.9, -123.8, 69.7],
  NT: [-136.5, 59.9, -102.0, 78.0],
  NU: [-110.0, 50.0, -60.0, 84.0],
};

const US_REGION_BOUNDS: Record<string, Bounds> = (regionBounds as RegionBoundsRow[])
  .filter((row) => row.country === 'US')
  .reduce<Record<string, Bounds>>((acc, row) => {
    const [minLng, minLat, maxLng, maxLat] = row.bbox;
    acc[row.code] = [minLng, minLat, maxLng, maxLat];
    return acc;
  }, {});

const REGION_NAME_TO_CODE: Record<string, string> = {
  'BRITISH COLUMBIA': 'BC',
  'ALBERTA': 'AB',
  'SASKATCHEWAN': 'SK',
  'MANITOBA': 'MB',
  'ONTARIO': 'ON',
  'QUEBEC': 'QC',
  'QUÉBEC': 'QC',
  'NEW BRUNSWICK': 'NB',
  'NOVA SCOTIA': 'NS',
  'PRINCE EDWARD ISLAND': 'PE',
  'NEWFOUNDLAND AND LABRADOR': 'NL',
  'YUKON': 'YT',
  'NORTHWEST TERRITORIES': 'NT',
  'NUNAVUT': 'NU',
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeRegionCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return null;
}

function parseShortCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const parts = upper.split('-');
  if (parts.length === 2 && /^[A-Z]{2}$/.test(parts[1])) {
    return parts[1];
  }
  return null;
}

function parseRegionName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return REGION_NAME_TO_CODE[value.trim().toUpperCase()] ?? null;
}

function toBBox(value: unknown): Bounds | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [minLng, minLat, maxLng, maxLat] = value;
  if (!isNumber(minLng) || !isNumber(minLat) || !isNumber(maxLng) || !isNumber(maxLat)) {
    return null;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function toPolygon(value: unknown): GeoJSON.Polygon | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 1) {
    return null;
  }

  const ring = candidate.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;

  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2 || !isNumber(pair[0]) || !isNumber(pair[1])) {
      return null;
    }
  }

  return candidate as GeoJSON.Polygon;
}

function centroidFromBBox([minLng, minLat, maxLng, maxLat]: Bounds): Point {
  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
  };
}

function centroidFromPolygon(polygon: GeoJSON.Polygon): Point | null {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
    return null;
  }

  return centroidFromBBox([minLng, minLat, maxLng, maxLat]);
}

function inferRegionFromBounds(point: Point): string | null {
  for (const [region, [minLng, minLat, maxLng, maxLat]] of Object.entries(CANADA_REGION_BOUNDS)) {
    if (point.lng >= minLng && point.lng <= maxLng && point.lat >= minLat && point.lat <= maxLat) {
      return region;
    }
  }

  for (const [region, [minLng, minLat, maxLng, maxLat]] of Object.entries(US_REGION_BOUNDS)) {
    if (point.lng >= minLng && point.lng <= maxLng && point.lat >= minLat && point.lat <= maxLat) {
      return region;
    }
  }

  return null;
}

async function inferRegionFromMapbox(point: Point): Promise<string | null> {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json` +
    `?types=region,country&limit=5&country=CA,US&access_token=${token}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = (await response.json()) as MapboxReverseResponse;
    const features = Array.isArray(data.features) ? data.features : [];

    for (const feature of features) {
      const featureCode = parseShortCode(feature.short_code) ?? parseRegionName(feature.text);
      if (featureCode) return featureCode;

      if (!Array.isArray(feature.context)) continue;
      for (const ctx of feature.context) {
        const ctxCode = parseShortCode(ctx.short_code) ?? parseRegionName(ctx.text);
        if (ctxCode) return ctxCode;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getCentroid(polygon: unknown, bbox: unknown): Point | null {
  const parsedPolygon = toPolygon(polygon);
  if (parsedPolygon) {
    const centroid = centroidFromPolygon(parsedPolygon);
    if (centroid) return centroid;
  }

  const parsedBBox = toBBox(bbox);
  if (parsedBBox) {
    return centroidFromBBox(parsedBBox);
  }

  return null;
}

export async function resolveCampaignRegion(
  input: ResolveCampaignRegionInput
): Promise<ResolveCampaignRegionResult> {
  const currentRegion = normalizeRegionCode(input.currentRegion);

  // Keep explicit non-default regions and avoid unnecessary lookups.
  if (currentRegion && currentRegion !== 'ON') {
    return {
      regionCode: currentRegion,
      source: 'campaign',
      shouldPersist: false,
      reason: null,
      centroid: null,
    };
  }

  const centroid = getCentroid(input.polygon, input.bbox);
  if (!centroid) {
    return {
      regionCode: currentRegion ?? 'ON',
      source: currentRegion ? 'campaign' : 'default',
      shouldPersist: false,
      reason: null,
      centroid: null,
    };
  }

  const mapboxRegion = await inferRegionFromMapbox(centroid);
  const bboxRegion = mapboxRegion ? null : inferRegionFromBounds(centroid);
  const inferredRegion = mapboxRegion ?? bboxRegion;
  const inferredSource: RegionSource = mapboxRegion ? 'mapbox' : 'bbox';

  if (!currentRegion) {
    return {
      regionCode: inferredRegion ?? 'ON',
      source: inferredRegion ? inferredSource : 'default',
      shouldPersist: !!inferredRegion,
      reason: inferredRegion ? 'missing' : null,
      centroid,
    };
  }

  if (currentRegion === 'ON' && inferredRegion && inferredRegion !== 'ON') {
    return {
      regionCode: inferredRegion,
      source: inferredSource,
      shouldPersist: true,
      reason: 'legacy_on_default',
      centroid,
    };
  }

  return {
    regionCode: currentRegion,
    source: 'campaign',
    shouldPersist: false,
    reason: null,
    centroid,
  };
}
