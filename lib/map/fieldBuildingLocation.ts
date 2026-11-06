import type { CanonicalMapRecord } from './canonicalTileBundle';

export function isAutomaticBuildingLocation(provenance: string): boolean {
  return ['field_building_location', 'field_building_reverse_geocode',
    'field_building_location_unresolved'].includes(provenance);
}

/** Resolve only an exact, unambiguous identity in the authorized campaign. */
export function findFieldBuilding(records: CanonicalMapRecord[], requestedId: string): CanonicalMapRecord | null {
  const key = requestedId.trim().toLowerCase();
  if (!key) return null;
  const matches = records.filter(record => [record.id, record.properties.gers_id,
    record.properties.building_id, record.properties.row_id].some(value =>
    typeof value === 'string' && value.trim().toLowerCase() === key));
  return matches.length === 1 ? matches[0] : null;
}
