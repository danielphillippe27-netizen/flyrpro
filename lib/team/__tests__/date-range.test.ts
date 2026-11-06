import assert from 'node:assert/strict';
import { getRangeForPreset } from '../date-range';

const originalTimezone = process.env.TZ;
try {
  for (const [timezone, now, midnight] of [
    ['America/Toronto', '2026-11-06T01:01:37Z', '2026-11-05T05:00:00.000Z'],
    ['America/Toronto', '2026-11-05T15:00:00Z', '2026-11-05T05:00:00.000Z'],
    ['America/Toronto', '2026-11-01T23:00:00Z', '2026-11-01T04:00:00.000Z'],
    ['America/Toronto', '2026-03-08T23:00:00Z', '2026-03-08T05:00:00.000Z'],
    ['Asia/Tokyo', '2026-11-05T01:00:00Z', '2026-11-04T15:00:00.000Z'],
    ['UTC', '2026-11-05T20:00:00Z', '2026-11-05T00:00:00.000Z'],
  ]) {
    process.env.TZ = timezone;
    const range = getRangeForPreset('today', new Date(now));
    assert.equal(range.start, midnight, `${timezone}: ${now}`);
    assert.equal(range.end, new Date(now).toISOString());
  }

  process.env.TZ = 'America/Toronto';
  const now = new Date('2026-11-06T01:01:37Z');
  const today = getRangeForPreset('today', now);
  const included = ['2026-11-05T04:59:59Z', '2026-11-05T05:00:00Z', '2026-11-05T17:00:00Z', '2026-11-06T00:30:00Z']
    .filter((time) => new Date(time) >= new Date(today.start) && new Date(time) <= new Date(today.end));
  assert.equal(included.length, 3, 'Include morning, afternoon, and evening activity, excluding yesterday');

  for (const [preset, expectedStart] of [
    ['7d', '2026-10-31T00:00:00.000Z'],
    ['30d', '2026-10-08T00:00:00.000Z'],
    ['year', '2026-01-02T00:00:00.000Z'],
  ] as const) {
    assert.deepEqual(getRangeForPreset(preset, now), { start: expectedStart, end: now.toISOString() }, `${preset} remains unchanged`);
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

console.log('Team date-range regression checks passed');
