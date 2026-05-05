import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type CampaignSnapshotRow = {
  bucket: string;
  prefix: string | null;
  buildings_key: string | null;
  buildings_url: string | null;
  metadata_key: string | null;
  buildings_count: number | null;
  created_at: string | null;
  tile_metrics: Record<string, unknown> | null;
};

type MapArtifactType = 'diamond' | 'white_gold' | 'basic';

type MapArtifactResolution = {
  mapStatus: 'ready';
  artifactType: MapArtifactType;
  geometryProvider: 'pmtiles' | 'address_points';
  pmtilesKey: string | null;
  fallbackGeojsonKey: string | null;
};

type ParcelPmtilesResolution = {
  bucket: string;
  pmtilesKey: string;
  tilejsonKey: string;
  datePart: string;
  sourceLayer: 'parcels';
  promoteId: 'parcel_id';
  minzoom: number;
  maxzoom: number;
};

let s3Client: S3Client | null = null;
const parcelPmtilesCache = new Map<string, Promise<ParcelPmtilesResolution | null>>();

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
    });
  }
  return s3Client;
}

function joinUrl(baseUrl: string, key: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

function stringMetric(metrics: Record<string, unknown> | null, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function resolvePmtilesKey(snapshot: CampaignSnapshotRow): string | null {
  const metricKey = stringMetric(snapshot.tile_metrics, 'pmtiles_key');
  if (metricKey) return metricKey;

  if (snapshot.buildings_key?.endsWith('.pmtiles')) {
    return snapshot.buildings_key;
  }

  const prefix = stringMetric(snapshot.tile_metrics, 'diamond_prefix') || snapshot.prefix;
  if (!prefix) return null;
  return `${prefix.replace(/\/+$/, '')}/buildings.pmtiles`;
}

export function resolveCampaignMapArtifact(
  snapshot: CampaignSnapshotRow | null | undefined
): MapArtifactResolution {
  if (!snapshot) {
    return {
      mapStatus: 'ready',
      artifactType: 'basic',
      geometryProvider: 'address_points',
      pmtilesKey: null,
      fallbackGeojsonKey: null,
    };
  }

  const pmtilesKey = resolvePmtilesKey(snapshot);
  const fallbackGeojsonKey = resolveFallbackGeoJSONKey(snapshot);
  if (!pmtilesKey) {
    return {
      mapStatus: 'ready',
      artifactType: 'basic',
      geometryProvider: 'address_points',
      pmtilesKey: null,
      fallbackGeojsonKey,
    };
  }

  const explicitType = stringMetric(snapshot.tile_metrics, 'artifact_type');
  const artifactType =
    explicitType === 'diamond' || snapshot.tile_metrics?.diamond_mode === true
      ? 'diamond'
      : explicitType === 'white_gold' || pmtilesKey.includes('/white-gold/')
        ? 'white_gold'
        : 'diamond';

  return {
    mapStatus: 'ready',
    artifactType,
      geometryProvider: 'pmtiles',
    pmtilesKey,
    fallbackGeojsonKey,
  };
}

export function resolveFallbackGeoJSONKey(snapshot: CampaignSnapshotRow): string | null {
  const metricKey =
    stringMetric(snapshot.tile_metrics, 'geojson_key') ||
    stringMetric(snapshot.tile_metrics, 'buildings_geojson_key');
  if (metricKey) return metricKey;

  if (snapshot.buildings_key && !snapshot.buildings_key.endsWith('.pmtiles')) {
    return snapshot.buildings_key;
  }

  const prefix = stringMetric(snapshot.tile_metrics, 'diamond_prefix') || snapshot.prefix;
  if (!prefix) return null;
  return `${prefix.replace(/\/+$/, '')}/buildings.geojson.gz`;
}

export function resolveGeometryVersion(snapshot: CampaignSnapshotRow): number {
  return (
    numberMetric(snapshot.tile_metrics, 'geometry_version') ??
    numberMetric(snapshot.tile_metrics, 'pmtiles_version') ??
    (snapshot.created_at ? Date.parse(snapshot.created_at) : Date.now())
  );
}

export function resolveGeometryEtag(snapshot: CampaignSnapshotRow): string | null {
  return (
    stringMetric(snapshot.tile_metrics, 'pmtiles_etag') ??
    stringMetric(snapshot.tile_metrics, 'geometry_etag') ??
    null
  );
}

export async function createPresignedS3Url(bucket: string, key: string, expiresIn = 3600) {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );
}

export function geometryCdnBaseUrl() {
  return (
    process.env.DIAMOND_GEOMETRY_CDN_BASE_URL ||
    process.env.CLOUDFRONT_GEOMETRY_BASE_URL ||
    process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL ||
    null
  );
}

export async function resolveArtifactUrl(snapshot: CampaignSnapshotRow, key: string) {
  const cdnBaseUrl = geometryCdnBaseUrl();

  if (cdnBaseUrl) {
    return joinUrl(cdnBaseUrl, key);
  }

  if (key === snapshot.buildings_key && snapshot.buildings_url && !key.endsWith('.pmtiles')) {
    return snapshot.buildings_url;
  }

  return createPresignedS3Url(snapshot.bucket, key);
}

export function parcelTilesBucket(defaultBucket?: string | null) {
  return (
    process.env.PARCEL_TILES_BUCKET ||
    process.env.WHITE_GOLD_GEOMETRY_BUCKET ||
    process.env.DIAMOND_GEOMETRY_BUCKET ||
    process.env.FLYR_SNAPSHOTS_BUCKET ||
    process.env.AWS_BUCKET_NAME ||
    defaultBucket ||
    'flyr-pro-addresses-2025'
  );
}

export async function resolveLatestParcelPmtilesKeys(
  regionCode: string | null | undefined,
  options: {
    bucket?: string | null;
    countrySlug?: string;
  } = {}
): Promise<ParcelPmtilesResolution | null> {
  const normalizedRegion = regionCode?.trim().toLowerCase();
  if (!normalizedRegion || !/^[a-z]{2}$/.test(normalizedRegion)) return null;

  const bucket = parcelTilesBucket(options.bucket);
  const countrySlug = options.countrySlug ?? process.env.PARCEL_TILES_COUNTRY_SLUG ?? 'us';
  const rootPrefix = (process.env.PARCEL_TILES_ROOT_PREFIX ?? 'tiles').replace(/^\/+|\/+$/g, '');
  const sourceId = `${normalizedRegion}_parcels`;
  const basePrefix = `${rootPrefix}/${countrySlug}/${normalizedRegion}/${sourceId}`;
  const configuredDate = process.env.PARCEL_PMTILES_DATE || process.env.LANDGRID_PARCELS_DATE;
  const cacheKey = `${bucket}:${basePrefix}:${configuredDate ?? 'latest'}`;

  let cached = parcelPmtilesCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      if (configuredDate && /^\d{8}$/.test(configuredDate)) {
        const pmtilesKey = `${basePrefix}/${configuredDate}/${sourceId}.pmtiles`;
        return {
          bucket,
          pmtilesKey,
          tilejsonKey: `${basePrefix}/${configuredDate}/${sourceId}.json`,
          datePart: configuredDate,
          sourceLayer: 'parcels',
          promoteId: 'parcel_id',
          minzoom: 10,
          maxzoom: 15,
        } satisfies ParcelPmtilesResolution;
      }

      let continuationToken: string | undefined;
      let latest: { key: string; datePart: string } | null = null;

      do {
        const response = await getS3Client().send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `${basePrefix}/`,
            ContinuationToken: continuationToken,
          })
        );

        for (const object of response.Contents ?? []) {
          const key = object.Key ?? '';
          const match = key.match(new RegExp(`^${escapeRegExp(basePrefix)}/(\\d{8})/${escapeRegExp(sourceId)}\\.pmtiles$`));
          if (!match) continue;
          const datePart = match[1];
          if (!latest || datePart > latest.datePart) {
            latest = { key, datePart };
          }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);

      if (!latest) return null;

      return {
        bucket,
        pmtilesKey: latest.key,
        tilejsonKey: latest.key.replace(/\.pmtiles$/i, '.json'),
        datePart: latest.datePart,
        sourceLayer: 'parcels',
        promoteId: 'parcel_id',
        minzoom: 10,
        maxzoom: 15,
      } satisfies ParcelPmtilesResolution;
    })();
    parcelPmtilesCache.set(cacheKey, cached);
  }

  return cached;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { CampaignSnapshotRow, MapArtifactResolution, MapArtifactType, ParcelPmtilesResolution };
