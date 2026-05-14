import { defaultProvider } from '@aws-sdk/credential-provider-node';
import * as turf from '@turf/turf';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';
import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import { duckDbRuntimeSetupStatements } from '@/lib/services/duckdbRuntime';

type BedrockLayer = 'addresses' | 'buildings' | 'parcels';
type Bounds = [number, number, number, number];

type BedrockScanResult = {
  hits: number;
  scanned: number;
  bboxCandidates: number;
  seconds: number;
  queryEngine?: 'duckdb_parquet' | 'ndjson_stream';
};

type BedrockAddressProperties = {
  address_id?: string;
  full_address?: string;
  unit?: string;
  street_number?: string;
  street_name?: string;
  suburb?: string;
  town_city?: string;
  postcode?: string;
  source?: string;
  source_id?: string;
};

type BedrockAddressFeature = GeoJSON.Feature<GeoJSON.Point, BedrockAddressProperties>;
type BedrockParquetRow = Record<string, unknown> & {
  geometry_geojson?: string;
  properties_json?: string;
  lon?: number;
  lat?: number;
};

type BedrockScopedBuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    gers_id: string;
    name: string | null;
    height: number | null;
    layer: 'building';
    primary_street?: string | null;
    street_name?: string | null;
    [key: string]: unknown;
  }
>;

type BedrockScopedParcelFeature = {
  externalId: string;
  geometry: GeoJSON.MultiPolygon;
};

export type BedrockNzLinkGeometry = {
  buildings: BedrockScopedBuildingFeature[];
  parcels: BedrockScopedParcelFeature[];
};

const DEFAULT_BUCKET = 'flyr-pro-addresses-2025';
const DEFAULT_PREFIX = 'bedrock/new-zealand/current';
const REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';
const NON_RESIDENTIAL_PARCEL_TERMS = [
  'road',
  'street',
  'motorway',
  'highway',
  'rail',
  'railway',
  'sidewalk',
  'footpath',
  'walkway',
  'accessway',
  'right of way',
  'right-of-way',
  'drain',
  'drainage',
  'stormwater',
  'wastewater',
  'watercourse',
  'river',
  'stream',
  'creek',
  'esplanade',
  'reserve',
  'recreation',
  'park',
  'domain',
  'local purpose',
  'utility',
  'substation',
  'school',
];

