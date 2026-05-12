import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';
import { PMTiles } from 'pmtiles';
import Pbf from 'pbf';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';

type Bounds = [number, number, number, number];
type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

type DiamondCountry = 'canada' | 'usa' | 'south-africa';

type DiamondLayerManifest = {
  diamond_mode?: boolean;
  country?: string;
  region?: string;
  municipality?: string;
  layer?: string;
  geometry_url?: string;
  geojson_url?: string;
  tilejson_url?: string;
  source_layer?: string;
  promote_id?: string;
  bounds?: Bounds;
  minzoom?: number;
  maxzoom?: number;
  feature_count?: number;
};

type DiamondAddressFeature = {
  type: 'Feature';
  geometry?: {
    type: 'Point';
    coordinates?: [number, number];
  };
  properties?: Record<string, unknown>;
};

type DiamondCandidate = {
  country: DiamondCountry;
  region: string;
  municipality: string;
  addressManifestKey: string;
  buildingManifestKey: string;
  addressManifest: DiamondLayerManifest;
  buildingManifest: DiamondLayerManifest;
  area: number;
};

type DiamondParcelCandidate = {
  country: DiamondCountry;
  region: string;
  municipality: string;
  parcelManifestKey: string;
  parcelManifest: DiamondLayerManifest;
  area: number;
};

type DiamondScanMetric = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  seconds: number;
  queryEngine: 'municipal_diamond_pmtiles';
  municipality: string;
  touchedTiles: number;
};

const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const CANADA_REGIONS = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
]);
const US_STATES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
]);
const SOUTH_AFRICA_REGIONS = new Set([
  'EC',
  'FS',
  'GP',
  'KZN',
  'LP',
  'MP',
  'NC',
  'NW',
  'WC',
]);

let s3Client: S3Client | null = null;
const candidateCache = new Map<string, Promise<DiamondCandidate[]>>();
const parcelCandidateCache = new Map<string, Promise<DiamondParcelCandidate[]>>();

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: REGION,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined,
    });
  }
  return s3Client;
}

function bucket() {
  return process.env.DIAMOND_GEOMETRY_BUCKET || process.env.AWS_BUCKET_NAME || DEFAULT_BUCKET;
}

function cdnBaseUrl() {
  return (
    process.env.DIAMOND_GEOMETRY_CDN_BASE_URL ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    ''
  );
}

function artifactUrl(key: string) {
  const cdnBase = cdnBaseUrl().trim();
  if (cdnBase) return `${cdnBase.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
  return `s3://${bucket()}/${key}`;
}

function parseS3Key(value: string | null | undefined) {
  if (!value) return null;
  const s3Match = value.match(/^s3:\/\/([^/]+)\/(.+)$/i);
  if (s3Match) return s3Match[2];
  const cdnBase = cdnBaseUrl().trim();
  if (cdnBase && value.startsWith(cdnBase)) {
    return value.slice(cdnBase.length).replace(/^\/+/, '');
  }
  return value.replace(/^\/+/, '');
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCountry(regionCode: string | null | undefined): DiamondCountry | null {
  const region = regionCode?.trim().toUpperCase();
  if (!region) return null;
  if (CANADA_REGIONS.has(region)) return 'canada';
  if (US_STATES.has(region)) return 'usa';
  if (SOUTH_AFRICA_REGIONS.has(region)) return 'south-africa';
  return null;
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function boundsArea(bounds: Bounds) {
  return Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]);
}

async function s3Text(key: string) {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = response.Body;
  if (!body || typeof body !== 'object' || !('transformToString' in body)) {
    throw new Error(`Unable to read S3 object: ${key}`);
  }
  return (body as { transformToString: () => Promise<string> }).transformToString();
}

async function readJson<T>(key: string): Promise<T> {
  return JSON.parse(await s3Text(key)) as T;
}

async function tryReadJson<T>(key: string): Promise<T | null> {
  try {
    return await readJson<T>(key);
  } catch {
    return null;
  }
}

