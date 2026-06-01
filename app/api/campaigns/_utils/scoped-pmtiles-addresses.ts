import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';
import Pbf from 'pbf';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { type CampaignSnapshotRow, resolveArtifactUrl } from '@/lib/diamond/geometry';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';

export type ScopedAddressMetric = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  polygonCandidates: number;
  normalizedCandidates: number;
  canonicalAddresses: number;
  dedupedCandidates: number;
  addressLimitApplied: boolean;
  seconds: number;
  queryEngine: string;
  touchedTiles: number;
  partitioning?: string;
  tilePadding?: number;
  timings: Record<string, number | string | boolean | undefined>;
};

export type ScopedAddressResult = {
  addresses: StandardCampaignAddress[];
  metric: ScopedAddressMetric;
};

export type ScopedAddressNormalizerInput = {
  campaignId: string;
  feature: GeoJSON.Feature;
  lon: number;
  lat: number;
};

type AddressCandidate = {
  tileIndex: number;
  layerIndex: number;
  featureIndex: number;
  address: StandardCampaignAddress;
};

type TileRange = {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const WEB_MERCATOR_MAX_LAT = 85.05112878;
const ADDRESS_TILE_FETCH_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.PMTILES_ADDRESS_TILE_FETCH_CONCURRENCY))
    ? Number(process.env.PMTILES_ADDRESS_TILE_FETCH_CONCURRENCY)
    : 12
);
const PMTILES_ADDRESS_TILE_LIMIT = Math.max(
  64,
  Number.isFinite(Number(process.env.PMTILES_ADDRESS_TILE_LIMIT))
    ? Number(process.env.PMTILES_ADDRESS_TILE_LIMIT)
    : 2048
);

function elapsedMs(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectMetric(metrics: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = metrics?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function addressPmtilesKey(snapshot: CampaignSnapshotRow | null, explicitKey?: string | null) {
  return explicitKey ??
    stringMetric(snapshot?.tile_metrics, 'addresses_pmtiles_key') ??
    (snapshot?.addresses_key?.endsWith('.pmtiles') ? snapshot.addresses_key : null);
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const clampedLat = Math.max(Math.min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

export function tileRangeForAddressBbox(
  bbox: [number, number, number, number],
  maxZoom: number,
  minZoom = 10,
  tileLimit = PMTILES_ADDRESS_TILE_LIMIT
): TileRange | null {
  const highestZoom = Math.min(Math.max(maxZoom, minZoom), 18);
  const lowestZoom = Math.min(highestZoom, Math.max(0, minZoom));
  for (let z = highestZoom; z >= lowestZoom; z -= 1) {
    const nw = lonLatToTile(bbox[0], bbox[3], z);
    const se = lonLatToTile(bbox[2], bbox[1], z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= tileLimit || z === lowestZoom) {
      return { z, minX, maxX, minY, maxY };
    }
  }
  return null;
}

function tileCoordsForRange(range: TileRange) {
  const coords: Array<{ x: number; y: number; tileIndex: number }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      coords.push({ x, y, tileIndex: coords.length });
    }
  }
  return coords;
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function flattenPositions(geometry: GeoJSON.Geometry | null | undefined): Array<[number, number]> {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates as [number, number]];
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    return geometry.coordinates as Array<[number, number]>;
  }
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    return geometry.coordinates.flat() as Array<[number, number]>;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat(2) as Array<[number, number]>;
  }
  return [];
}

function geometryCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const positions = flattenPositions(geometry).filter(
    (position) => Number.isFinite(position[0]) && Number.isFinite(position[1])
  );
  if (positions.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function uniqueSourceLayers(...layers: Array<string | null | undefined>) {
  return Array.from(new Set(layers.map((layer) => layer?.trim()).filter((layer): layer is string => Boolean(layer))));
}

function firstPoint(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    return geometry.coordinates[0] as [number, number];
  }
  return geometryCenter(geometry);
}

function compareAddressCandidates(a: AddressCandidate, b: AddressCandidate) {
  const formattedDelta = a.address.formatted.localeCompare(b.address.formatted);
  if (formattedDelta !== 0) return formattedDelta;
  const lonDelta = Number(a.address.lon ?? 0) - Number(b.address.lon ?? 0);
  if (lonDelta !== 0) return lonDelta;
  const latDelta = Number(a.address.lat ?? 0) - Number(b.address.lat ?? 0);
  if (latDelta !== 0) return latDelta;
  return a.tileIndex - b.tileIndex || a.layerIndex - b.layerIndex || a.featureIndex - b.featureIndex;
}

