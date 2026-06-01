import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import * as turf from '@turf/turf';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import {
  fetchScopedPmtilesAddresses,
  normalizePmtilesAddressFeature,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-addresses';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';

type Bounds = [number, number, number, number];
type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

export type BedrockProvisionSource = 'bedrock_ca' | 'bedrock_us' | 'bedrock_za' | 'bedrock_uk';

type BedrockCountryConfig = {
  country: 'canada' | 'usa' | 'south-africa' | 'uk';
  countryCode: 'CA' | 'US' | 'ZA' | 'GB';
  provisionSource: BedrockProvisionSource;
  envPrefix: 'BEDROCK_CA' | 'BEDROCK_US' | 'BEDROCK_ZA' | 'BEDROCK_UK';
  defaultSource: string;
  overtureRelease: string;
  buildingBoundsBufferMeters?: number;
  parcelsPmtiles?: boolean;
};

type ParquetManifest = {
  feature_count?: number;
  partitioning?: { scheme?: string; tile_z?: number };
  tile_seam_awareness?: { enabled?: boolean; tile_padding?: number; tile_z?: number; reason?: string };
  tile_counts?: Array<{ tile_z: number; tile_x: number; tile_y: number; feature_count: number }>;
  state_counts?: Array<{ state: string; feature_count?: number; path: string }>;
};

type BedrockParquetRow = Record<string, unknown> & {
  address_id?: string;
  gers_id?: string;
  source_id?: string;
  uprn?: string;
  full_address?: string;
  formatted?: string;
  house_number?: string;
  house_number_label?: string;
  street_number?: string;
  street_name?: string;
  locality?: string;
  city?: string;
  region?: string;
  state?: string;
  postal_code?: string;
  longitude?: number;
  latitude?: number;
  geometry_json?: string;
  properties_json?: string;
};

type BedrockScanResult = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  polygonCandidates?: number;
  normalizedCandidates?: number;
  canonicalAddresses?: number;
  dedupedCandidates?: number;
  addressLimitApplied?: boolean;
  seconds: number;
  queryEngine: string;
  touchedTiles: number;
  partitioning?: string;
  tilePadding?: number;
  timings: Record<string, number | string | boolean | undefined>;
};

type ManifestReadResult = {
  manifest: ParquetManifest;
  manifestMs: number;
  cacheHit: boolean;
};

function emptyBedrockScanMetric(config: BedrockCountryConfig): BedrockScanResult {
  return {
    hits: 0,
    scanned: 0,
    bboxCandidates: 0,
    polygonCandidates: 0,
    normalizedCandidates: 0,
    canonicalAddresses: 0,
    dedupedCandidates: 0,
    addressLimitApplied: false,
    seconds: 0,
    queryEngine: `${config.provisionSource}_pmtiles`,
    touchedTiles: 0,
    partitioning: 'web_mercator_xyz',
    tilePadding: 0,
    timings: {
      totalMs: 0,
    },
  };
}

const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const USA_ADDRESS_REGIONS = new Set([
  'AK',
  'AL',
  'AR',
  'AZ',
  'CA',
  'CO',
  'CT',
  'DC',
  'DE',
  'FL',
  'GA',
  'HI',
  'IA',
  'ID',
  'IL',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MI',
  'MN',
  'MO',
  'MS',
  'MT',
  'NC',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'NY',
  'OH',
  'OK',
  'OR',
  'PA',
  'PR',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VA',
  'VI',
  'VT',
  'WA',
  'WI',
  'WV',
  'WY',
]);
const USA_BUILDING_REGIONS = new Set([
  'AK',
  'AL',
  'AR',
  'AZ',
  'CA',
  'CO',
  'CT',
  'DC',
  'DE',
  'FL',
  'GA',
  'HI',
  'IA',
  'ID',
  'IL',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MI',
  'MN',
  'MO',
  'MS',
  'MT',
  'NC',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'NY',
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
  'VA',
  'VT',
  'WA',
  'WI',
  'WV',
  'WY',
]);
const USA_PARCEL_REGIONS = new Set([
  'AK',
  'AL',
  'AR',
  'AZ',
  'CA',
  'CO',
  'CT',
  'DC',
  'DE',
  'FL',
  'GA',
  'HI',
  'IA',
  'ID',
  'IL',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MI',
  'MN',
  'MO',
  'MS',
  'MT',
  'NC',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'NY',
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
  'VA',
  'VT',
  'WA',
  'WI',
  'WV',
  'WY',
]);

