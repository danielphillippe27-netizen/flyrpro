import type { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

export type ResolvedCampaignBuilding = {
  rowId: string | null;
  publicId: string;
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
