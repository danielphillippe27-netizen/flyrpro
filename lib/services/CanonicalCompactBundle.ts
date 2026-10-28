import { createHash } from 'node:crypto';
import type { CanonicalTileBundle, CanonicalCompactTileBundle } from '@/lib/map/canonicalTileBundle';

/** A versioned field-data contract: exact shapes live in WGP1, map shapes in PMTiles. */
export type CanonicalCompactBundle = CanonicalCompactTileBundle;

function assertNoGeometry(value: unknown, path = 'bundle'): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoGeometry(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const types = new Set(['Feature', 'FeatureCollection', 'Point', 'MultiPoint', 'LineString',
    'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
  if (typeof object.type === 'string' && types.has(object.type) &&
      ('coordinates' in object || 'geometry' in object || 'geometries' in object || 'features' in object)) {
    throw new Error(`Unexpected GeoJSON in compact field data: ${path}`);
  }
  for (const [key, item] of Object.entries(object)) assertNoGeometry(item, `${path}.${key}`);
}

export function makeCanonicalCompactBundle(base: CanonicalTileBundle): CanonicalCompactBundle {
  if (!base.tiles.geometry_pack) throw new Error('Compact field data requires exact binary geometry');
  const units = base.building_units.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid unit metadata');
    const { unit_geometry: _geometry, ...metadata } = raw as Record<string, unknown>;
    void _geometry;
    return metadata;
  });
  const roads = base.roads?.features ?? [];
  const roadRecords = roads.map((feature, index) => ({
    id: `road:${index}`, source_id: feature.id ?? null, properties: feature.properties ?? {},
  }));
  const { roads: _roads, ...fields } = base;
  void _roads;
  const result: CanonicalCompactBundle = { ...fields, schema: 'tiles-v3', asset_signature: '',
    building_units: units, road_records: roadRecords };
  assertNoGeometry(result);
  // Cache validation must change when compact-only metadata changes, even if
  // the underlying canonical bundle and tile geometry are unchanged.
  result.asset_signature = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return result;
}