let s3Client: S3Client | null = null;
let resolvedAwsCredentials:
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiresAt?: number }
  | null = null;
let awsCredentialsPromise:
  | Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiresAt?: number }>
  | null = null;
const AWS_CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000;
const AWS_CREDENTIAL_EXPIRY_SKEW_MS = 60 * 1000;
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
const manifestCache = new Map<string, { expiresAt: number; manifest: ParquetManifest }>();

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

async function getAwsCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      expiresAt: Date.now() + AWS_CREDENTIAL_CACHE_TTL_MS,
    };
  }
  const now = Date.now();
  if (resolvedAwsCredentials && (resolvedAwsCredentials.expiresAt ?? 0) > now + AWS_CREDENTIAL_EXPIRY_SKEW_MS) {
    return resolvedAwsCredentials;
  }
  if (!awsCredentialsPromise) {
    awsCredentialsPromise = defaultProvider()()
      .then((credentials) => {
        const expiration = credentials.expiration instanceof Date
          ? credentials.expiration.getTime()
          : Date.now() + AWS_CREDENTIAL_CACHE_TTL_MS;
        resolvedAwsCredentials = {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
          expiresAt: expiration,
        };
        return resolvedAwsCredentials;
      })
      .finally(() => {
        awsCredentialsPromise = null;
      });
  }
  return awsCredentialsPromise;
}

function env(config: BedrockCountryConfig, suffix: string) {
  return process.env[`${config.envPrefix}_${suffix}`];
}

function bucket(config: BedrockCountryConfig) {
  return env(config, 'BUCKET') || process.env.DIAMOND_GEOMETRY_BUCKET || DEFAULT_BUCKET;
}

function prefix(config: BedrockCountryConfig) {
  return (env(config, 'PREFIX') || `bedrock/${config.country}/current`).replace(/^\/+|\/+$/g, '');
}

function layerKey(config: BedrockCountryConfig, layer: 'addresses' | 'buildings' | 'parcels', filename: string) {
  return `${prefix(config)}/${layer}/${filename}`;
}

function cdnBase(config: BedrockCountryConfig) {
  return (
    env(config, 'CDN_BASE_URL') ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    ''
  ).trim();
}

function cdnUrl(config: BedrockCountryConfig, key: string): string | null {
  const base = cdnBase(config);
  return base ? `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}` : null;
}

function usaParcelPmtilesKey(config: BedrockCountryConfig, regionCode?: string | null) {
  if (!config.parcelsPmtiles) return null;
  if (config.country !== 'usa') return layerKey(config, 'parcels', 'parcels.pmtiles');
  const state = regionCode?.trim().toUpperCase();
  if (!state || !USA_PARCEL_REGIONS.has(state)) return null;
  return `${prefix(config)}/parcels/pmtiles_by_state/state=${state}/parcels.pmtiles`;
}

function usaAddressPmtilesKey(config: BedrockCountryConfig, regionCode?: string | null) {
  if (config.country !== 'usa') return layerKey(config, 'addresses', 'addresses.pmtiles');
  const state = regionCode?.trim().toUpperCase();
  if (!state || !USA_ADDRESS_REGIONS.has(state)) return null;
  return `${prefix(config)}/addresses/pmtiles_by_state/state=${state}/addresses.pmtiles`;
}