function manifestPmtilesKey(manifest: DiamondLayerManifest, layer: 'addresses' | 'buildings' | 'parcels') {
  return (
    parseS3Key(manifest.geometry_url) ??
    `diamond/${layer}/${manifest.country}/${manifest.region}/${manifest.municipality}/${layer}.pmtiles`
  );
}

function manifestGeojsonKey(manifest: DiamondLayerManifest, layer: 'addresses' | 'buildings' | 'parcels') {
  return (
    parseS3Key(manifest.geojson_url) ??
    manifestPmtilesKey(manifest, layer).replace(/\.pmtiles$/i, '.geojson.gz')
  );
}

function manifestTilejsonKey(manifest: DiamondLayerManifest, layer: 'addresses' | 'buildings' | 'parcels') {
  return (
    parseS3Key(manifest.tilejson_url) ??
    manifestPmtilesKey(manifest, layer).replace(/\.pmtiles$/i, '.json')
  );
}

async function listMunicipalCandidates(country: DiamondCountry, region: string) {
  const cacheKey = `${country}:${region}`;
  let cached = candidateCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const prefix = `diamond/addresses/${country}/${region.toLowerCase()}/`;
      const candidates: DiamondCandidate[] = [];
      let continuationToken: string | undefined;

      do {
        const response = await getS3Client().send(
          new ListObjectsV2Command({
            Bucket: bucket(),
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents ?? []) {
          const key = object.Key ?? '';
          const match = key.match(/^diamond\/addresses\/([^/]+)\/([^/]+)\/([^/]+)\/diamond-manifest\.json$/);
          if (!match) continue;

          const [, manifestCountry, manifestRegion, municipality] = match;
          const buildingManifestKey = `diamond/buildings/${manifestCountry}/${manifestRegion}/${municipality}/diamond-manifest.json`;
          const [addressManifest, buildingManifest] = await Promise.all([
            readJson<DiamondLayerManifest>(key),
            tryReadJson<DiamondLayerManifest>(buildingManifestKey),
          ]);
          if (!buildingManifest || !addressManifest.bounds || !buildingManifest.bounds) continue;

          candidates.push({
            country,
            region: manifestRegion,
            municipality,
            addressManifestKey: key,
            buildingManifestKey,
            addressManifest,
            buildingManifest,
            area: Math.min(boundsArea(addressManifest.bounds), boundsArea(buildingManifest.bounds)),
          });
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      return candidates.sort((a, b) => a.area - b.area);
    })();
    candidateCache.set(cacheKey, cached);
  }
  return cached;
}

async function listParcelCandidates(country: DiamondCountry, region: string) {
  const cacheKey = `${country}:${region}`;
  let cached = parcelCandidateCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const prefix = `diamond/parcels/${country}/${region.toLowerCase()}/`;
      const candidates: DiamondParcelCandidate[] = [];
      let continuationToken: string | undefined;

      do {
        const response = await getS3Client().send(
          new ListObjectsV2Command({
            Bucket: bucket(),
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents ?? []) {
          const key = object.Key ?? '';
          const match = key.match(/^diamond\/parcels\/([^/]+)\/([^/]+)\/([^/]+)\/diamond-manifest\.json$/);
          if (!match) continue;

          const [, , manifestRegion, municipality] = match;
          const parcelManifest = await tryReadJson<DiamondLayerManifest>(key);
          if (!parcelManifest?.bounds) continue;

          candidates.push({
            country,
            region: manifestRegion,
            municipality,
            parcelManifestKey: key,
            parcelManifest,
            area: boundsArea(parcelManifest.bounds),
          });
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      return candidates.sort((a, b) => a.area - b.area);
    })();
    parcelCandidateCache.set(cacheKey, cached);
  }
  return cached;
}

function normalizeDiamondAddress(
  campaignId: string,
  feature: DiamondAddressFeature,
  fallbackRegion: string
): StandardCampaignAddress | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = number(coordinates[0]);
  const lat = number(coordinates[1]);
  if (lat === undefined || lon === undefined) return null;

  const props = feature.properties ?? {};
  const addressId = text(props.address_id) ?? text(props.gers_id) ?? text(props.source_id);
  const houseNumber = text(props.house_number) ?? text(props.street_number);
  const streetName = text(props.street_name);
  const locality = text(props.locality) ?? text(props.city) ?? text(props.municipality);
  const formatted =
    text(props.full_address) ??
    text(props.formatted) ??
    text(props.label) ??
    [houseNumber, streetName, locality].filter(Boolean).join(' ');

  return {
    campaign_id: campaignId,
    formatted,
    house_number: houseNumber,
    street_name: streetName,
    locality,
    region: (text(props.province) ?? text(props.region) ?? fallbackRegion).toUpperCase(),
    postal_code: text(props.postal_code) ?? text(props.zip),
    coordinate: { lat, lon },
    lat,
    lon,
    geom: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }),
    source: 'diamond',
    gers_id: addressId ?? null,
  };
}

