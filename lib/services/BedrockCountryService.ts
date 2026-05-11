import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import * as turf from '@turf/turf';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';

type Bounds = [number, number, number, number];
type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

export type BedrockProvisionSource = 'bedrock_ca' | 'bedrock_us';

type BedrockCountryConfig = {
  country: 'canada' | 'usa';
  countryCode: 'CA' | 'US';
  provisionSource: BedrockProvisionSource;
  envPrefix: 'BEDROCK_CA' | 'BEDROCK_US';
  defaultSource: string;
  overtureRelease: string;
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
  seconds: number;
  queryEngine: 'duckdb_parquet';
  touchedTiles: number;
  partitioning?: string;
  tilePadding?: number;
  timings: {
    manifestMs: number;
    partitionMs: number;
    queryMs: number;
    filterMs: number;
    totalMs: number;
  };
};

const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const WEB_MERCATOR_MAX_LAT = 85.05112878;

let s3Client: S3Client | null = null;
let resolvedAwsCredentials:
  | { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  | null = null;

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
    };
  }
  if (!resolvedAwsCredentials) {
    const credentials = await defaultProvider()();
    resolvedAwsCredentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };
  }
  return resolvedAwsCredentials;
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

function layerUrl(config: BedrockCountryConfig, layer: 'addresses' | 'buildings' | 'parcels', filename: string) {
  const cdnBase =
    env(config, 'CDN_BASE_URL') ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    '';
  if (cdnBase.trim()) {
    return `${cdnBase.replace(/\/+$/, '')}/${layerKey(config, layer, filename)}`;
  }
  return `s3://${bucket(config)}/${layerKey(config, layer, filename)}`;
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
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(config), Key: s3Key }));
  const body = response.Body;
  if (!body || typeof body !== 'object' || !('transformToString' in body)) {
    throw new Error(`Unable to read S3 object: ${s3Key}`);
  }
  return (body as { transformToString: () => Promise<string> }).transformToString();
}

async function readManifest(config: BedrockCountryConfig): Promise<ParquetManifest> {
  return JSON.parse(await s3Text(config, layerKey(config, 'addresses', 'parquet-manifest.json'))) as ParquetManifest;
}

function parquetPathsForTiles(config: BedrockCountryConfig, manifest: ParquetManifest, bbox: Bounds, regionCode?: string | null) {
  if (manifest.partitioning?.scheme === 'state') {
    const state = regionCode?.trim().toUpperCase();
    const available = new Set((manifest.state_counts ?? []).map((entry) => entry.state.toUpperCase()));
    if (!state || (available.size > 0 && !available.has(state))) {
      return { paths: [], tileZ: 0, partitioning: 'state' };
    }
    const relative = `parquet/state=${state}/*.parquet`;
    return {
      paths: [`s3://${bucket(config)}/${layerKey(config, 'addresses', relative)}`],
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
      paths.push(`s3://${bucket(config)}/${layerKey(config, 'addresses', relative)}`);
    }
  }

  return { paths, tileZ, partitioning: 'web_mercator_xyz', tilePadding: padding };
}

