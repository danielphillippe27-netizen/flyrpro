import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as wkx from 'wkx';
import { CanonicalGeometryPack, canonicalGeometryEntries, encodeCanonicalGeometryPack } from '../CanonicalGeometryPack';
import { prepareCanonicalTiles } from '../CanonicalTilePreparation';

const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [
  [[-78.8, 43.9], [-78.7, 43.9], [-78.7, 44], [-78.8, 43.9]],
  [[-78.79, 43.91], [-78.78, 43.91], [-78.78, 43.92], [-78.79, 43.91]],
] };
const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [polygon.coordinates, [[
  [-78.6, 43.9], [-78.5, 43.9], [-78.5, 44], [-78.6, 43.9],
]]] };
const entries = [{ id: 'parcel:lot-B', geometry: multi }, { id: 'building:home-A', geometry: polygon }];
const bytes = encodeCanonicalGeometryPack(entries);
assert.deepEqual(bytes, encodeCanonicalGeometryPack([...entries].reverse()), 'Ordering is stable');
const decoded = new CanonicalGeometryPack(bytes);
for (const entry of entries) assert.deepEqual(wkx.Geometry.parse(decoded.get(entry.id)!).toGeoJSON(), entry.geometry);
assert.equal(decoded.get('building:missing'), undefined);
assert.throws(() => encodeCanonicalGeometryPack([entries[0], entries[0]]), /Duplicate/);
assert.throws(() => new CanonicalGeometryPack(bytes.subarray(0, bytes.length - 1)), /Invalid|Truncated/);
assert.throws(() => new CanonicalGeometryPack(Buffer.concat([bytes, Buffer.from([0])])), /Unexpected/);
if (process.env.CANONICAL_GEOMETRY_FIXTURE) {
  // The real fixture stays outside the repository: campaign data is private.
  const bundle = JSON.parse(readFileSync(process.env.CANONICAL_GEOMETRY_FIXTURE, 'utf8'));
  const prepared = prepareCanonicalTiles(bundle);
  const realEntries = canonicalGeometryEntries(prepared.collections, bundle.roads, bundle.building_units, bundle.addresses);
  const pack = new CanonicalGeometryPack(encodeCanonicalGeometryPack(realEntries));
  assert.equal(pack.size, realEntries.length);
  for (const entry of realEntries) {
    const expected = { ...entry.geometry } as GeoJSON.Geometry & { crs?: unknown; bbox?: unknown };
    delete expected.crs; delete expected.bbox; // WGP1 declares WGS84 for the entire pack.
    assert.deepEqual(wkx.Geometry.parse(pack.get(entry.id)!).toGeoJSON(), expected, `Shape changed: ${entry.id}`);
  }
  console.log(`PASS: ${pack.size} exact real-campaign shapes round-trip`);
}
console.log('PASS: exact polygon holes, multipolygons, stable IDs and corrupt pack rejection');
