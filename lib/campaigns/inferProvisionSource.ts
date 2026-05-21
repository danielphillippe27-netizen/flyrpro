import type { CampaignProvisionSource } from '@/types/database';

type SnapshotLike = {
  buildings_key?: string | null;
  tile_metrics?: Record<string, unknown> | null;
} | null | undefined;

const BEDROCK_PROVISION_SOURCES = new Set<CampaignProvisionSource>([
  'bedrock_nz',
  'bedrock_au',
  'bedrock_ca',
  'bedrock_us',
  'bedrock_za',
  'bedrock_uk',
]);

function metricFlag(metrics: Record<string, unknown> | null | undefined, key: string): boolean {
  const value = metrics?.[key];
  return value === true || value === 'true';
}

function metricString(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function usesStaticGeometrySnapshot(snapshot: SnapshotLike): boolean {
  if (!snapshot) return false;

  const metrics = snapshot.tile_metrics;
  if (metricFlag(metrics, 'bedrock_mode') || metricFlag(metrics, 'diamond_mode')) {
    return true;
  }

  const pmtilesKey =
    metricString(metrics, 'pmtiles_key') ??
    (snapshot.buildings_key?.endsWith('.pmtiles') ? snapshot.buildings_key : null);
  if (pmtilesKey) return true;

  const geojsonKey =
    metricString(metrics, 'buildings_geojson_key') ?? metricString(metrics, 'geojson_key');
  if (geojsonKey) return true;

  return Boolean(snapshot.buildings_key);
}

export function inferProvisionSourceFromSnapshot(
  snapshot: SnapshotLike,
  region?: string | null
): CampaignProvisionSource | null {
  if (!usesStaticGeometrySnapshot(snapshot)) return null;

  const metrics = snapshot?.tile_metrics ?? null;
  const countryCode = metricString(metrics, 'bedrock_country_code')?.toUpperCase() ?? null;
  const country = metricString(metrics, 'bedrock_country')?.toLowerCase() ?? null;
  const pmtilesKey = (
    metricString(metrics, 'pmtiles_key') ??
    snapshot?.buildings_key ??
    ''
  ).toLowerCase();
  const regionCode = String(region ?? '').trim().toUpperCase();

  if (countryCode === 'CA' || country === 'canada' || pmtilesKey.includes('/canada/')) {
    return 'bedrock_ca';
  }
  if (countryCode === 'US' || country === 'usa' || pmtilesKey.includes('/usa/')) {
    return 'bedrock_us';
  }
  if (countryCode === 'AU' || country === 'australia' || pmtilesKey.includes('/australia/')) {
    return 'bedrock_au';
  }
  if (countryCode === 'NZ' || country === 'new_zealand' || country === 'new-zealand' || pmtilesKey.includes('/new-zealand/')) {
    return 'bedrock_nz';
  }
  if (countryCode === 'ZA' || country === 'south_africa' || country === 'south-africa' || pmtilesKey.includes('/south-africa/')) {
    return 'bedrock_za';
  }
  if (countryCode === 'GB' || countryCode === 'UK' || country === 'uk' || pmtilesKey.includes('/uk/')) {
    return 'bedrock_uk';
  }

  if (metricFlag(metrics, 'bedrock_mode')) {
    if (regionCode === 'CA') return 'bedrock_ca';
    if (regionCode.length === 2 && regionCode !== 'CA') return 'bedrock_us';
  }

  if (metricFlag(metrics, 'diamond_mode') || metricString(metrics, 'artifact_type') === 'diamond') {
    return 'diamond';
  }

  return null;
}

export function shouldSkipLegacyMapBundleBuildings(params: {
  provisionSource?: string | null;
  snapshot?: SnapshotLike;
}): boolean {
  const source = String(params.provisionSource ?? '').toLowerCase();
  if (source === 'diamond' || BEDROCK_PROVISION_SOURCES.has(source as CampaignProvisionSource)) {
    return true;
  }
  return usesStaticGeometrySnapshot(params.snapshot ?? null);
}