const WEB_MERCATOR_MAX_LAT = 85.05112878;

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

function tileRangeForBbox(bbox: Bounds, maxZoom: number, minZoom: number) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (let z = Math.min(maxZoom, 16); z >= Math.max(8, minZoom); z -= 1) {
    const nw = lonLatToTile(minLon, maxLat, z);
    const se = lonLatToTile(maxLon, minLat, z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= 96 || z === Math.max(8, minZoom)) {
      return { z, minX, maxX, minY, maxY, tileCount };
    }
  }
  return null;
}

function firstPoint(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    return geometry.coordinates[0] as [number, number];
  }
  return null;
}

async function loadScopedAddressesFromPmtiles(options: {
  campaignId: string;
  polygon: GeoJSON.Polygon;
  addressManifest: DiamondLayerManifest;
  regionCode: string;
  addressLimit?: number;
}): Promise<{ addresses: StandardCampaignAddress[]; scanned: number; bboxCandidates: number; touchedTiles: number }> {
  const bbox = turf.bbox(options.polygon) as Bounds;
  const pmtilesKey = manifestPmtilesKey(options.addressManifest, 'addresses');
  const archive = new PMTiles(artifactUrl(pmtilesKey));
  const header = await archive.getHeader();
  const range = tileRangeForBbox(
    bbox,
    Math.min(header.maxZoom, options.addressManifest.maxzoom ?? header.maxZoom),
    options.addressManifest.minzoom ?? 10
  );
  if (!range) return { addresses: [], scanned: 0, bboxCandidates: 0, touchedTiles: 0 };

  const addresses: StandardCampaignAddress[] = [];
  const byAddressId = new Map<string, StandardCampaignAddress>();
  let bboxCandidates = 0;
  let scanned = 0;
  let touchedTiles = 0;
  const sourceLayer = options.addressManifest.source_layer ?? 'addresses';

  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const tile = await archive.getZxy(range.z, x, y);
      if (!tile) continue;
      touchedTiles += 1;

      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layer = vectorTile.layers[sourceLayer] ?? vectorTile.layers.addresses ?? vectorTile.layers.address_circles;
      if (!layer) continue;

      for (let index = 0; index < layer.length; index += 1) {
        scanned += 1;
        const vectorFeature = layer.feature(index);
        const feature = vectorFeature.toGeoJSON(x, y, range.z) as DiamondAddressFeature;
        const point = firstPoint(feature.geometry as GeoJSON.Geometry | null | undefined);
        if (!point) continue;
        const [lon, lat] = point;
        if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
        bboxCandidates += 1;
        if (!turf.booleanPointInPolygon(turf.point([lon, lat]), options.polygon)) continue;

        const normalized = normalizeDiamondAddress(options.campaignId, feature, options.regionCode);
        if (!normalized) continue;
        const dedupeKey = normalized.gers_id ?? `${normalized.formatted}:${lon}:${lat}`;
        if (!byAddressId.has(dedupeKey)) {
          byAddressId.set(dedupeKey, normalized);
          addresses.push(normalized);
        }
        if (options.addressLimit && addresses.length >= options.addressLimit) {
          return { addresses, scanned, bboxCandidates, touchedTiles };
        }
      }
    }
  }

  return {
    addresses,
    scanned,
    bboxCandidates,
    touchedTiles,
  };
}

