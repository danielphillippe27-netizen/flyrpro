import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as turf from '@turf/turf';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { duckDbRuntimeSetupStatements } from '@/lib/services/duckdbRuntime';

type Bounds = [number, number, number, number];
type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

type BedrockScanResult = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  seconds: number;
  queryEngine: 'duckdb_parquet';
  touchedTiles: number;
};

type ParquetManifest = {
  feature_count?: number;
  partitioning?: {
    tile_z?: number;
  };
  tile_counts?: Array<{
    tile_z: number;
    tile_x: number;
    tile_y: number;
    feature_count: number;
  }>;
};

type BedrockAustraliaRow = Record<string, unknown> & {
  address_detail_pid?: string;
  full_address?: string;
  number_first?: string;
  street_name?: string;
  street_type?: string;
  locality_name?: string;
  state?: string;
  postcode?: string;
  longitude?: number;
  latitude?: number;
  geometry_json?: string;
};

const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const DEFAULT_ADDRESS_PREFIX = 'bedrock/australia/current/addresses';
const DEFAULT_BUILDING_PREFIX = 'bedrock/australia/buildings/national';
const REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const WEB_MERCATOR_MAX_LAT = 85.05112878;

let s3Client: S3Client | null = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: REGION,
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
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
  return process.env.BEDROCK_AU_BUCKET || process.env.DIAMOND_GEOMETRY_BUCKET || DEFAULT_BUCKET;
}

function addressPrefix() {
  return (process.env.BEDROCK_AU_ADDRESS_PREFIX || DEFAULT_ADDRESS_PREFIX).replace(/^\/+|\/+$/g, '');
}

function buildingPrefix() {
  return (process.env.BEDROCK_AU_BUILDING_PREFIX || DEFAULT_BUILDING_PREFIX).replace(/^\/+|\/+$/g, '');
}

function key(filename: string) {
  return `${addressPrefix()}/${filename}`;
}

function buildingKey(filename: string) {
  return `${buildingPrefix()}/${filename}`;
}

function cdnUrlForKey(s3Key: string) {
  const cdnBase =
    process.env.BEDROCK_AU_CDN_BASE_URL ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    '';
  if (cdnBase.trim()) {
    return `${cdnBase.replace(/\/+$/, '')}/${s3Key}`;
  }
  return `s3://${bucket()}/${s3Key}`;
}

function cdnUrl(filename: string) {
  return cdnUrlForKey(key(filename));
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
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

async function s3Text(s3Key: string) {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket(), Key: s3Key }));
  const body = response.Body;
  if (!body || typeof body !== 'object' || !('transformToString' in body)) {
    throw new Error(`Unable to read S3 object: ${s3Key}`);
  }
  return (body as { transformToString: () => Promise<string> }).transformToString();
}

async function readManifest(): Promise<ParquetManifest> {
  return JSON.parse(await s3Text(key('parquet-manifest.json'))) as ParquetManifest;
}

function parquetPathsForTiles(manifest: ParquetManifest, bbox: Bounds) {
  const tileZ = manifest.partitioning?.tile_z ?? 12;
  const corners = [
    slippyTile(bbox[0], bbox[1], tileZ),
    slippyTile(bbox[0], bbox[3], tileZ),
    slippyTile(bbox[2], bbox[1], tileZ),
    slippyTile(bbox[2], bbox[3], tileZ),
  ];
  const minX = Math.min(...corners.map(([x]) => x));
  const maxX = Math.max(...corners.map(([x]) => x));
  const minY = Math.min(...corners.map(([, y]) => y));
  const maxY = Math.max(...corners.map(([, y]) => y));
  const available = new Set(
    (manifest.tile_counts ?? []).map((tile) => `${tile.tile_z}/${tile.tile_x}/${tile.tile_y}`)
  );
  const paths: string[] = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (available.size > 0 && !available.has(`${tileZ}/${x}/${y}`)) continue;
      const relative = `parquet/tile_z=${tileZ}/tile_x=${x}/tile_y=${y}/*.parquet`;
      paths.push(`s3://${bucket()}/${key(relative)}`);
    }
  }

  return { tileZ, paths };
}

