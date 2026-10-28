import assert from 'node:assert/strict';
import { australianHailFrame, australianFramesToCollect, mergeAustralianEvent } from '../intelligence/australian-hail-format';
import { buildStormDigest } from '../intelligence/digest';
const time = '2026-10-24T02:00:00Z', issued = Date.parse(time) / 1000;
const feature = (tz: string, type = 'centroid', offset = 0): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [153, -27] }, properties: {
  id: 'storm-one', featureType: type, profile: JSON.stringify({ tz }), details: JSON.stringify({ stormId: 'storm-one', issuedTimestamp: issued, issuedDateTimeISO: time, hail: { maxSizeMM: 35 } }),
  ...(type === 'forecastPath' ? {} : { period: JSON.stringify({ range: { minTimestamp: issued + offset } }) }),
} });
const frame = australianHailFrame([feature('Australia/Brisbane'), feature('Australia/Brisbane', 'forecastPath'), feature('Australia/Brisbane', 'centroid', 600), feature('Pacific/Auckland'), feature('America/Chicago')], time);
assert.equal(frame.events.length, 1); assert.equal(frame.features.length, 3);
assert.equal(frame.events[0].reportCount, 0); assert.equal(frame.events[0].maxHailMM, 35);
assert.equal(frame.events[0].features.length, 1, 'Forecast centroids must not be counted as observed locations');
assert.equal(frame.events[0].features[0].properties.kind, 'position');
assert.equal(frame.events[0].footprintStatus, 'unavailable');
assert(Date.parse(frame.events[0].end) > Date.parse(frame.events[0].start), 'A selected threat has a valid nonzero timeline');
assert.equal(australianHailFrame([feature('Pacific/Norfolk')], time).events.length, 1);
const malformed = feature('Australia/Perth'); malformed.properties!.details = 'invalid json';
assert.throws(() => australianHailFrame([malformed], time), 'Invalid frames must remain retryable instead of becoming zero storms');
const merged = mergeAustralianEvent({ ...frame.events[0], maxHailMM: 50 }, { ...frame.events[0], maxHailMM: 20, features: [] });
assert.equal(merged.maxHailMM, 50); assert.equal(merged.features.length, 1);
const now = new Date('2026-10-24T03:00:00Z');
assert.deepEqual(australianFramesToCollect(['bad', time, '2026-10-24T03:01:00Z', '2026-10-10T00:00:00Z'], new Set(), now), [time]);
assert.deepEqual(australianFramesToCollect([time], new Set([new Date(time).toISOString()]), now), []);
const start = new Date('2026-10-23T03:00:00Z');
assert(buildStormDigest([], [], start, now, { count: 4, maximumMM: 40, complete: true, available: true }).text.includes('4 Australian hail-threat records; largest estimate 40.0 mm'));
assert(buildStormDigest([], [], start, now, { count: 0, maximumMM: null, complete: false, available: true }).text.includes('Partial archive'));
assert(buildStormDigest([], [], start, now, { count: 0, maximumMM: null, complete: false, available: false }).text.includes('Australian hail feed unavailable'));
console.log('PASS: Australian identities, forecast separation, external territories, retryable invalid frames, backfill deduplication, timeline and digest completeness.');