function usaBuildingPmtilesKey(config: BedrockCountryConfig, regionCode?: string | null) {
  if (config.country !== 'usa') return layerKey(config, 'buildings', 'buildings.pmtiles');
  const state = regionCode?.trim().toUpperCase();
  if (!state || !USA_BUILDING_REGIONS.has(state)) return null;
  return `${prefix(config)}/buildings/pmtiles_by_state/state=${state}/buildings.pmtiles`;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Invalid SQL number: ${value}`);
  return value.toString();
}

function slippyTile(lon: number, lat: number, zoom: number): [number, number] {
  const n = 1 << zoom;
  const clampedLat = Math.max(Math.min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

function tileSeamPadding(manifest: ParquetManifest, tileZ: number) {
  const configured = manifest.tile_seam_awareness;
  if (configured?.enabled === false) return 0;
  const padding = Number(configured?.tile_padding ?? 1);
  const manifestTileZ = Number(configured?.tile_z ?? tileZ);
  if (!Number.isFinite(padding) || padding < 0 || manifestTileZ !== tileZ) return 0;
  return Math.min(2, Math.floor(padding));
}

async function s3Text(config: BedrockCountryConfig, s3Key: string) {
  const cdn = cdnUrl(config, s3Key);
  if (cdn) {
    const response = await fetch(cdn, { cache: 'no-store' });
    if (response.ok) {
      return response.text();
    }
    console.warn('[BedrockCountryService] CDN manifest fetch failed; falling back to S3', {
      key: s3Key,
      status: response.status,
    });
  }

  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(config), Key: s3Key }));
  const body = response.Body;
  if (!body || typeof body !== 'object' || !('transformToString' in body)) {
    throw new Error(`Unable to read S3 object: ${s3Key}`);
  }
  return (body as { transformToString: () => Promise<string> }).transformToString();
}

function manifestCacheKey(config: BedrockCountryConfig, s3Key: string) {
  return `${config.country}:addresses:${s3Key}`;
}

function cachedManifest(config: BedrockCountryConfig, s3Key: string): ParquetManifest | null {
  const cacheKey = manifestCacheKey(config, s3Key);
  const cached = manifestCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    manifestCache.delete(cacheKey);
    return null;
  }
  return cached.manifest;
}

function setCachedManifest(config: BedrockCountryConfig, s3Key: string, manifest: ParquetManifest) {
  manifestCache.set(manifestCacheKey(config, s3Key), {
    expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
    manifest,
  });
}

async function readManifest(config: BedrockCountryConfig): Promise<ManifestReadResult> {
  const startedAt = Date.now();
  const manifestKey = layerKey(config, 'addresses', 'parquet-manifest.json');
  const cached = cachedManifest(config, manifestKey);
  if (cached) {
    return { manifest: cached, manifestMs: Date.now() - startedAt, cacheHit: true };
  }

  const manifest = JSON.parse(await s3Text(config, manifestKey)) as ParquetManifest;
  setCachedManifest(config, manifestKey, manifest);
  return { manifest, manifestMs: Date.now() - startedAt, cacheHit: false };
}

function parquetPathsForTiles(config: BedrockCountryConfig, manifest: ParquetManifest, bbox: Bounds, regionCode?: string | null) {
  const parquetPathFor = (relative: string) => {
    const key = layerKey(config, 'addresses', relative);
    return `s3://${bucket(config)}/${key}`;
  };

  if (manifest.partitioning?.scheme === 'state') {
    const normalizedRegion = regionCode?.trim().toUpperCase();
    const available = new Set((manifest.state_counts ?? []).map((entry) => entry.state.toUpperCase()));
    const candidates = [
      normalizedRegion,
      config.country === 'south-africa' && normalizedRegion !== config.countryCode ? config.countryCode : null,
    ].filter((candidate): candidate is string => Boolean(candidate));
    const state = available.size > 0
      ? candidates.find((candidate) => available.has(candidate))
      : candidates[0];

    if (!state) {
      return { paths: [], tileZ: 0, partitioning: 'state' };
    }

    if (normalizedRegion && state !== normalizedRegion) {
      console.warn('[BedrockCountryService] Falling back to country-level state partition', {
        country: config.country,
        requestedRegion: normalizedRegion,
        partition: state,
      });
    }

    const relative = `parquet/state=${state}/*.parquet`;
    return {
      paths: [parquetPathFor(relative)],
      tileZ: 0,
      partitioning: 'state',
    };
  }

  const tileZ = manifest.partitioning?.tile_z ?? 12;
  const corners = [
    slippyTile(bbox[0], bbox[1], tileZ),
    slippyTile(bbox[0], bbox[3], tileZ),
    slippyTile(bbox[2], bbox[1], tileZ),
    slippyTile(bbox[2], bbox[3], tileZ),
  ];
  const padding = tileSeamPadding(manifest, tileZ);
  const maxTile = (1 << tileZ) - 1;
  const minX = Math.max(0, Math.min(...corners.map(([x]) => x)) - padding);
  const maxX = Math.min(maxTile, Math.max(...corners.map(([x]) => x)) + padding);
  const minY = Math.max(0, Math.min(...corners.map(([, y]) => y)) - padding);
  const maxY = Math.min(maxTile, Math.max(...corners.map(([, y]) => y)) + padding);
  const available = new Set((manifest.tile_counts ?? []).map((tile) => `${tile.tile_z}/${tile.tile_x}/${tile.tile_y}`));
  const paths: string[] = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (available.size > 0 && !available.has(`${tileZ}/${x}/${y}`)) continue;
      const relative = `parquet/tile_z=${tileZ}/tile_x=${x}/tile_y=${y}/*.parquet`;
      paths.push(parquetPathFor(relative));
    }
  }

  return { paths, tileZ, partitioning: 'web_mercator_xyz', tilePadding: padding };
}