export function normalizePmtilesAddressFeature(input: {
  campaignId: string;
  feature: GeoJSON.Feature;
  lon: number;
  lat: number;
  source: StandardCampaignAddress['source'];
  fallbackRegion?: string | null;
  defaultSource?: string;
  idPrefix?: string;
}): StandardCampaignAddress | null {
  const properties = (input.feature.properties ?? {}) as Record<string, unknown>;
  const addressId =
    stringValue(properties.address_id) ??
    stringValue(properties.address_detail_pid) ??
    stringValue(properties.source_id) ??
    stringValue(properties.gers_id) ??
    stringValue(properties.id) ??
    (typeof input.feature.id === 'string' || typeof input.feature.id === 'number' ? String(input.feature.id) : undefined);
  const houseNumber =
    stringValue(properties.house_number) ??
    stringValue(properties.house_number_label) ??
    stringValue(properties.number) ??
    stringValue(properties.street_number) ??
    stringValue(properties.number_first);
  const streetType = stringValue(properties.street_type);
  const streetNameBase =
    stringValue(properties.street_name) ??
    stringValue(properties.street) ??
    stringValue(properties.road_name);
  const streetName = [streetNameBase, streetType].filter(Boolean).join(' ') || undefined;
  const locality =
    stringValue(properties.locality) ??
    stringValue(properties.locality_name) ??
    stringValue(properties.city) ??
    stringValue(properties.municipality);
  const formatted =
    stringValue(properties.formatted) ??
    stringValue(properties.full_address) ??
    stringValue(properties.address) ??
    stringValue(properties.label) ??
    ([houseNumber, streetName, locality].filter(Boolean).join(' ') || `${input.defaultSource ?? 'Address'} ${addressId ?? `${input.lon},${input.lat}`}`);
  const region =
    stringValue(properties.region) ??
    stringValue(properties.state) ??
    stringValue(properties.province) ??
    input.fallbackRegion ??
    null;
  const gersId = addressId
    ? `${input.idPrefix ?? input.source}:${addressId}`
    : null;

  return {
    campaign_id: input.campaignId,
    formatted,
    house_number: houseNumber,
    street_name: streetName,
    locality,
    region: region?.toUpperCase(),
    postal_code: stringValue(properties.postal_code) ?? stringValue(properties.postcode),
    coordinate: { lat: input.lat, lon: input.lon },
    lat: input.lat,
    lon: input.lon,
    geom: JSON.stringify({ type: 'Point', coordinates: [input.lon, input.lat] }),
    source: input.source,
    gers_id: gersId,
  };
}

