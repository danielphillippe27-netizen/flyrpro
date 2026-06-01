import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';
import Pbf from 'pbf';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { duckDbRuntimeSetupStatements } from '@/lib/services/duckdbRuntime';

type Bounds = [number, number, number, number];
type SnapshotTileMetrics = NonNullable<NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics']>;

type BedrockScanResult = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  seconds: number;
  queryEngine: 'duckdb_parquet' | 'bedrock_au_pmtiles';
  touchedTiles: number;
  partitioning?: string;
  tilePadding?: number;
  timings?: Record<string, number | boolean>;
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
const MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
const ADDRESS_TILE_FETCH_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.BEDROCK_AU_ADDRESS_TILE_FETCH_CONCURRENCY))
    ? Number(process.env.BEDROCK_AU_ADDRESS_TILE_FETCH_CONCURRENCY)
    : 12
);

let s3Client: S3Client | null = null;
let manifestCache: { cacheKey: string; expiresAt: number; value: ParquetManifest } | null = null;

function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

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

function parcelPmtilesKey() {
  const configured = process.env.BEDROCK_AU_PARCELS_PMTILES_KEY?.trim();
  return configured ? configured.replace(/^\/+/, '') : null;
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

async function readManifest(): Promise<{ manifest: ParquetManifest; manifestMs: number; cacheHit: boolean }> {
  const startedAt = Date.now();
  const manifestKey = key('parquet-manifest.json');
  const cacheKey = `${bucket()}/${manifestKey}`;
  if (manifestCache?.cacheKey === cacheKey && manifestCache.expiresAt > Date.now()) {
    return {
      manifest: manifestCache.value,
      manifestMs: elapsedMs(startedAt),
      cacheHit: true,
    };
  }

  const manifest = JSON.parse(await s3Text(manifestKey)) as ParquetManifest;
  manifestCache = {
    cacheKey,
    expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS,
    value: manifest,
  };
  return {
    manifest,
    manifestMs: elapsedMs(startedAt),
    cacheHit: false,
  };
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

function tileRangeForBbox(bbox: Bounds, maxZoom: number, minZoom = 10) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (let z = Math.min(maxZoom, 16); z >= Math.max(8, minZoom); z -= 1) {
    const [nwX, nwY] = slippyTile(minLon, maxLat, z);
    const [seX, seY] = slippyTile(maxLon, minLat, z);
    const minX = Math.min(nwX, seX);
    const maxX = Math.max(nwX, seX);
    const minY = Math.min(nwY, seY);
    const maxY = Math.max(nwY, seY);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= 96 || z === Math.max(8, minZoom)) {
      return { z, minX, maxX, minY, maxY, tileCount };
    }
  }
  return null;
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

function firstPoint(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates as [number, number];
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    return geometry.coordinates[0] as [number, number];
  }
  return null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeAddressFeature(
  campaignId: string,
  feature: GeoJSON.Feature,
  lon: number,
  lat: number
): StandardCampaignAddress | null {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const addressPid =
    text(props.address_detail_pid) ??
    text(props.address_id) ??
    text(props.id) ??
    (typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) : undefined);
  const houseNumber = text(props.number_first) ?? text(props.house_number) ?? text(props.street_number);
  const streetName = [text(props.street_name), text(props.street_type)]
    .filter(Boolean)
    .join(' ')
    .trim() || text(props.street);
  const locality = text(props.locality_name) ?? text(props.locality) ?? text(props.city);
  const formatted =
    text(props.full_address) ??
    text(props.formatted) ??
    text(props.address) ??
    [houseNumber, streetName, locality].filter(Boolean).join(' ');
  if (!formatted) return null;

  return {
    campaign_id: campaignId,
    formatted,
    house_number: houseNumber,
    street_name: streetName,
    locality,
    region: (text(props.state) ?? text(props.region) ?? 'AU').toUpperCase(),
    postal_code: text(props.postcode) ?? text(props.postal_code),
    coordinate: { lat, lon },
    lat,
    lon,
    geom: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }),
    source: 'bedrock_au',
    gers_id: addressPid ? `gnaf:${addressPid}` : null,
  };
}

function sourceLayerNames() {
  return ['addresses', 'address_circles', 'campaign_addresses'];
}

function addressCandidateQuality(address: StandardCampaignAddress) {
  return [
    address.street_name,
    address.locality,
    address.postal_code,
    address.gers_id,
    address.formatted && !/^\d+[A-Za-z]?$/.test(address.formatted.trim()) ? address.formatted : null,
  ].filter(Boolean).length;
}

