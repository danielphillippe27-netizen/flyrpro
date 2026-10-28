/** The versioned, geometry-independent contract shared by the three map clients. */
export const CANONICAL_TILE_SCHEMA = 'tiles-v2' as const;
export type CanonicalEntityKind = 'building' | 'address' | 'parcel';
export type CanonicalMapRecord = {
  id: string;
  feature_id: string;
  coordinate: [number, number];
  bounds: [number, number, number, number];
  properties: Record<string, unknown>;
};
export type CanonicalTileLayer = {
  source_layer: string;
  promote_id: 'feature_id';
  minzoom: number;
  maxzoom: number;
  count: number;
};
export type CanonicalTileManifest = {
  geometry_revision: string;
  tile_url_template: string;
  archive_url: string;
  sha256: string;
  byte_length: number;
  bounds: [number, number, number, number];
  layers: Record<string, CanonicalTileLayer>;
  geometry_pack?: { url: string; sha256: string; byte_length: number; count: number };
};
export type CanonicalTileBundle = {
  schema: typeof CANONICAL_TILE_SCHEMA;
  campaign_id: string;
  asset_signature: string;
  source_version: string;
  canonical_signature: string;
  tiles: CanonicalTileManifest;
  records: {
    buildings: CanonicalMapRecord[];
    addresses: CanonicalMapRecord[];
    parcels: CanonicalMapRecord[];
  };
  links: unknown[];
  address_orphans: unknown[];
  building_orphans: unknown[];
  building_units: unknown[];
  counts: Record<string, unknown>;
  display_mode_hint: string;
  links_status: string;
  built_at?: string | null;
  expires_at?: string | null;
  updated_at?: string | null;
  layer_fetched_at?: Record<string, unknown>;
  reconciliation: unknown;
  reconciliation_report: unknown;
  // Small interactive overlays are deliberately separate from tiled geometry.
  roads: GeoJSON.FeatureCollection;
};
export type CanonicalCompactTileBundle = Omit<CanonicalTileBundle, 'schema' | 'roads'> & {
  schema: 'tiles-v3';
  road_records: { id: string; source_id: string | number | null; properties: Record<string, unknown> }[];
};
export type CanonicalClientTileBundle = CanonicalTileBundle | CanonicalCompactTileBundle;

export function canonicalFeatureId(kind: CanonicalEntityKind, id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error(`Missing canonical ${kind} identity`);
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  return `${kind}:${uuid.test(trimmed) ? trimmed.toLowerCase() : trimmed}`;
}

export function isCanonicalTileBundle(value: unknown): value is CanonicalClientTileBundle {
  const bundle = value as Partial<CanonicalClientTileBundle> | null;
  const versionValid = bundle?.schema === CANONICAL_TILE_SCHEMA ||
    (bundle?.schema === 'tiles-v3' && Boolean(bundle.tiles?.geometry_pack) && Array.isArray(bundle.road_records));
  return versionValid && Boolean(bundle?.tiles?.geometry_revision)
    && Array.isArray(bundle.records?.addresses) && Array.isArray(bundle.records?.buildings)
    && Array.isArray(bundle.records?.parcels);
}

/** A tile hit supplies identity only. Tile geometry can be clipped or duplicated. */
export function canonicalRecordForHit(
  bundle: CanonicalClientTileBundle, featureId: string
): { kind: CanonicalEntityKind; record: CanonicalMapRecord } | null {
  for (const [kind, records] of [
    ['building', bundle.records.buildings], ['address', bundle.records.addresses],
    ['parcel', bundle.records.parcels],
  ] as const) {
    const record = records.find((candidate) => candidate.feature_id === featureId);
    if (record) return { kind, record };
  }
  return null;
}
