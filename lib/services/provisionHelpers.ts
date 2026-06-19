import type { StandardCampaignAddress } from '@/lib/services/AddressAdapter';
import type { LambdaSnapshotResponse } from '@/lib/services/TileLambdaService';

type StaticGeometrySnapshot = {
  buildings_key?: string | null;
  addresses_key?: string | null;
  s3_keys?: {
    buildings?: string | null;
    addresses?: string | null;
  };
  metadata?: {
    tile_metrics?: Record<string, unknown> | null;
  } | null;
};

export function normalizeAddressFragment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeSource(value: string | null | undefined): string {
  const normalized = normalizeAddressFragment(value);
  return normalized || 'unknown';
}

export function normalizeExternalAddressId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function externalAddressId(address: { gers_id?: string | null; source_id?: string | null }): string {
  return normalizeExternalAddressId(address.gers_id ?? address.source_id);
}

export function buildAddressSignature(address: {
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
}): string {
  const houseNumber = normalizeAddressFragment(address.house_number);
  const streetName = normalizeAddressFragment(address.street_name);
  const locality = normalizeAddressFragment(address.locality);
  const postalCode = normalizeAddressFragment(address.postal_code);

  if (houseNumber || streetName || locality) {
    return `${houseNumber}|${streetName}|${locality}`;
  }

  const formatted = normalizeAddressFragment(address.formatted);
  return `${formatted}|${postalCode}`;
}

export function buildAddressIdentity(address: {
  campaign_id: string;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  source?: string | null;
  source_id?: string | null;
  gers_id?: string | null;
}): string {
  const source = normalizeSource(address.source);
  const externalId = externalAddressId(address);
  if (externalId) {
    return `${address.campaign_id}|${source}|external|${externalId}`;
  }

  return `${address.campaign_id}|${source}|address|${buildAddressSignature(address)}`;
}

export function deduplicateAddressesByProvisionKey(
  addresses: StandardCampaignAddress[]
): StandardCampaignAddress[] {
  const deduped = new Map<string, StandardCampaignAddress>();

  for (const address of addresses) {
    const externalId = externalAddressId(address);
    deduped.set(buildAddressIdentity(address), {
      ...address,
      gers_id: externalId || null,
    });
  }

  return [...deduped.values()];
}

export function filterAddressesAgainstExisting(
  addresses: StandardCampaignAddress[],
  existingSignatures: Set<string>
): StandardCampaignAddress[] {
  const accepted: StandardCampaignAddress[] = [];
  const seenThisBatch = new Set<string>();

  for (const address of addresses) {
    const signature = buildAddressIdentity(address);
    const hasExternalId = Boolean(externalAddressId(address));
    if ((!hasExternalId && existingSignatures.has(signature)) || seenThisBatch.has(signature)) {
      continue;
    }
    seenThisBatch.add(signature);
    accepted.push(address);
  }

  return accepted;
}

export function stringTileMetric(
  metrics: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function snapshotHasStaticPmtilesGeometry(
  snapshot: (LambdaSnapshotResponse | StaticGeometrySnapshot) | null | undefined
): boolean {
  if (!snapshot) return false;

  const metrics = snapshot.metadata?.tile_metrics;
  const buildingsKey = 'buildings_key' in snapshot ? snapshot.buildings_key : snapshot.s3_keys?.buildings;
  const addressesKey = 'addresses_key' in snapshot ? snapshot.addresses_key : snapshot.s3_keys?.addresses;

  return [
    buildingsKey,
    addressesKey,
    stringTileMetric(metrics, 'pmtiles_key'),
    stringTileMetric(metrics, 'addresses_pmtiles_key'),
    stringTileMetric(metrics, 'parcels_pmtiles_key'),
  ].some((key) => typeof key === 'string' && key.toLowerCase().endsWith('.pmtiles'));
}

export function bboxFromPolygon(polygon: GeoJSON.Polygon): [number, number, number, number] | null {
  const positions = polygon.coordinates.flat().filter(
    (position): position is [number, number] =>
      Array.isArray(position) &&
      typeof position[0] === 'number' &&
      typeof position[1] === 'number' &&
      Number.isFinite(position[0]) &&
      Number.isFinite(position[1])
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

  return [minLon, minLat, maxLon, maxLat];
}

export function featureCollectionCount(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const features = (value as { features?: unknown }).features;
  return Array.isArray(features) ? features.length : 0;
}

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes('fetch failed') ||
    error.message.includes('ECONNRESET') ||
    error.message.includes('closed') ||
    error.message.includes('Connection Error') ||
    error.message.includes('established') ||
    error.message.includes('timeout') ||
    error.message.includes('exceeded')
  );
}

export function provisionFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 500) || 'Provisioning failed';
}

export function isUniqueConstraintError(error: { message?: string; code?: string; details?: string } | null): boolean {
  if (!error) {
    return false;
  }

  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return error.code === '23505' || text.includes('unique') || text.includes('constraint') || text.includes('conflict');
}

export function shouldFailZeroAddressProvision(params: {
  hasResolvedAddresses: boolean;
  hasStaticGeometry: boolean;
}): boolean {
  return !params.hasResolvedAddresses && !params.hasStaticGeometry;
}
