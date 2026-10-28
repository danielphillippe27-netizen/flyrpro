import assert from 'node:assert/strict';
import { parseFarmBoundary } from '../farm-boundary';

const boundary = { type: 'Polygon', coordinates: [[[-78.70, 43.91], [-78.69, 43.91], [-78.69, 43.92], [-78.70, 43.91]]] };
assert.deepEqual(parseFarmBoundary(boundary), boundary);
assert.deepEqual(parseFarmBoundary(JSON.stringify(boundary)), boundary);
assert.deepEqual(parseFarmBoundary({ ...boundary, crs: { type: 'name', properties: { name: 'EPSG:4326' } } }), boundary);
assert.equal(parseFarmBoundary({ ...boundary, crs: { type: 'name', properties: { name: 'EPSG:3857' } } }), null);
assert.equal(parseFarmBoundary('[object Object]'), null);
assert.equal(parseFarmBoundary(null), null);
assert.equal(parseFarmBoundary({ type: 'Point', coordinates: [0, 0] }), null);
console.log('PASS farm boundaries: object, string and invalid geometry');