function snapshotForCampaign(options: {
  campaignId: string;
  candidate: DiamondCandidate;
  parcelCandidate: DiamondParcelCandidate | null;
  addressCount: number;
  bbox: Bounds;
  scanMetric: DiamondScanMetric;
}): LambdaSnapshotResponse {
  const { campaignId, candidate, parcelCandidate, addressCount, bbox, scanMetric } = options;
  const buildingsPmtilesKey = manifestPmtilesKey(candidate.buildingManifest, 'buildings');
  const addressesPmtilesKey = manifestPmtilesKey(candidate.addressManifest, 'addresses');
  const parcelsPmtilesKey = parcelCandidate
    ? manifestPmtilesKey(parcelCandidate.parcelManifest, 'parcels')
    : null;
  const buildingsGeojsonKey = manifestGeojsonKey(candidate.buildingManifest, 'buildings');
  const addressesGeojsonKey = manifestGeojsonKey(candidate.addressManifest, 'addresses');
  const parcelsGeojsonKey = parcelCandidate
    ? manifestGeojsonKey(parcelCandidate.parcelManifest, 'parcels')
    : null;
  const buildingsTilejsonKey = manifestTilejsonKey(candidate.buildingManifest, 'buildings');
  const addressesTilejsonKey = manifestTilejsonKey(candidate.addressManifest, 'addresses');
  const parcelsTilejsonKey = parcelCandidate
    ? manifestTilejsonKey(parcelCandidate.parcelManifest, 'parcels')
    : null;
  const region = candidate.region.toLowerCase();
  const country = candidate.country;
  const municipality = candidate.municipality;
  const prefix = `diamond/${country}/${region}/${municipality}`;

  const tileMetrics = {
    artifact_type: 'diamond',
    diamond_mode: true,
    municipal_diamond_mode: true,
    municipal_diamond_layer: 1,
    fallback_layer: 'bedrock',
    geometry_provider: 'pmtiles',
    diamond_country: country,
    diamond_region: region,
    diamond_municipality: municipality,
    pmtiles_key: buildingsPmtilesKey,
    tilejson_key: buildingsTilejsonKey,
    geojson_key: buildingsGeojsonKey,
    buildings_geojson_key: buildingsGeojsonKey,
    addresses_pmtiles_key: addressesPmtilesKey,
    addresses_tilejson_key: addressesTilejsonKey,
    addresses_geojson_key: addressesGeojsonKey,
    parcels_pmtiles_key: parcelsPmtilesKey,
    parcels_tilejson_key: parcelsTilejsonKey,
    parcels_geojson_key: parcelsGeojsonKey,
    address_manifest_key: candidate.addressManifestKey,
    building_manifest_key: candidate.buildingManifestKey,
    parcel_manifest_key: parcelCandidate?.parcelManifestKey ?? null,
    source_layers: {
      buildings: candidate.buildingManifest.source_layer ?? 'buildings',
      addresses: candidate.addressManifest.source_layer ?? 'addresses',
      parcels: parcelCandidate?.parcelManifest.source_layer ?? null,
    },
    promote_ids: {
      buildings: candidate.buildingManifest.promote_id ?? 'building_id',
      addresses: candidate.addressManifest.promote_id ?? 'address_id',
      parcels: parcelCandidate?.parcelManifest.promote_id ?? null,
    },
    join_key: 'address_id',
    sources: {
      buildings: `${municipality}_buildings`,
      addresses: `${municipality}_addresses`,
    },
    bounds: bbox,
    artifact_bounds: candidate.buildingManifest.bounds ?? candidate.addressManifest.bounds ?? null,
    address_bounds: bbox,
    parcel_bounds: parcelCandidate?.parcelManifest.bounds ?? null,
    minzoom: candidate.buildingManifest.minzoom ?? 12,
    maxzoom: candidate.buildingManifest.maxzoom ?? 18,
    address_minzoom: candidate.addressManifest.minzoom ?? 10,
    address_maxzoom: candidate.addressManifest.maxzoom ?? 16,
    parcel_minzoom: parcelCandidate?.parcelManifest.minzoom ?? null,
    parcel_maxzoom: parcelCandidate?.parcelManifest.maxzoom ?? null,
    parcels_count: parcelCandidate?.parcelManifest.feature_count ?? 0,
    addresses_count: addressCount,
    scan_metrics: {
      addresses: scanMetric,
    },
  };

  return {
    campaign_id: campaignId,
    bucket: bucket(),
    prefix,
    counts: {
      buildings: candidate.buildingManifest.feature_count ?? 0,
      addresses: addressCount,
      roads: 0,
    },
    s3_keys: {
      buildings: buildingsPmtilesKey,
      addresses: addressesPmtilesKey,
      metadata: candidate.buildingManifestKey,
    },
    urls: {
      buildings: artifactUrl(buildingsPmtilesKey),
      addresses: artifactUrl(addressesPmtilesKey),
      metadata: artifactUrl(candidate.buildingManifestKey),
    },
    metadata: {
      elapsed_ms: Math.round(scanMetric.seconds * 1000),
      snapshot_size_bytes: 0,
      overture_release: `municipal-diamond-${country}-${region}-${municipality}`,
      tile_metrics: tileMetrics as unknown as SnapshotTileMetrics,
    },
  };
}