export async function fetchScopedPmtilesAddresses(options: {
  campaignId: string;
  snapshot: CampaignSnapshotRow;
  bbox: [number, number, number, number];
  boundary: GeoJSON.Polygon;
  queryEngine: string;
  pmtilesKey?: string | null;
  sourceLayer?: string | null;
  sourceLayers?: string[];
  promoteId?: string | null;
  minZoom?: number | null;
  maxZoom?: number | null;
  addressLimit?: number;
  normalizeFeature: (input: ScopedAddressNormalizerInput) => StandardCampaignAddress | null;
}): Promise<ScopedAddressResult> {
  const startedAt = performance.now();
  const pmtilesKey = addressPmtilesKey(options.snapshot, options.pmtilesKey);
  if (!pmtilesKey) {
    throw new Error('PMTiles address artifact unavailable: missing addresses_pmtiles_key');
  }

  const sourceLayers = objectMetric(options.snapshot.tile_metrics, 'source_layers');
  const promoteIds = objectMetric(options.snapshot.tile_metrics, 'promote_ids');
  const promoteId =
    options.promoteId ??
    stringMetric(promoteIds, 'addresses') ??
    'address_id';
  const layerNames = uniqueSourceLayers(
    options.sourceLayer,
    ...(options.sourceLayers ?? []),
    stringMetric(sourceLayers, 'addresses'),
    stringMetric(sourceLayers, 'address_circles'),
    'addresses',
    'address_circles',
    'campaign_addresses'
  );

  const artifactStartedAt = performance.now();
  const archive = getCachedPmtilesArchive(await resolveArtifactUrl(options.snapshot, pmtilesKey));
  const artifactMs = elapsedMs(artifactStartedAt);
  const headerStartedAt = performance.now();
  const header = await archive.getHeader();
  const headerMs = elapsedMs(headerStartedAt);
  const rangeStartedAt = performance.now();
  const maxZoom = Math.min(header.maxZoom, options.maxZoom ?? numberMetric(options.snapshot.tile_metrics, 'address_maxzoom') ?? header.maxZoom);
  const minZoom = options.minZoom ?? numberMetric(options.snapshot.tile_metrics, 'address_minzoom') ?? header.minZoom;
  const range = tileRangeForAddressBbox(options.bbox, maxZoom, minZoom);
  const rangeMs = elapsedMs(rangeStartedAt);
  if (!range) {
    throw new Error('PMTiles address artifact unavailable: no tile range for campaign bbox');
  }

  const tileCoords = tileCoordsForRange(range);
  const tileStartedAt = performance.now();
  const byAddressId = new Map<string, AddressCandidate>();
  let scanned = 0;
  let bboxCandidates = 0;
  let polygonCandidates = 0;
  let normalizedCandidates = 0;
  let touchedTiles = 0;
  let layerHits = 0;

  await forEachWithConcurrency(tileCoords, ADDRESS_TILE_FETCH_CONCURRENCY, async ({ x, y, tileIndex }) => {
    const tile = await archive.getZxy(range.z, x, y);
    if (!tile) return;
    touchedTiles += 1;

    const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
    const layers = layerNames
      .map((sourceLayerName, layerIndex) => ({ layer: vectorTile.layers[sourceLayerName], layerIndex }))
      .filter((entry): entry is { layer: NonNullable<typeof entry.layer>; layerIndex: number } => Boolean(entry.layer));
    if (layers.length === 0) return;
    layerHits += layers.length;

    for (const { layer, layerIndex } of layers) {
      for (let index = 0; index < layer.length; index += 1) {
        scanned += 1;
        const feature = layer.feature(index).toGeoJSON(x, y, range.z) as GeoJSON.Feature;
        const point = firstPoint(feature.geometry as GeoJSON.Geometry | null | undefined);
        if (!point) continue;
        const [lon, lat] = point;
        if (lon < options.bbox[0] || lon > options.bbox[2] || lat < options.bbox[1] || lat > options.bbox[3]) continue;
        bboxCandidates += 1;
        if (!turf.booleanPointInPolygon(turf.point([lon, lat]), options.boundary)) continue;
        polygonCandidates += 1;

        const address = options.normalizeFeature({ campaignId: options.campaignId, feature, lon, lat });
        if (!address) continue;
        normalizedCandidates += 1;
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        const rawPromoteId = stringValue(properties[promoteId]);
        const dedupeKey = rawPromoteId ?? address.gers_id ?? `${address.formatted}:${lon}:${lat}`;
        const candidate = { tileIndex, layerIndex, featureIndex: index, address };
        const existing = byAddressId.get(dedupeKey);
        if (!existing || compareAddressCandidates(candidate, existing) < 0) {
          byAddressId.set(dedupeKey, candidate);
        }
      }
    }
  });

  if (layerHits === 0 || scanned === 0) {
    throw new Error(`PMTiles layer produced no usable features: ${layerNames.join(', ')}`);
  }

  const tileMs = elapsedMs(tileStartedAt);
  const canonicalCandidates = Array.from(byAddressId.values())
    .sort((a, b) => compareAddressCandidates(a, b))
    .map((entry) => entry.address);
  const addressLimit = options.addressLimit ?? Number.POSITIVE_INFINITY;
  const addresses = canonicalCandidates.slice(0, addressLimit);
  const canonicalAddresses = canonicalCandidates.length;
  const dedupedCandidates = Math.max(0, normalizedCandidates - canonicalAddresses);
  const addressLimitApplied = Number.isFinite(addressLimit) && canonicalAddresses > addressLimit;
  const totalMs = elapsedMs(startedAt);

  return {
    addresses,
    metric: {
      hits: addresses.length,
      scanned,
      bboxCandidates,
      polygonCandidates,
      normalizedCandidates,
      canonicalAddresses,
      dedupedCandidates,
      addressLimitApplied,
      seconds: Number((totalMs / 1000).toFixed(2)),
      queryEngine: options.queryEngine,
      touchedTiles,
      partitioning: 'web_mercator_xyz',
      tilePadding: 0,
      timings: {
        artifactMs,
        headerMs,
        rangeMs,
        tileMs,
        totalMs,
        tileCount: tileCoords.length,
        touchedTiles,
        layerHits,
        concurrency: ADDRESS_TILE_FETCH_CONCURRENCY,
        polygonCandidates,
        normalizedCandidates,
        canonicalAddresses,
        dedupedCandidates,
        addressLimitApplied,
      },
    },
  };
}