async function duckDbAll(sql: string, usesS3: boolean): Promise<BedrockParquetRow[]> {
  const duckdbModule = await import('duckdb');
  const duckdb = (duckdbModule.default ?? duckdbModule) as typeof duckdbModule;
  const db = new duckdb.Database(':memory:');
  const all = (statement: string) =>
    new Promise<BedrockParquetRow[]>((resolve, reject) => {
      db.all(statement, (error: Error | null, rows: BedrockParquetRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });

  try {
    if (usesS3) {
      await all('INSTALL httpfs');
      await all('LOAD httpfs');
      await all(`SET s3_region=${sqlString(REGION)}`);
      const credentials = await getAwsCredentials();
      if (credentials?.accessKeyId && credentials.secretAccessKey) {
        await all(`SET s3_access_key_id=${sqlString(credentials.accessKeyId)}`);
        await all(`SET s3_secret_access_key=${sqlString(credentials.secretAccessKey)}`);
        if (credentials.sessionToken) {
          await all(`SET s3_session_token=${sqlString(credentials.sessionToken)}`);
        }
      }
    }
    return await all(sql);
  } finally {
    db.close();
  }
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
    [houseNumber, streetName, locality].filter(Boolean).join(' ');

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
    const startedAt = Date.now();
    const bbox = turf.bbox(options.polygon) as Bounds;

    const manifestStartedAt = Date.now();
    const manifest = await readManifest(this.config);
    const manifestMs = Date.now() - manifestStartedAt;

    const partitionStartedAt = Date.now();
    const { paths, partitioning, tilePadding } = parquetPathsForTiles(this.config, manifest, bbox, options.regionCode);
    const partitionMs = Date.now() - partitionStartedAt;
    if (paths.length === 0) {
      throw new Error(`BEDROCK ${this.config.country} has no Parquet partitions for this territory`);
    }

    console.log(`[BedrockCountryService] ${this.config.country} address scan starting`, {
      campaignId: options.campaignId,
      regionCode: options.regionCode ?? null,
      partitioning,
      touchedTiles: paths.length,
      tilePadding,
      manifestMs,
      partitionMs,
      bbox,
    });

    const queryStartedAt = Date.now();
    const rows = await duckDbAll(
      `
        SELECT *
        FROM read_parquet([${paths.map(sqlString).join(',')}], hive_partitioning=1, union_by_name=true)
        WHERE longitude BETWEEN ${sqlNumber(bbox[0])} AND ${sqlNumber(bbox[2])}
          AND latitude BETWEEN ${sqlNumber(bbox[1])} AND ${sqlNumber(bbox[3])}
      `,
      paths.some((path) => path.startsWith('s3://'))
    );
    const queryMs = Date.now() - queryStartedAt;

    const filterStartedAt = Date.now();
    const addresses: StandardCampaignAddress[] = [];
    for (const row of rows) {
      const lon = Number(row.longitude);
      const lat = Number(row.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (!turf.booleanPointInPolygon(turf.point([lon, lat]), options.polygon)) continue;
      const address = normalizeAddress(this.config, options.campaignId, row);
      if (!address) continue;
      addresses.push(address);
      if (options.addressLimit && addresses.length >= options.addressLimit) break;
    }
    const filterMs = Date.now() - filterStartedAt;
    const totalMs = Date.now() - startedAt;

    const metric: BedrockScanResult = {
      hits: addresses.length,
      scanned: rows.length,
      bboxCandidates: rows.length,
      seconds: Number((totalMs / 1000).toFixed(2)),
      queryEngine: 'duckdb_parquet',
      touchedTiles: paths.length,
      partitioning,
      tilePadding,
      timings: {
        manifestMs,
        partitionMs,
        queryMs,
        filterMs,
        totalMs,
      },
    };

    console.log(`[BedrockCountryService] ${this.config.country} address scan complete`, {
      campaignId: options.campaignId,
      hits: metric.hits,
      scanned: metric.scanned,
      touchedTiles: metric.touchedTiles,
      timings: metric.timings,
    });

    return {
      addresses,
      metrics: { addresses: metric },
      snapshot: this.snapshotForCampaign(options.campaignId, addresses.length, metric, manifest),
    };
  }

  snapshotForCampaign(
    campaignId: string,
    addressCount: number,
    scanMetric: BedrockScanResult,
    manifest: ParquetManifest
  ): LambdaSnapshotResponse {
    const tileMetrics = {
      artifact_type: 'diamond',
      diamond_mode: true,
      bedrock_mode: true,
      bedrock_country: this.config.country,
      bedrock_country_code: this.config.countryCode,
      bedrock_version: env(this.config, 'VERSION') || 'current',
      geometry_provider: 'pmtiles',
      pmtiles_key: layerKey(this.config, 'buildings', 'buildings.pmtiles'),
      tilejson_key: layerKey(this.config, 'buildings', 'buildings.json'),
      buildings_geojson_key: layerKey(this.config, 'buildings', 'buildings.ndjson.gz'),
      addresses_pmtiles_key: layerKey(this.config, 'addresses', 'addresses.pmtiles'),
      addresses_tilejson_key: layerKey(this.config, 'addresses', 'addresses.json'),
      addresses_geojson_key: layerKey(this.config, 'addresses', 'addresses.ndjson.gz'),
      addresses_parquet_prefix: layerKey(this.config, 'addresses', 'parquet'),
      addresses_parquet_manifest_key: layerKey(this.config, 'addresses', 'parquet-manifest.json'),
      parcels_pmtiles_key: layerKey(this.config, 'parcels', 'parcels.pmtiles'),
      parcels_tilejson_key: layerKey(this.config, 'parcels', 'parcels.json'),
      parcels_geojson_key: layerKey(this.config, 'parcels', 'parcels.ndjson.gz'),
      addresses_parquet_partitioning: {
        scheme: manifest.partitioning?.scheme ?? 'web_mercator_xyz',
        tile_z: manifest.partitioning?.tile_z ?? 12,
        columns: manifest.partitioning?.scheme === 'state' ? ['state'] : ['tile_z', 'tile_x', 'tile_y'],
        path_template:
          manifest.partitioning?.scheme === 'state'
            ? 'state={state}/*.parquet'
            : 'tile_z={tile_z}/tile_x={tile_x}/tile_y={tile_y}/*.parquet',
      },
      addresses_tile_seam_awareness: manifest.tile_seam_awareness ?? {
        enabled: true,
        tile_padding: 1,
        tile_z: manifest.partitioning?.tile_z ?? 12,
      },
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
      address_maxzoom: 16,
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
        buildings: layerKey(this.config, 'buildings', 'buildings.pmtiles'),
        addresses: layerKey(this.config, 'addresses', 'addresses.pmtiles'),
        metadata: `${prefix(this.config)}/bedrock-${this.config.country}.json`,
      },
      urls: {
        buildings: layerUrl(this.config, 'buildings', 'buildings.pmtiles'),
        addresses: layerUrl(this.config, 'addresses', 'addresses.pmtiles'),
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
};
