import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { isCampaignBoundary, previewRoadBoundary } from '../road-boundary';

const origin = [-78.74, 43.91];
const point = (x: number, y: number) => [origin[0] + x / 80_000, origin[1] + y / 111_000];
const line = (name: string, coords: number[][]) =>
  turf.lineString(coords.map(([x, y]) => point(x, y)), { name, class: 'street' });
const boundary = (offset = 6) => turf.polygon([[
  point(offset, offset), point(120, offset), point(120, 100), point(offset, 100), point(offset, offset),
]]).geometry;
const near = (actual: number[], expected: number[]) =>
  turf.distance(actual, expected, { units: 'meters' }) < 0.1;

test('preserves the bend and joins a cross street at its intersection', () => {
  const original = boundary();
  const roads = [
    line('Main', [[-20, 0], [0, 0], [60, 3], [150, 0]]),
    line('Cross', [[0, 125], [0, 0], [0, -25]]),
  ];
  const result = previewRoadBoundary(original, roads);
  assert.ok(result && isCampaignBoundary(result));
  assert.ok(near(result.coordinates[0][0], point(0, 0)));
  assert.ok(result.coordinates[0].some(vertex => near(vertex, point(60, 3))));
  assert.ok(result.coordinates[0].some(vertex => near(vertex, point(120, 100))));
});

test('can follow same street geometry across adjoining fragments', () => {
  const result = previewRoadBoundary(boundary(), [
    line('Main', [[-20, 0], [45, 1]]),
    line('Main', [[150, 0], [75, 3], [45, 1]]),
  ]);
  assert.ok(result);
  assert.ok(result.coordinates[0].some(vertex => near(vertex, point(45, 1))));
  assert.ok(result.coordinates[0].some(vertex => near(vertex, point(75, 3))));
});

test('keeps the drawing when roads are too far away or equally plausible', () => {
  assert.equal(previewRoadBoundary(boundary(20), [line('Main', [[-20, 0], [150, 0]])]), null);
  assert.equal(previewRoadBoundary(boundary(), [
    line('Main', [[-20, 0], [150, 0]]),
    line('Parallel', [[-20, 12], [150, 12]]),
  ]), null);
});

test('rejects a road whose bend exits the 15 metre corridor', () => {
  assert.equal(previewRoadBoundary(boundary(), [line('Main', [[0, 0], [60, -20], [120, 0]])]), null);
});

test('rejects self-intersecting and malformed input', () => {
  assert.equal(isCampaignBoundary({ type: 'Polygon', coordinates: [[null, null, null, null]] }), false);
  assert.equal(isCampaignBoundary({ type: 'Polygon', coordinates: [[
    point(0, 0), point(100, 100), point(100, 0), point(0, 100), point(0, 0),
  ]] }), false);
});

test('keeps an eligible edge when the shared corner cannot reach the intersection', () => {
  const corner = point(12, 12);
  const drawn = turf.polygon([[
    corner, point(120, 8), point(120, 100), point(13, 100), corner,
  ]]).geometry;
  const result = previewRoadBoundary(drawn, [
    line('Main', [[-20, 0], [150, 0]]),
    line('Cross', [[0, -20], [0, 125]]),
  ]);
  assert.ok(result && isCampaignBoundary(result));
  assert.ok(turf.distance(corner, result.coordinates[0][0], { units: 'meters' }) <= 15);
  assert.ok(near(result.coordinates[0][0], point(12, 0)));
});