export class DiamondMunicipalService {
  static isSupportedRegion(regionCode: string | null | undefined) {
    return Boolean(normalizeCountry(regionCode));
  }

  static async provisionCampaign(options: {
    campaignId: string;
    polygon: GeoJSON.Polygon;
    addressLimit?: number;
    regionCode: string;
  }): Promise<{
    addresses: StandardCampaignAddress[];
    snapshot: LambdaSnapshotResponse;
    metrics: { addresses: DiamondScanMetric };
    municipality: string;
    country: DiamondCountry;
  } | null> {
    const startedAt = Date.now();
    const normalizedRegion = options.regionCode.trim().toUpperCase();
    const country = normalizeCountry(normalizedRegion);
    if (!country) return null;

    const bbox = turf.bbox(options.polygon) as Bounds;
    const candidates = await listMunicipalCandidates(country, normalizedRegion);
    const candidate = candidates.find((entry) => {
      const addressBounds = entry.addressManifest.bounds;
      const buildingBounds = entry.buildingManifest.bounds;
      return Boolean(
        addressBounds &&
          buildingBounds &&
          boundsIntersect(addressBounds, bbox) &&
          boundsIntersect(buildingBounds, bbox)
      );
    });
    if (!candidate) return null;
    const parcelCandidates = await listParcelCandidates(country, normalizedRegion);
    const parcelCandidate = parcelCandidates.find((entry) => {
      const parcelBounds = entry.parcelManifest.bounds;
      return Boolean(parcelBounds && boundsIntersect(parcelBounds, bbox));
    }) ?? null;

    const scoped = await loadScopedAddressesFromPmtiles({
      campaignId: options.campaignId,
      polygon: options.polygon,
      addressManifest: candidate.addressManifest,
      regionCode: normalizedRegion,
      addressLimit: options.addressLimit,
    });

    if (scoped.addresses.length === 0) return null;

    const scanMetric: DiamondScanMetric = {
      hits: scoped.addresses.length,
      scanned: scoped.scanned,
      bboxCandidates: scoped.bboxCandidates,
      seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      queryEngine: 'municipal_diamond_pmtiles',
      municipality: candidate.municipality,
      touchedTiles: scoped.touchedTiles,
    };

    return {
      addresses: scoped.addresses,
      snapshot: snapshotForCampaign({
        campaignId: options.campaignId,
        candidate,
        parcelCandidate,
        addressCount: scoped.addresses.length,
        bbox,
        scanMetric,
      }),
      metrics: { addresses: scanMetric },
      municipality: candidate.municipality,
      country,
    };
  }
}
