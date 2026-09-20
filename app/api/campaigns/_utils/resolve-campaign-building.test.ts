import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSnapshotBuilding } from './resolve-campaign-building';

test('resolves an Overture building and geometry from the canonical bundle', () => {
  const resolved = resolveSnapshotBuilding({
    type: 'FeatureCollection',
    features: [{
      id: 'overture:building:0e833775-48a7-4619-b4f0-7ff5616fa1a1',
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-79.67, 43.58], [-79.66, 43.58], [-79.67, 43.58]]],
      },
      properties: {
        canonical_building_id: 'overture:building:0e833775-48a7-4619-b4f0-7ff5616fa1a1',
        street_name: 'Penhallow RD',
      },
    }],
  }, 'overture%3Abuilding%3A0e833775-48a7-4619-b4f0-7ff5616fa1a1');

  assert.equal(resolved?.publicId, 'overture:building:0e833775-48a7-4619-b4f0-7ff5616fa1a1');
  assert.equal(resolved?.streetName, 'Penhallow RD');
  assert.equal(resolved?.geometry.type, 'Polygon');
});

test('does not resolve an unrelated canonical building', () => {
  const resolved = resolveSnapshotBuilding({
    type: 'FeatureCollection',
    features: [{
      id: 'overture:building:11111111-1111-4111-8111-111111111111',
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {},
    }],
  }, 'overture:building:22222222-2222-4222-8222-222222222222');

  assert.equal(resolved, null);
});
