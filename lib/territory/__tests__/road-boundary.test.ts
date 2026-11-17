import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { isCampaignBoundary, previewRoadBoundary } from '../road-boundary';

const origin = [-78.74, 43.91];
const point = (x: number, y: number) => [origin[0] + x / 80_000, origin[1] + y / 111_000];
const line = (coords: number[][]) => turf.lineString(coords.map(([x, y]) => point(x, y)));
const near = (actual: number[], expected: number[]) =>
  turf.distance(actual, expected, { units: 'meters' }) < 0.1;

test('moves each corner to the closest position on a road within 50 metres', () => {
  const ring = [point(10, 32), point(120, 12), point(120, 105), point(10, 105), point(10, 32)];
  const result = previewRoadBoundary(turf.polygon([ring]).geometry, [
    line([[-20, 0], [150, 0]]),
    line([[-20, 50], [55, 50]]),
    line([[-5, -20], [-5, 30]]),
  ]);
  assert.ok(result && isCampaignBoundary(result));
  const [first, second, third, fourth, closed] = result.coordinates[0];
  assert.ok(near(first, point(-5, 30)));
  assert.ok(near(second, point(120, 0)));
  assert.deepEqual([third, fourth, closed], [ring[2], ring[3], first]);
});

test('ignores roads beyond 50 metres', () => {
  const ring = [point(0, 51), point(120, 51), point(120, 105), point(0, 105), point(0, 51)];
  assert.equal(previewRoadBoundary(turf.polygon([ring]).geometry, [line([[-20, 0], [150, 0]])]), null);
});

test('preserves a valid polygon when snapping every point would collapse it', () => {
  const ring = [point(0, 9), point(30, 9), point(30, 27), point(0, 27), point(0, 9)];
  const result = previewRoadBoundary(turf.polygon([ring]).geometry, [line([[-20, 0], [150, 0]])]);
  assert.ok(result && isCampaignBoundary(result));
  assert.ok(near(result.coordinates[0][0], point(0, 0)));
  assert.deepEqual(result.coordinates[0][2], ring[2]);
});

test('rejects self-intersecting and malformed input', () => {
  assert.equal(isCampaignBoundary({ type: 'Polygon', coordinates: [[null, null, null, null]] }), false);
  assert.equal(isCampaignBoundary({ type: 'Polygon', coordinates: [[
    point(0, 0), point(100, 100), point(100, 0), point(0, 100), point(0, 0),
  ]] }), false);
});
