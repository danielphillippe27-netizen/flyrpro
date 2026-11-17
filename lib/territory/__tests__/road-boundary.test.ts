import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { isCampaignBoundary, previewRoadBoundary, snapRoadPoints } from '../road-boundary';

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

test('snaps the first drawing point and a moved point without requiring a polygon', async () => {
  const { snapRoadPoints } = await import('../road-boundary');
  const roads = [line([[-20, 0], [150, 0]]), line([[-20, 40], [150, 40]])];
  assert.ok(near(snapRoadPoints([point(15, 9)], roads)[0], point(15, 0)));
  assert.ok(near(snapRoadPoints([point(15, 34)], roads)[0], point(15, 40)));
  assert.deepEqual(snapRoadPoints([point(15, 95)], roads)[0], point(15, 95));
});


test('prefers a crossroad or T junction within 20 metres', () => {
  const main = line([[-100, 0], [100, 0]]);
  for (const cross of [line([[0, -100], [0, 100]]), line([[0, 0], [0, 100]])]) {
    assert.ok(near(snapRoadPoints([point(12, 4)], [main, cross])[0], point(0, 0)));
  }
});

test('keeps midblock points on the closest road outside the intersection radius', () => {
  const roads = [line([[-100, 0], [100, 0]]), line([[0, -100], [0, 100]])];
  assert.ok(near(snapRoadPoints([point(35, 4)], roads)[0], point(35, 0)));
});

test('does not treat a bend, duplicated tile, or bridge crossing as an intersection', () => {
  const main = line([[-100, 0], [100, 0]]);
  const bridge = line([[0, -100], [0, 100]]);
  bridge.properties = { structure: 'bridge' };
  assert.ok(near(snapRoadPoints([point(12, 4)], [main, bridge])[0], point(12, 0)));
  assert.ok(near(snapRoadPoints([point(12, 4)], [main, main])[0], point(12, 0)));
  const bend = [line([[-100, 0], [0, 0]]), line([[0, 0], [0, 100]])];
  assert.ok(near(snapRoadPoints([point(4, 12)], bend)[0], point(0, 12)));
});

test('boundary preview uses the same intersection preference as automatic points', () => {
  const ring = [point(12, 4), point(100, 4), point(100, 100), point(12, 100), point(12, 4)];
  const roads = [line([[-100, 0], [200, 0]]), line([[0, -100], [0, 200]])];
  const result = previewRoadBoundary(turf.polygon([ring]).geometry, roads);
  assert.ok(result && near(result.coordinates[0][0], point(0, 0)));
});