let resolvedAwsCredentials:
  | {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | null = null;

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

function bucket() {
  return process.env.BEDROCK_NZ_BUCKET || process.env.DIAMOND_GEOMETRY_BUCKET || DEFAULT_BUCKET;
}

function prefix() {
  return (process.env.BEDROCK_NZ_PREFIX || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
}

function layerKey(layer: BedrockLayer, filename: string) {
  return `${prefix()}/${layer}/${filename}`;
}

function parquetFilename(layer: BedrockLayer) {
  return `${layer}.spatial.parquet`;
}

function parquetLayerKey(layer: BedrockLayer) {
  return layerKey(layer, `parquet/${parquetFilename(layer)}`);
}

function layerUrl(layer: BedrockLayer, filename: string) {
  const cdnBase =
    process.env.BEDROCK_NZ_CDN_BASE_URL ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    '';
  if (cdnBase.trim()) {
    return `${cdnBase.replace(/\/+$/, '')}/${layerKey(layer, filename)}`;
  }
  return `s3://${bucket()}/${layerKey(layer, filename)}`;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Invalid SQL number: ${value}`);
  return value.toString();
}

function parquetPathForDuckDb(layer: BedrockLayer) {
  return `s3://${bucket()}/${parquetLayerKey(layer)}`;
}

function pointInBbox([lon, lat]: [number, number], bbox: Bounds) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function bboxIntersects(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function geometryBbox(geometry: GeoJSON.Geometry | null | undefined): Bounds | null {
  if (!geometry) return null;

  const stack: unknown[] = [(geometry as { coordinates?: unknown }).coordinates];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  while (stack.length > 0) {
    const item = stack.pop();
    if (
      Array.isArray(item) &&
      item.length >= 2 &&
      typeof item[0] === 'number' &&
      typeof item[1] === 'number'
    ) {
      const lon = item[0];
      const lat = item[1];
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    } else if (Array.isArray(item)) {
      for (const child of item) stack.push(child);
    }
  }

  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

function normalizeAddress(
  campaignId: string,
  feature: BedrockAddressFeature
): StandardCampaignAddress {
  const props = feature.properties ?? {};
  const [lon, lat] = feature.geometry.coordinates;
  const formatted =
    props.full_address ||
    [props.unit, props.street_number, props.street_name, props.suburb, props.town_city]
      .filter(Boolean)
      .join(' ')
      .trim();

  return {
    campaign_id: campaignId,
    formatted,
    house_number: props.street_number,
    street_name: props.street_name,
    locality: props.suburb || props.town_city,
    region: 'NZ',
    postal_code: props.postcode,
    coordinate: { lat, lon },
    lat,
    lon,
    geom: JSON.stringify(feature.geometry),
    source: 'bedrock_nz',
    gers_id: props.address_id || (props.source_id ? `linz:123113:${props.source_id}` : null),
  };
}

function scanMetricOnly(scan: BedrockScanResult & { addresses?: StandardCampaignAddress[] }): BedrockScanResult {
  return {
    hits: scan.hits,
    scanned: scan.scanned,
    bboxCandidates: scan.bboxCandidates,
    seconds: scan.seconds,
    queryEngine: scan.queryEngine,
  };
}

function featureFromParquetRow(row: BedrockParquetRow): GeoJSON.Feature {
  const parsedProperties =
    typeof row.properties_json === 'string' && row.properties_json.trim()
      ? JSON.parse(row.properties_json)
      : {};
  const properties = {
    ...parsedProperties,
    ...Object.fromEntries(
      Object.entries(row).filter(([key, value]) => {
        return (
          value != null &&
          ![
            'geometry_geojson',
            'properties_json',
            'tile_z',
            'tile_x',
            'tile_y',
            'tile_key',
            'minx',
            'miny',
            'maxx',
            'maxy',
            'lon',
            'lat',
          ].includes(key)
        );
      })
    ),
  };

  const geometry =
    typeof row.geometry_geojson === 'string' && row.geometry_geojson.trim()
      ? JSON.parse(row.geometry_geojson)
      : typeof row.lon === 'number' && typeof row.lat === 'number'
        ? { type: 'Point', coordinates: [row.lon, row.lat] }
        : null;

  return {
    type: 'Feature',
    geometry,
    properties,
  } as GeoJSON.Feature;
}

function featureIntersectsPolygon(feature: GeoJSON.Feature, polygon: GeoJSON.Polygon, bbox: Bounds) {
  const geometry = feature.geometry;
  if (geometry?.type === 'Point') {
    const coordinates = geometry.coordinates as [number, number];
    return pointInBbox(coordinates, bbox) && turf.booleanPointInPolygon(turf.point(coordinates), polygon);
  }

  const featureBbox = geometryBbox(geometry);
  if (!featureBbox || !bboxIntersects(featureBbox, bbox)) return false;
  try {
    return turf.booleanIntersects(feature, polygon);
  } catch {
    return true;
  }
}

function stringProperty(properties: GeoJSON.GeoJsonProperties | null | undefined, key: string): string | null {
  const value = properties?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberProperty(properties: GeoJSON.GeoJsonProperties | null | undefined, key: string): number | null {
  const value = properties?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parcelText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasNonResidentialParcelTerm(value: unknown): boolean {
  const text = parcelText(value);
  if (!text) return false;
  return NON_RESIDENTIAL_PARCEL_TERMS.some((term) => text.includes(term));
}

function isResidentialParcelFeature(feature: GeoJSON.Feature): boolean {
  const properties = feature.properties ?? {};
  const topologyType = parcelText(properties.topology_type);
  if (topologyType && topologyType !== 'primary') return false;

  if (
    hasNonResidentialParcelTerm(properties.parcel_intent) ||
    hasNonResidentialParcelTerm(properties.appellation) ||
    hasNonResidentialParcelTerm(properties.statutory_actions) ||
    hasNonResidentialParcelTerm(properties.zoning) ||
    hasNonResidentialParcelTerm(properties.land_use) ||
    hasNonResidentialParcelTerm(properties.use)
  ) {
    return false;
  }

  const intent = parcelText(properties.parcel_intent);
  if (!intent) return true;
  return intent === 'fee simple title' || intent === 'dcdb' || intent.includes('residential');
}

function scopedBuildingFeature(feature: GeoJSON.Feature): BedrockScopedBuildingFeature | null {
  if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return null;
  const properties = feature.properties ?? {};
  const buildingId =
    stringProperty(properties, 'building_id') ??
    stringProperty(properties, 'gers_id') ??
    stringProperty(properties, 'id') ??
    stringProperty(properties, 'source_id');
  if (!buildingId) return null;

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...properties,
      gers_id: buildingId,
      building_id: buildingId,
      name: stringProperty(properties, 'name'),
      height: numberProperty(properties, 'height') ?? numberProperty(properties, 'height_m'),
      height_m: numberProperty(properties, 'height_m') ?? numberProperty(properties, 'height'),
      layer: 'building',
      primary_street: stringProperty(properties, 'primary_street') ?? stringProperty(properties, 'street_name'),
      street_name: stringProperty(properties, 'street_name'),
    },
  };
}

function scopedParcelFeature(feature: GeoJSON.Feature): BedrockScopedParcelFeature | null {
  if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return null;
  if (!isResidentialParcelFeature(feature)) return null;
  const properties = feature.properties ?? {};
  const externalId =
    stringProperty(properties, 'parcel_id') ??
    stringProperty(properties, 'external_id') ??
    stringProperty(properties, 'source_id') ??
    (typeof feature.id === 'string' ? feature.id : null);
  if (!externalId) return null;

  return {
    externalId,
    geometry:
      feature.geometry.type === 'MultiPolygon'
        ? feature.geometry
        : {
            type: 'MultiPolygon',
            coordinates: [feature.geometry.coordinates],
          },
  };
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
      for (const statement of duckDbRuntimeSetupStatements()) {
        await all(statement);
      }
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

async function queryParquetLayer(options: {
  layer: BedrockLayer;
  polygon: GeoJSON.Polygon;
  campaignId?: string;
  limit?: number;
  collectFeatures?: boolean;
}): Promise<(BedrockScanResult & { addresses?: StandardCampaignAddress[]; features?: GeoJSON.Feature[] }) | null> {
  const startedAt = Date.now();
  const territoryBbox = turf.bbox(options.polygon) as Bounds;
  const parquetPath = parquetPathForDuckDb(options.layer);
  const usesS3 = parquetPath.startsWith('s3://');
  const sql = `
    SELECT *
    FROM read_parquet(${sqlString(parquetPath)})
    WHERE maxx >= ${sqlNumber(territoryBbox[0])}
      AND minx <= ${sqlNumber(territoryBbox[2])}
      AND maxy >= ${sqlNumber(territoryBbox[1])}
      AND miny <= ${sqlNumber(territoryBbox[3])}
  `;
  const rows = await duckDbAll(sql, usesS3);
  const addresses: StandardCampaignAddress[] = [];
  const features: GeoJSON.Feature[] = [];
  let hits = 0;

  for (const row of rows) {
    const feature = featureFromParquetRow(row);
    if (!featureIntersectsPolygon(feature, options.polygon, territoryBbox)) continue;

    hits += 1;
    if (options.collectFeatures) {
      features.push(feature);
    }
    if (options.layer === 'addresses' && options.campaignId) {
      addresses.push(normalizeAddress(options.campaignId, feature as BedrockAddressFeature));
      if (options.limit && addresses.length >= options.limit) break;
    }
  }

  return {
    hits,
    scanned: rows.length,
    bboxCandidates: rows.length,
    seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    queryEngine: 'duckdb_parquet',
    ...(options.layer === 'addresses' ? { addresses } : {}),
    ...(options.collectFeatures ? { features } : {}),
  };
}

async function queryBedrockLayer(options: {
  layer: BedrockLayer;
  polygon: GeoJSON.Polygon;
  campaignId?: string;
  limit?: number;
  collectFeatures?: boolean;
}): Promise<BedrockScanResult & { addresses?: StandardCampaignAddress[]; features?: GeoJSON.Feature[] }> {
  const parquetScan = await queryParquetLayer(options);
  if (!parquetScan) {
    throw new Error(`BEDROCK New Zealand S3 Parquet layer is unavailable: ${options.layer}`);
  }
  return parquetScan;
}

export class BedrockNzService {
  static isNzRegion(regionCode: string | null | undefined) {
    return regionCode?.trim().toUpperCase() === 'NZ';
  }

  static async provisionCampaign(options: {
    campaignId: string;
    polygon: GeoJSON.Polygon;
    addressLimit?: number;
  }): Promise<{
    addresses: StandardCampaignAddress[];
    snapshot: LambdaSnapshotResponse;
    metrics: Record<string, BedrockScanResult>;
    linkGeometry: BedrockNzLinkGeometry;
  }> {
    const addressScan = await queryBedrockLayer({
      layer: 'addresses',
      polygon: options.polygon,
      campaignId: options.campaignId,
      limit: options.addressLimit,
    });
    const [buildingScan, parcelScan] = await Promise.all([
      queryBedrockLayer({ layer: 'buildings', polygon: options.polygon, collectFeatures: true }),
      queryBedrockLayer({ layer: 'parcels', polygon: options.polygon, collectFeatures: true }),
    ]);
    const addresses = addressScan.addresses ?? [];
    const addressMetrics = scanMetricOnly(addressScan);
    const buildingMetrics = scanMetricOnly(buildingScan);
    const parcelMetrics = scanMetricOnly(parcelScan);
    const buildingFeatures = (buildingScan.features ?? [])
      .map(scopedBuildingFeature)
      .filter((feature): feature is BedrockScopedBuildingFeature => Boolean(feature));
    const parcelFeatures = (parcelScan.features ?? [])
      .map(scopedParcelFeature)
      .filter((feature): feature is BedrockScopedParcelFeature => Boolean(feature));

    return {
      addresses,
      metrics: {
        addresses: addressMetrics,
        buildings: buildingMetrics,
        parcels: parcelMetrics,
      },
      linkGeometry: {
        buildings: buildingFeatures,
        parcels: parcelFeatures,
      },
      snapshot: this.snapshotForCampaign({
        campaignId: options.campaignId,
        addressCount: addresses.length,
        buildingCount: buildingScan.hits,
        parcelCount: parcelScan.hits,
        scanMetrics: {
          addresses: addressMetrics,
          buildings: buildingMetrics,
          parcels: parcelMetrics,
        },
      }),
    };
  }

  static snapshotForCampaign(options: {
    campaignId: string;
    addressCount: number;
    buildingCount: number;
    parcelCount: number;
    scanMetrics: Record<string, BedrockScanResult>;
  }): LambdaSnapshotResponse {
    const tileMetrics = {
      artifact_type: 'diamond',
      diamond_mode: true,
      bedrock_mode: true,
      bedrock_country: 'new_zealand',
      bedrock_country_code: 'NZ',
      bedrock_version: process.env.BEDROCK_NZ_VERSION || 'current',
      geometry_provider: 'pmtiles',
      pmtiles_key: layerKey('buildings', 'buildings.pmtiles'),
      tilejson_key: layerKey('buildings', 'buildings.json'),
      buildings_geojson_key: layerKey('buildings', 'buildings.geojson.gz'),
      addresses_pmtiles_key: layerKey('addresses', 'addresses.pmtiles'),
      addresses_tilejson_key: layerKey('addresses', 'addresses.json'),
      addresses_geojson_key: layerKey('addresses', 'addresses.geojson.gz'),
      parcels_pmtiles_key: layerKey('parcels', 'parcels.pmtiles'),
      parcels_tilejson_key: layerKey('parcels', 'parcels.json'),
      parcels_geojson_key: layerKey('parcels', 'parcels.geojson.gz'),
      spatial_parquet_keys: {
        addresses: parquetLayerKey('addresses'),
        buildings: parquetLayerKey('buildings'),
        parcels: parquetLayerKey('parcels'),
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
        buildings: 'LINZ NZ Building Outlines',
        addresses: 'LINZ NZ Addresses',
        parcels: 'LINZ NZ Primary Parcels',
      },
      minzoom: 12,
      maxzoom: 18,
      address_minzoom: 10,
      address_maxzoom: 16,
      parcel_minzoom: 10,
      parcel_maxzoom: 16,
      scan_metrics: options.scanMetrics,
    };

    return {
      campaign_id: options.campaignId,
      bucket: bucket(),
      prefix: prefix(),
      counts: {
        buildings: options.buildingCount,
        addresses: options.addressCount,
        roads: 0,
      },
      s3_keys: {
        buildings: layerKey('buildings', 'buildings.pmtiles'),
        addresses: layerKey('addresses', 'addresses.pmtiles'),
        metadata: `${prefix()}/bedrock-new-zealand-manifest.json`,
      },
      urls: {
        buildings: layerUrl('buildings', 'buildings.pmtiles'),
        addresses: layerUrl('addresses', 'addresses.pmtiles'),
        metadata: `s3://${bucket()}/${prefix()}/bedrock-new-zealand-manifest.json`,
      },
      metadata: {
        elapsed_ms: Object.values(options.scanMetrics).reduce(
          (sum, metric) => sum + Math.round(metric.seconds * 1000),
          0
        ),
        snapshot_size_bytes: 0,
        overture_release: 'bedrock-nz-linz',
        tile_metrics: tileMetrics as unknown as NonNullable<LambdaSnapshotResponse['metadata']>['tile_metrics'],
      },
    };
  }
}