function compareAddressCandidates(
  a: { tileIndex: number; layerIndex: number; featureIndex: number; address: StandardCampaignAddress },
  b: { tileIndex: number; layerIndex: number; featureIndex: number; address: StandardCampaignAddress }
) {
  const qualityDelta = addressCandidateQuality(b.address) - addressCandidateQuality(a.address);
  if (qualityDelta !== 0) return qualityDelta;
  const lonDelta = Number(a.address.lon ?? 0) - Number(b.address.lon ?? 0);
  if (lonDelta !== 0) return lonDelta;
  const latDelta = Number(a.address.lat ?? 0) - Number(b.address.lat ?? 0);
  if (latDelta !== 0) return latDelta;
  return a.tileIndex - b.tileIndex || a.layerIndex - b.layerIndex || a.featureIndex - b.featureIndex;
}

async function loadScopedAddressesFromPmtiles(options: {
  campaignId: string;
  polygon: GeoJSON.Polygon;
  addressLimit?: number;
}): Promise<{ addresses: StandardCampaignAddress[]; metric: BedrockScanResult }> {
  const startedAt = Date.now();
  const bbox = turf.bbox(options.polygon) as Bounds;
  const archiveStartedAt = Date.now();
  const archive = getCachedPmtilesArchive(cdnUrl('addresses.pmtiles'));
  const header = await archive.getHeader();
  const headerMs = elapsedMs(archiveStartedAt);
  const rangeStartedAt = Date.now();
  const range = tileRangeForBbox(bbox, header.maxZoom, 10);
  const rangeMs = elapsedMs(rangeStartedAt);
  if (!range) {
    return {
      addresses: [],
      metric: {
        hits: 0,
        scanned: 0,
        bboxCandidates: 0,
        seconds: Number((elapsedMs(startedAt) / 1000).toFixed(2)),
        queryEngine: 'bedrock_au_pmtiles',
        touchedTiles: 0,
        timings: { headerMs, rangeMs, totalMs: elapsedMs(startedAt) },
      },
    };
  }

  const tileCoords: Array<{ x: number; y: number; tileIndex: number }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tileCoords.push({ x, y, tileIndex: tileCoords.length });
    }
  }

  const tileStartedAt = Date.now();
  const byAddressId = new Map<
    string,
    { tileIndex: number; layerIndex: number; featureIndex: number; address: StandardCampaignAddress }
  >();
  let scanned = 0;
  let bboxCandidates = 0;
  let touchedTiles = 0;

  await forEachWithConcurrency(tileCoords, ADDRESS_TILE_FETCH_CONCURRENCY, async ({ x, y, tileIndex }) => {
    const tile = await archive.getZxy(range.z, x, y);
    if (!tile) return;
    touchedTiles += 1;

    const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
    const layers = sourceLayerNames()
      .map((sourceLayerName, layerIndex) => ({ layer: vectorTile.layers[sourceLayerName], layerIndex }))
      .filter((entry): entry is { layer: NonNullable<typeof entry.layer>; layerIndex: number } =>
        Boolean(entry.layer)
      );
    if (layers.length === 0) return;

    for (const { layer, layerIndex } of layers) {
      for (let index = 0; index < layer.length; index += 1) {
        scanned += 1;
        const feature = layer.feature(index).toGeoJSON(x, y, range.z) as GeoJSON.Feature;
        const point = firstPoint(feature.geometry as GeoJSON.Geometry | null | undefined);
        if (!point) continue;
        const [lon, lat] = point;
        if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
        bboxCandidates += 1;
        if (!turf.booleanPointInPolygon(turf.point([lon, lat]), options.polygon)) continue;

        const address = normalizeAddressFeature(options.campaignId, feature, lon, lat);
        if (!address) continue;
        const dedupeKey = address.gers_id ?? `${address.formatted}:${lon}:${lat}`;
        const candidate = { tileIndex, layerIndex, featureIndex: index, address };
        const existing = byAddressId.get(dedupeKey);
        if (!existing || compareAddressCandidates(candidate, existing) < 0) {
          byAddressId.set(dedupeKey, candidate);
        }
      }
    }
  });

  const tileMs = elapsedMs(tileStartedAt);
  const addresses = Array.from(byAddressId.values())
    .sort((a, b) => {
      const aKey = [
        a.address.formatted,
        a.address.gers_id,
        Number(a.address.lon ?? 0).toFixed(7),
        Number(a.address.lat ?? 0).toFixed(7),
      ].join('|');
      const bKey = [
        b.address.formatted,
        b.address.gers_id,
        Number(b.address.lon ?? 0).toFixed(7),
        Number(b.address.lat ?? 0).toFixed(7),
      ].join('|');
      return aKey.localeCompare(bKey);
    })
    .map((entry) => entry.address)
    .slice(0, options.addressLimit ?? Number.POSITIVE_INFINITY);
  const totalMs = elapsedMs(startedAt);

  return {
    addresses,
    metric: {
      hits: addresses.length,
      scanned,
      bboxCandidates,
      seconds: Number((totalMs / 1000).toFixed(2)),
      queryEngine: 'bedrock_au_pmtiles',
      touchedTiles,
      partitioning: 'web_mercator_xyz',
      tilePadding: 0,
      timings: {
        headerMs,
        rangeMs,
        tileMs,
        totalMs,
        tileCount: tileCoords.length,
        concurrency: ADDRESS_TILE_FETCH_CONCURRENCY,
      },
    },
  };
}

