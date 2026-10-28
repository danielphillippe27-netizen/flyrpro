import assert from 'node:assert/strict';
import { availableWindTimes, canonicalWindTime, validateWindResponse, windCountry, windCountryTiles, windGustKPH, windPixelColor } from '../intelligence/wind-archive-format';
const time = '2026-10-24T10:00:00.000Z', now = new Date('2026-10-24T12:00:00Z');
assert.deepEqual(availableWindTimes([time, time, '2026-10-24T13:00:00Z', '2026-10-16T00:00:00Z'], now), [time]);
assert.throws(() => availableWindTimes(['2026-10-20T10:00:00Z'], now));
assert.throws(() => canonicalWindTime('bad'));
assert.throws(() => canonicalWindTime('2026-10-24T10:01:00Z'));
assert.equal(windCountry('NZ'), true); assert.equal(windCountry('__proto__'), false);
const header = (t: string) => JSON.stringify([{ validTimes: [t], b: 0, x: 0, y: 0, nd: 0, u: 'm/s' }]);
validateWindResponse(header(time), time);
assert.throws(() => validateWindResponse(header('2026-10-24T09:00:00Z'), time), 'Silent upstream fallback must never be saved under the requested hour');
assert.throws(() => validateWindResponse(null, time));
assert.throws(() => validateWindResponse(header(time).replace('m/s', 'mph'), time));
const earlier = '2026-10-24T09:00:00.000Z';
assert.deepEqual(validateWindResponse(JSON.stringify([{ validTimes: [earlier, time], animDir: 'H', b: 0, x: 0, y: 0, nd: 0, u: 'm/s' }]), [time, earlier]), [earlier, time], 'Packed images are split using returned frame order');
assert.throws(() => validateWindResponse(header(time), [time, earlier]), 'Incomplete packed histories remain retryable');
assert.equal(windGustKPH(0), null); assert.equal(windGustKPH(1), 0); assert.equal(windGustKPH(255), 360);
assert.deepEqual(windPixelColor(0), [0, 0, 0, 0]);
assert.notDeepEqual(windPixelColor(1), windPixelColor(0), 'Calm wind is distinct from no data');
const nz = windCountryTiles('NZ');
assert(nz.some(key => key.startsWith('4/15/')) && nz.some(key => key.startsWith('4/0/')), 'NZ coverage crosses the date line');
for (const country of ['CA', 'US', 'AU', 'NZ'] as const) {
  const tiles = windCountryTiles(country);
  assert.equal(tiles.length, new Set(tiles).size);
  assert(tiles.every(key => /^4\/(?:[0-9]|1[0-5])\/(?:[0-9]|1[0-5])$/.test(key)));
}
console.log('PASS: Wind archive temporal identity, forecast exclusion, stale feeds, native tiles, date-line coverage, units and no-data handling.');