function parseProperties(row: BedrockParquetRow) {
  if (typeof row.properties_json !== 'string' || !row.properties_json.trim()) return {};
  try {
    return JSON.parse(row.properties_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fallbackAddressLabel(config: BedrockCountryConfig, row: BedrockParquetRow, props: Record<string, unknown>, addressId?: string) {
  const sourceId = text(row.source_id) ?? text(props.source_id);
  const uprn = text(row.uprn) ?? text(props.uprn);
  const stableId = sourceId ?? uprn ?? addressId ?? text(row.gers_id);

  if (config.country === 'uk' && stableId) {
    return `UPRN ${stableId.replace(/^os-open-uprn:gb:/i, '')}`;
  }

  if (stableId) {
    return `${config.defaultSource} ${stableId}`;
  }

  return 'Address point';
}

function normalizeAddress(config: BedrockCountryConfig, campaignId: string, row: BedrockParquetRow): StandardCampaignAddress | null {
  const lon = Number(row.longitude);
  const lat = Number(row.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const props = parseProperties(row);
  const geometry =
    typeof row.geometry_json === 'string' && row.geometry_json.trim()
      ? row.geometry_json
      : JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
  const addressId = text(row.address_id) ?? text(props.address_id) ?? text(row.gers_id);
  const houseNumber = text(row.house_number) ?? text(row.house_number_label) ?? text(row.street_number) ?? text(props.house_number);
  const streetName = text(row.street_name) ?? text(props.street_name);
  const locality = text(row.locality) ?? text(props.locality) ?? text(row.city);
  const formatted =
    text(row.full_address) ??
    text(row.formatted) ??
    text(props.full_address) ??
    ([houseNumber, streetName, locality].filter(Boolean).join(' ') ||
      fallbackAddressLabel(config, row, props, addressId));

  return {
    campaign_id: campaignId,
    formatted,
    house_number: houseNumber,
    street_name: streetName,
    locality,
    region: (text(row.region) ?? text(props.region) ?? text(row.state) ?? config.countryCode).toUpperCase(),
    postal_code: text(row.postal_code) ?? text(props.postal_code),
    coordinate: { lat, lon },
    lat,
    lon,
    geom: geometry,
    source: config.provisionSource,
    gers_id: addressId ? `${config.provisionSource}:${addressId}` : null,
  };
}

function snapshotToCampaignSnapshotRow(snapshot: LambdaSnapshotResponse): CampaignSnapshotRow {
  return {
    bucket: snapshot.bucket,
    prefix: snapshot.prefix,
    buildings_key: snapshot.s3_keys.buildings,
    addresses_key: snapshot.s3_keys.addresses,
    buildings_url: snapshot.urls.buildings,
    metadata_key: snapshot.s3_keys.metadata,
    buildings_count: snapshot.counts.buildings,
    created_at: new Date().toISOString(),
    tile_metrics: (snapshot.metadata?.tile_metrics ?? null) as Record<string, unknown> | null,
  };
}

export class BedrockCountryService {
  constructor(private readonly config: BedrockCountryConfig) {}

  async provisionCampaign(options: {
    campaignId: string;
    polygon: GeoJSON.Polygon;
    addressLimit?: number;
    regionCode?: string | null;
  }): Promise<{
    addresses: StandardCampaignAddress[];
    snapshot: LambdaSnapshotResponse;
    metrics: { addresses: BedrockScanResult };
  }> {
    const bbox = turf.bbox(options.polygon) as Bounds;
    const snapshot = this.snapshotForCampaign(
      options.campaignId,
      0,
      emptyBedrockScanMetric(this.config),
      options.regionCode
    );
    const addressPmtilesKey = usaAddressPmtilesKey(this.config, options.regionCode);
    if (!addressPmtilesKey) {
      throw new Error(`PMTiles address artifact unavailable for BEDROCK ${this.config.country}: missing regional address PMTiles key`);
    }

    console.log(`[BedrockCountryService] ${this.config.country} PMTiles address scan starting`, {
      campaignId: options.campaignId,
      regionCode: options.regionCode ?? null,
      bbox,
      pmtilesKey: addressPmtilesKey,
    });

    const pmtilesResult = await fetchScopedPmtilesAddresses({
      campaignId: options.campaignId,
      snapshot: snapshotToCampaignSnapshotRow(snapshot),
      bbox,
      boundary: options.polygon,
      queryEngine: `${this.config.provisionSource}_pmtiles`,
      pmtilesKey: addressPmtilesKey,
      sourceLayer: 'addresses',
      promoteId: 'address_id',
      minZoom: 10,
      addressLimit: options.addressLimit,
      normalizeFeature: ({ campaignId, feature, lon, lat }) =>
        normalizePmtilesAddressFeature({
          campaignId,
          feature,
          lon,
          lat,
          source: this.config.provisionSource,
          fallbackRegion: options.regionCode ?? this.config.countryCode,
          defaultSource: this.config.defaultSource,
          idPrefix: this.config.provisionSource,
        }),
    });
    const metric = pmtilesResult.metric as BedrockScanResult;

    console.log(`[BedrockCountryService] ${this.config.country} PMTiles address scan complete`, {
      campaignId: options.campaignId,
      hits: metric.hits,
      scanned: metric.scanned,
      bboxCandidates: metric.bboxCandidates,
      polygonCandidates: metric.polygonCandidates,
      normalizedCandidates: metric.normalizedCandidates,
      canonicalAddresses: metric.canonicalAddresses,
      dedupedCandidates: metric.dedupedCandidates,
      addressLimitApplied: metric.addressLimitApplied,
      touchedTiles: metric.touchedTiles,
      timings: metric.timings,
    });

    return {
      addresses: pmtilesResult.addresses,
      metrics: { addresses: metric },
      snapshot: this.snapshotForCampaign(options.campaignId, pmtilesResult.addresses.length, metric, options.regionCode),
    };
  }

  async staticSnapshotForCampaign(
    campaignId: string,
    regionCode?: string | null
  ): Promise<LambdaSnapshotResponse> {
    return this.snapshotForCampaign(campaignId, 0, emptyBedrockScanMetric(this.config), regionCode);
  }

  snapshotForCampaign(
    campaignId: string,
    addressCount: number,
    scanMetric: BedrockScanResult,
    regionCode?: string | null
  ): LambdaSnapshotResponse {
    const buildingPmtilesKey = usaBuildingPmtilesKey(this.config, regionCode);
    const snapshotBuildingKey = buildingPmtilesKey ?? layerKey(this.config, 'buildings', 'buildings.pmtiles');
    const addressPmtilesKey = usaAddressPmtilesKey(this.config, regionCode);
    const snapshotAddressKey = addressPmtilesKey ?? layerKey(this.config, 'addresses', 'addresses.pmtiles');
    const parcelPmtilesKey = usaParcelPmtilesKey(this.config, regionCode);
    const isUsBedrock = this.config.countryCode.toUpperCase() === 'US';
    const tileMetrics = {
      artifact_type: 'diamond',
      diamond_mode: true,
      bedrock_mode: true,
      bedrock_country: this.config.country,
      bedrock_country_code: this.config.countryCode,
      bedrock_version: env(this.config, 'VERSION') || 'current',
      geometry_provider: 'pmtiles',
      building_bounds_buffer_meters: this.config.buildingBoundsBufferMeters ?? 0,
      pmtiles_key: buildingPmtilesKey,
      tilejson_key: layerKey(this.config, 'buildings', 'buildings.json'),
      buildings_pmtiles_index_key: `${prefix(this.config)}/buildings/pmtiles-index.json`,
      buildings_geojson_key: isUsBedrock ? null : layerKey(this.config, 'buildings', 'buildings.ndjson.gz'),
      addresses_pmtiles_key: addressPmtilesKey,
      addresses_tilejson_key: layerKey(this.config, 'addresses', 'addresses.json'),
      addresses_geojson_key: layerKey(this.config, 'addresses', 'addresses.ndjson.gz'),
      addresses_pmtiles_index_key: `${prefix(this.config)}/addresses/pmtiles-index.json`,
      parcels_pmtiles_key: parcelPmtilesKey,
      parcels_tilejson_key: parcelPmtilesKey?.replace(/\.pmtiles$/i, '.json') ?? null,
      parcels_geojson_key: null,
      parcels_pmtiles_index_key: `${prefix(this.config)}/parcels/pmtiles-index.json`,
      source_layers: {
        buildings: 'buildings',
        addresses: 'addresses',
        parcels: 'parcels',
      },
      promote_ids: {
        buildings: 'building_id',
        addresses: 'address_id',
        parcels: 'parcel_id',
      },
      join_key: 'address_id',
      sources: {
        addresses: this.config.defaultSource,
      },
      minzoom: 12,
      maxzoom: 18,
      address_minzoom: 10,
      address_maxzoom: 18,
      parcel_minzoom: 10,
      parcel_maxzoom: 16,
      addresses_count: addressCount,
      scan_metrics: {
        addresses: scanMetric,
      },
    };

    return {
      campaign_id: campaignId,
      bucket: bucket(this.config),
      prefix: prefix(this.config),
      counts: {
        buildings: 0,
        addresses: addressCount,
        roads: 0,
      },
      s3_keys: {
        buildings: snapshotBuildingKey,
        addresses: snapshotAddressKey,
        metadata: `${prefix(this.config)}/bedrock-${this.config.country}.json`,
      },
      urls: {
        buildings: cdnUrl(this.config, snapshotBuildingKey) ?? `s3://${bucket(this.config)}/${snapshotBuildingKey}`,
        addresses: cdnUrl(this.config, snapshotAddressKey) ?? `s3://${bucket(this.config)}/${snapshotAddressKey}`,
        metadata: `s3://${bucket(this.config)}/${prefix(this.config)}/bedrock-${this.config.country}.json`,
      },
      metadata: {
        elapsed_ms: Math.round(scanMetric.seconds * 1000),
        snapshot_size_bytes: 0,
        overture_release: this.config.overtureRelease,
        tile_metrics: tileMetrics as unknown as SnapshotTileMetrics,
      },
    };
  }
}

export const BEDROCK_CANADA_CONFIG: BedrockCountryConfig = {
  country: 'canada',
  countryCode: 'CA',
  provisionSource: 'bedrock_ca',
  envPrefix: 'BEDROCK_CA',
  defaultSource: 'Statistics Canada National Address Register',
  overtureRelease: 'bedrock-ca-statcan-nar',
};

export const BEDROCK_US_CONFIG: BedrockCountryConfig = {
  country: 'usa',
  countryCode: 'US',
  provisionSource: 'bedrock_us',
  envPrefix: 'BEDROCK_US',
  defaultSource: 'Overture Maps Addresses',
  overtureRelease: 'bedrock-us-overture',
  parcelsPmtiles: true,
};

export const BEDROCK_SOUTH_AFRICA_CONFIG: BedrockCountryConfig = {
  country: 'south-africa',
  countryCode: 'ZA',
  provisionSource: 'bedrock_za',
  envPrefix: 'BEDROCK_ZA',
  defaultSource: 'OpenStreetMap Addresses',
  overtureRelease: 'bedrock-za-osm',
  buildingBoundsBufferMeters: 128,
};

export const BEDROCK_UK_CONFIG: BedrockCountryConfig = {
  country: 'uk',
  countryCode: 'GB',
  provisionSource: 'bedrock_uk',
  envPrefix: 'BEDROCK_UK',
  defaultSource: 'OS Open UPRN',
  overtureRelease: 'bedrock-uk-os-open-uprn-overture',
};