async function duckDbAll(sql: string, usesS3: boolean): Promise<{
  rows: BedrockAustraliaRow[];
  timings: Record<string, number>;
}> {
  const importStartedAt = Date.now();
  const duckdbModule = await import('duckdb');
  const importMs = elapsedMs(importStartedAt);
  const duckdb = (duckdbModule.default ?? duckdbModule) as typeof duckdbModule;
  const openStartedAt = Date.now();
  const db = new duckdb.Database(':memory:');
  const openMs = elapsedMs(openStartedAt);

  const all = (statement: string) =>
    new Promise<BedrockAustraliaRow[]>((resolve, reject) => {
      db.all(statement, (error: Error | null, rows: BedrockAustraliaRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });

  try {
    let setupMs = 0;
    if (usesS3) {
      const setupStartedAt = Date.now();
      for (const statement of duckDbRuntimeSetupStatements()) {
        await all(statement);
      }
      await all('INSTALL httpfs');
      await all('LOAD httpfs');
      await all(`SET s3_region=${sqlString(REGION)}`);
      await all(`CREATE SECRET IF NOT EXISTS bedrock_au_s3 (TYPE s3, PROVIDER credential_chain, REGION ${sqlString(REGION)})`);
      setupMs = elapsedMs(setupStartedAt);
    }
    const queryStartedAt = Date.now();
    const rows = await all(sql);
    const queryMs = elapsedMs(queryStartedAt);
    return {
      rows,
      timings: {
        importMs,
        openMs,
        setupMs,
        queryMs,
      },
    };
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
    regionCode?: string | null;
  }): Promise<{
    addresses: StandardCampaignAddress[];
    snapshot: LambdaSnapshotResponse;
    metrics: { addresses: BedrockScanResult };
  }> {
    const startedAt = Date.now();
    const bbox = turf.bbox(options.polygon) as Bounds;

    try {
      console.log('[BedrockAustraliaService] PMTiles address scan starting', {
        campaignId: options.campaignId,
        bbox,
      });
      const pmtilesResult = await loadScopedAddressesFromPmtiles({
        campaignId: options.campaignId,
        polygon: options.polygon,
        addressLimit: options.addressLimit,
      });
      if (pmtilesResult.metric.hits > 0 || pmtilesResult.metric.scanned > 0) {
        console.log('[BedrockAustraliaService] PMTiles address scan complete', {
          campaignId: options.campaignId,
          hits: pmtilesResult.metric.hits,
          scanned: pmtilesResult.metric.scanned,
          touchedTiles: pmtilesResult.metric.touchedTiles,
          timings: pmtilesResult.metric.timings,
        });
        return {
          addresses: pmtilesResult.addresses,
          metrics: { addresses: pmtilesResult.metric },
          snapshot: this.snapshotForCampaign({
            campaignId: options.campaignId,
            addressCount: pmtilesResult.addresses.length,
            scanMetric: pmtilesResult.metric,
          }),
        };
      }
      console.warn('[BedrockAustraliaService] PMTiles address scan found no address layer/features; falling back to parquet', {
        campaignId: options.campaignId,
        timings: pmtilesResult.metric.timings,
      });
    } catch (pmtilesError) {
      console.warn('[BedrockAustraliaService] PMTiles address scan failed; falling back to parquet:', {
        campaignId: options.campaignId,
        message: pmtilesError instanceof Error ? pmtilesError.message : String(pmtilesError),
      });
    }

    const { manifest, manifestMs, cacheHit } = await readManifest();
    const partitionStartedAt = Date.now();
    const { paths } = parquetPathsForTiles(manifest, bbox);
    const partitionMs = elapsedMs(partitionStartedAt);
    if (paths.length === 0) {
      throw new Error('BEDROCK Australia has no Parquet partitions for this territory');
    }

    const pathsSql = `[${paths.map(sqlString).join(',')}]`;
    console.log('[BedrockAustraliaService] address scan starting', {
      campaignId: options.campaignId,
      touchedTiles: paths.length,
      manifestMs,
      manifestCacheHit: cacheHit,
      partitionMs,
      bbox,
    });

    const { rows, timings: duckDbTimings } = await duckDbAll(
      `
        SELECT
          address_detail_pid,
          full_address,
          number_first,
          street_name,
          street_type,
          locality_name,
          state,
          postcode,
          longitude,
          latitude
        FROM read_parquet(${pathsSql}, hive_partitioning=1, union_by_name=true)
        WHERE longitude BETWEEN ${sqlNumber(bbox[0])} AND ${sqlNumber(bbox[2])}
          AND latitude BETWEEN ${sqlNumber(bbox[1])} AND ${sqlNumber(bbox[3])}
      `,
      paths.some((path) => path.startsWith('s3://'))
    );

    const filterStartedAt = Date.now();
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
    const filterMs = elapsedMs(filterStartedAt);
    const totalMs = elapsedMs(startedAt);

    const metric: BedrockScanResult = {
      hits: addresses.length,
      scanned: rows.length,
      bboxCandidates: rows.length,
      seconds: Number((totalMs / 1000).toFixed(2)),
      queryEngine: 'duckdb_parquet',
      touchedTiles: paths.length,
      partitioning: 'web_mercator_xyz',
      tilePadding: 0,
      timings: {
        manifestMs,
        manifest_cache_hit: cacheHit,
        partitionMs,
        filterMs,
        totalMs,
        ...duckDbTimings,
      },
    };

    console.log('[BedrockAustraliaService] address scan complete', {
      campaignId: options.campaignId,
      hits: metric.hits,
      scanned: metric.scanned,
      touchedTiles: metric.touchedTiles,
      timings: metric.timings,
    });

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
    manifest?: ParquetManifest;
  }): LambdaSnapshotResponse {
    const parcelsPmtilesKey = parcelPmtilesKey();
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
      addresses_pmtiles_index_key: `${addressPrefix()}/pmtiles-index.json`,
      parcels_pmtiles_key: parcelsPmtilesKey,
      parcels_tilejson_key: parcelsPmtilesKey?.replace(/\.pmtiles$/i, '.json') ?? null,
      parcels_geojson_key: parcelsPmtilesKey?.replace(/\.pmtiles$/i, '.geojson.gz') ?? null,
      parcels_pmtiles_index_key: parcelsPmtilesKey ? `${addressPrefix().replace(/\/addresses$/i, '')}/parcels/pmtiles-index.json` : null,
      addresses_parquet_partitioning: {
        scheme: 'web_mercator_xyz',
        tile_z: options.manifest?.partitioning?.tile_z ?? 12,
        columns: ['tile_z', 'tile_x', 'tile_y'],
        path_template: 'tile_z={tile_z}/tile_x={tile_x}/tile_y={tile_y}/*.parquet',
      },
      source_layers: {
        buildings: 'buildings',
        addresses: 'addresses',
        parcels: parcelsPmtilesKey ? 'parcels' : null,
      },
      promote_ids: {
        buildings: 'building_id',
        addresses: 'address_detail_pid',
        parcels: parcelsPmtilesKey ? 'parcel_id' : null,
      },
      join_key: 'address_detail_pid',
      sources: {
        buildings: 'Microsoft GlobalML Building Footprints',
        addresses: 'G-NAF',
      },
      address_minzoom: 8,
      address_maxzoom: 17,
      parcel_minzoom: parcelsPmtilesKey ? 10 : null,
      parcel_maxzoom: parcelsPmtilesKey ? 16 : null,
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

  static async staticSnapshotForCampaign(campaignId: string): Promise<LambdaSnapshotResponse> {
    return this.snapshotForCampaign({
      campaignId,
      addressCount: 0,
      scanMetric: {
        hits: 0,
        scanned: 0,
        bboxCandidates: 0,
        seconds: 0,
        queryEngine: 'bedrock_au_pmtiles',
        touchedTiles: 0,
        partitioning: 'web_mercator_xyz',
        tilePadding: 0,
        timings: {
          headerMs: 0,
          rangeMs: 0,
          tileMs: 0,
          totalMs: 0,
        },
      },
    });
  }
}
