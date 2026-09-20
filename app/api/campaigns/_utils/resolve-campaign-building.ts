import type { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

export type ResolvedCampaignBuilding = {
  rowId: string | null;
  publicId: string;
};

type SnapshotBuildingGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

export type ResolvedSnapshotBuilding = ResolvedCampaignBuilding & {
  geometry: SnapshotBuildingGeometry;
  streetName: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function decodeRoutePart(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return current;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

/** Decode dynamic route params; rejoin segments when Overture ids were split on `/`. */
export function normalizeBuildingRouteId(input: string | string[]): string {
  if (Array.isArray(input)) {
    if (
      input.length >= 3 &&
      input[0]?.toLowerCase() === 'overture' &&
      input[1]?.toLowerCase() === 'building'
    ) {
      const rest = input
        .slice(2)
        .map((part) => decodeRoutePart(part))
        .filter((part) => part.trim().length > 0);
      return rest.length > 0 ? `overture:building:${rest.join(':')}` : '';
    }
    const parts = input
      .map((part) => decodeRoutePart(part))
      .filter((part) => part.trim().length > 0);
    return parts.length > 0 ? parts.join('/') : '';
  }

  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return decodeRoutePart(trimmed);
}

/** All identifiers to try when resolving a map building id (e.g. overture:building:{uuid}). */
export function buildingIdentifierCandidates(buildingIdParam: string): string[] {
  const trimmed = buildingIdParam.trim();
  if (!trimmed) return [];

  const candidates = [trimmed];
  const embedded = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
  );
  if (embedded && embedded[0].toLowerCase() !== trimmed.toLowerCase()) {
    candidates.push(embedded[0]);
  }

  return [...new Set(candidates)];
}

/** Tile/snapshot building ids (Overture GERS, etc.) that may not have a campaign buildings row yet. */
export function isSnapshotBuildingIdentifier(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes(':')) return true;
  return isUuid(trimmed);
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolve geometry and display metadata embedded in a canonical map bundle. */
export function resolveSnapshotBuilding(
  buildingsGeoJSON: unknown,
  buildingIdParam: string | string[]
): ResolvedSnapshotBuilding | null {
  const requested = new Set(
    buildingIdentifierCandidates(normalizeBuildingRouteId(buildingIdParam)).map(value => value.toLowerCase())
  );
  if (requested.size === 0) return null;

  const collection = snapshotRecord(buildingsGeoJSON);
  const features = Array.isArray(collection?.features) ? collection.features : [];
  for (const rawFeature of features) {
    const feature = snapshotRecord(rawFeature);
    const properties = snapshotRecord(feature?.properties) ?? {};
    const propertyCandidates = Array.isArray(properties.building_identifier_candidates)
      ? properties.building_identifier_candidates
      : [];
    const identifiers = [
      feature?.id,
      properties.id,
      properties.gers_id,
      properties.building_id,
      properties.public_building_id,
      properties.canonical_building_id,
      ...propertyCandidates,
    ].flatMap(value => {
      const identifier = snapshotString(value);
      return identifier ? buildingIdentifierCandidates(identifier) : [];
    });
    if (!identifiers.some(identifier => requested.has(identifier.toLowerCase()))) continue;

    const geometry = snapshotRecord(feature?.geometry);
    if (
      (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') ||
      !Array.isArray(geometry.coordinates)
    ) continue;

    const publicId = identifiers[0];
    if (!publicId) continue;
    return {
      rowId: null,
      publicId,
      geometry: geometry as SnapshotBuildingGeometry,
      streetName: snapshotString(properties.street_name)
        ?? snapshotString(properties.addr_street)
        ?? snapshotString(properties.primary_street_name),
    };
  }

  return null;
}

export async function resolveCampaignBuilding(
  supabase: AdminClient,
  campaignId: string,
  buildingIdParam: string | string[]
): Promise<ResolvedCampaignBuilding | null> {
  const normalizedParam = normalizeBuildingRouteId(buildingIdParam);
  const candidates = buildingIdentifierCandidates(normalizedParam);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const buildingQuery = supabase
      .from('buildings')
      .select('id, gers_id')
      .eq('campaign_id', campaignId)
      .limit(1);

    const { data: row, error } = isUuid(candidate)
      ? await buildingQuery.or(`id.eq.${candidate},gers_id.eq.${candidate}`).maybeSingle()
      : await buildingQuery.eq('gers_id', candidate).maybeSingle();

    if (!error && row) {
      return {
        rowId: row.id,
        publicId: row.gers_id ?? row.id,
      };
    }
  }

  for (const candidate of candidates) {
    if (!isUuid(candidate)) continue;
    const { data: goldRow } = await supabase
      .from('ref_buildings_gold')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();

    if (goldRow) {
      return { rowId: null, publicId: String(goldRow.id) };
    }
  }

  const primary = candidates[0];
  if (isSnapshotBuildingIdentifier(primary)) {
    return { rowId: null, publicId: primary };
  }

  return null;
}
