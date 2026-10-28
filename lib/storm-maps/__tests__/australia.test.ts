import assert from 'node:assert/strict';
import { australianHailSettings, australianHailDay, AUSTRALIAN_STORM_LOCATIONS } from '../australia';
import { STRONGEST_STORM_SETTINGS } from '../gl-settings';

const now = Date.parse('2026-10-23T16:00:00Z');
assert.equal(australianHailDay('2026-02-30', now), null);
assert.equal(australianHailDay('2026-10-24', now), null);
assert.equal(australianHailDay('', now), null);
assert.equal(australianHailDay('2026-10-22', now)?.mapAvailable, true);
assert.equal(australianHailDay('2026-10-16', now)?.mapAvailable, false, 'Do not show a partial UTC day as complete map coverage');
assert.equal(australianHailDay('2025-10-23', now)?.mapAvailable, false, 'Older dates remain available for explicit point lookups');
assert.equal(australianHailDay('2026-10-23', now)?.end.toISOString(), '2026-10-23T16:00:00.000Z');
assert.equal(australianHailDay('2026-10-22', now)?.end.toISOString(), '2026-10-23T00:00:00.000Z');
const history = australianHailSettings(STRONGEST_STORM_SETTINGS, 'history');
assert.equal(history.shade, 'hail-size-max'); assert.equal(history.mode, 'history'); assert.equal(history.historyHours, 24);
assert.equal(history.units, 'metric'); assert.equal(history.radar, false); assert.equal(history.hail, false);
const live = australianHailSettings(history, 'live');
assert.equal(live.shade, 'none'); assert.equal(live.mode, 'live'); assert.equal(live.radar, true);
assert.equal(live.hail, true); assert.equal(live.lightning, true); assert.equal(live.lightningThreats, true);
for (const settings of [history, live]) {
  for (const key of ['cells', 'stormCones', 'alerts', 'reports', 'outlook', 'impact'] as const) assert.equal(settings[key], false, `${key} must not imply Australian coverage`);
}
assert.equal(AUSTRALIAN_STORM_LOCATIONS[0].id, 'brisbane');
assert(AUSTRALIAN_STORM_LOCATIONS.some(location => location.id === 'sydney'));
for (const { center } of AUSTRALIAN_STORM_LOCATIONS) assert(center[0] > 112 && center[0] < 155 && center[1] > -44 && center[1] < -10);
console.log('PASS: Australian live/history layers, North American exclusions, UTC day limits and Australian location coordinates.');