async function duckDbAll(sql: string, usesS3: boolean): Promise<BedrockAustraliaRow[]> {
  const duckdbModule = await import('duckdb');
  const duckdb = (duckdbModule.default ?? duckdbModule) as typeof duckdbModule;
  const db = new duckdb.Database(':memory:');

  const all = (statement: string) =>
    new Promise<BedrockAustraliaRow[]>((resolve, reject) => {
      db.all(statement, (error: Error | null, rows: BedrockAustraliaRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });

  try {
    if (usesS3) {
      for (const statement of duckDbRuntimeSetupStatements()) {
        await all(statement);
      }
      await all('INSTALL httpfs');
      await all('LOAD httpfs');
      await all(`SET s3_region=${sqlString(REGION)}`);
      await all(`CREATE SECRET IF NOT EXISTS bedrock_au_s3 (TYPE s3, PROVIDER credential_chain, REGION ${sqlString(REGION)})`);
    }
    return await all(sql);
  } finally {
    db.close();
  }
}

function normalizeAddress(campaignId: string, row: BedrockAustraliaRow): StandardCampaignAddress | null {
  const lon = Number(row.longitude);
  const lat = Number(row.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const addressPid = typeof row.address_detail_pid === 'string' ? row.address_detail_pid : null;
  const streetName = [row.street_name, row.street_type].filter(Boolean).join(' ').trim() || undefined;
  const geometry = typeof row.geometry_json === 'string' && row.geometry_json.trim()
    ? row.geometry_json
    : JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

  return {
    campaign_id: campaignId,
    formatted: typeof row.full_address === 'string' ? row.full_address : '',
    house_number: typeof row.number_first === 'string' ? row.number_first : undefined,
    street_name: streetName,
    locality: typeof row.locality_name === 'string' ? row.locality_name : undefined,
    region: typeof row.state === 'string' ? row.state.toUpperCase() : 'AU',
    postal_code: typeof row.postcode === 'string' ? row.postcode : undefined,
    coordinate: { lat, lon },
    lat,
    lon,
    geom: geometry,
    source: 'bedrock_au',
    gers_id: addressPid ? `gnaf:${addressPid}` : null,
  };
}

export class BedrockAustraliaService {
  static isAustraliaRegion(regionCode: string | null | undefined) {
    return regionCode?.trim().toUpperCase() === 'AU';
  }

  static async provisionCampaign(options: {
    campaignId: string;
    polygon: GeoJSON.Polygon;
    addressLimit?: number;
  }): Promise<{
    addresses: StandardCampaignAddress[];
    snapshot: LambdaSnapshotResponse;
    metrics: { addresses: BedrockScanResult };
  }> {
    const startedAt = Date.now();
    const bbox = turf.bbox(options.polygon) as Bounds;
    const manifest = await readManifest();
    const { paths } = parquetPathsForTiles(manifest, bbox);
    if (paths.length === 0) {
      throw new Error('BEDROCK Australia has no Parquet partitions for this territory');
    }

    const pathsSql = `[${paths.map(sqlString).join(',')}]`;
    const rows = await duckDbAll(
      `
        SELECT *
        FROM read_parquet(${pathsSql}, hive_partitioning=1, union_by_name=true)
        WHERE longitude BETWEEN ${sqlNumber(bbox[0])} AND ${sqlNumber(bbox[2])}
          AND latitude BETWEEN ${sqlNumber(bbox[1])} AND ${sqlNumber(bbox[3])}
      `,
      paths.some((path) => path.startsWith('s3://'))
    );

    const addresses: StandardCampaignAddress[] = [];
    for (const row of rows) {
      const lon = Number(row.longitude);
      const lat = Number(row.latitude);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (!turf.booleanPointInPolygon(turf.point([lon, lat]), options.polygon)) continue;
      const address = normalizeAddress(options.campaignId, row);
      if (!address) continue;
      addresses.push(address);
      if (options.addressLimit && addresses.length >= options.addressLimit) break;
    }

    const metric: BedrockScanResult = {
      hits: addresses.length,
      scanned: rows.length,
      bboxCandidates: rows.length,
      seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      queryEngine: 'duckdb_parquet',
      touchedTiles: paths.length,
    };

    return {
      addresses,
      metrics: { addresses: metric },
      snapshot: this.snapshotForCampaign({
        campaignId: options.campaignId,
        addressCount: addresses.length,
        scanMetric: metric,
        manifest,
      }),
    };
  }

  static snapshotForCampaign(options: {
    campaignId: string;
    addressCount: number;
    scanMetric: BedrockScanResult;
    manifest: ParquetManifest;
  }): LambdaSnapshotResponse {
    const tileMetrics = {
      artifact_type: 'diamond',
      diamond_mode: true,
      bedrock_mode: true,
      bedrock_country: 'australia',
      bedrock_country_code: 'AU',
      bedrock_version: process.env.BEDROCK_AU_VERSION || 'current',
      geometry_provider: 'pmtiles',
      pmtiles_key: buildingKey('buildings.pmtiles'),
      tilejson_key: buildingKey('buildings.json'),
      buildings_geojson_key: buildingKey('buildings.geojson.gz'),
      buildings_parquet_key: buildingKey('parquet/buildings.spatial.parquet'),
      buildings_parquet_manifest_key: buildingKey('parquet/buildings.spatial.json'),
      addresses_pmtiles_key: key('addresses.pmtiles'),
      addresses_tilejson_key: key('addresses.json'),
      addresses_geojson_key: key('addresses.ndjson.gz'),
      addresses_parquet_prefix: key('parquet'),
      addresses_parquet_manifest_key: key('parquet-manifest.json'),
      addresses_parquet_partitioning: {
        scheme: 'web_mercator_xyz',
        tile_z: options.manifest.partitioning?.tile_z ?? 12,
        columns: ['tile_z', 'tile_x', 'tile_y'],
        path_template: 'tile_z={tile_z}/tile_x={tile_x}/tile_y={tile_y}/*.parquet',
      },
      source_layers: {
        buildings: 'buildings',
        addresses: 'addresses',
      },
      promote_ids: {
        buildings: 'building_id',
        addresses: 'address_detail_pid',
      },
      join_key: 'address_detail_pid',
      sources: {
        buildings: 'Microsoft GlobalML Building Footprints',
        addresses: 'G-NAF',
      },
      address_minzoom: 8,
      address_maxzoom: 17,
      addresses_count: options.addressCount,
      scan_metrics: {
        addresses: options.scanMetric,
      },
    };

    return {
      campaign_id: options.campaignId,
      bucket: bucket(),
      prefix: addressPrefix(),
      counts: {
        buildings: 0,
        addresses: options.addressCount,
        roads: 0,
      },
      s3_keys: {
        buildings: buildingKey('buildings.pmtiles'),
        addresses: key('addresses.pmtiles'),
        metadata: key('bedrock-manifest.json'),
      },
      urls: {
        buildings: cdnUrlForKey(buildingKey('buildings.pmtiles')),
        addresses: cdnUrl('addresses.pmtiles'),
        metadata: `s3://${bucket()}/${key('bedrock-manifest.json')}`,
      },
      metadata: {
        elapsed_ms: Math.round(options.scanMetric.seconds * 1000),
        snapshot_size_bytes: 0,
        overture_release: 'bedrock-au-gnaf',
        tile_metrics: tileMetrics as unknown as SnapshotTileMetrics,
      },
    };
  }
}
