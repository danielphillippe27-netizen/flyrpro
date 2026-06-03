/**
 * Run with: npx tsx lib/__tests__/calendarHelpers.test.ts
 */

import {
  calendarItemIntersects,
  calendarSearchHaystack,
  computeTimedEventLayouts,
  monthGrid,
  resolveTimelineSlot,
} from '../calendar/helpers';
import { normalizeCalendarEventPayload } from '../calendar/api';
import type { CalendarItem } from '../calendar/types';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
    testsPassed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    testsFailed += 1;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function makeItem(id: string, start: string, end: string): CalendarItem {
  return {
    id,
    sourceId: id,
    kind: 'standalone',
    eventType: 'appointment',
    title: `Event ${id}`,
    startAt: new Date(start),
    endAt: new Date(end),
    isAllDay: false,
    notes: 'Needs CMA',
    location: '123 Main St',
    colorKey: 'red',
    contactName: 'Sarah Johnson',
    contactId: 'contact-1',
    address: '456 Queen St',
    displayName: 'Dana',
  };
}

test('monthGrid returns 42 cells with displayed month metadata', () => {
  const grid = monthGrid(new Date('2026-06-15T12:00:00Z'), 1);
  assertEqual(grid.length, 42);
  assertEqual(grid[0].id, '2026-06-01');
  assertEqual(grid[29].id, '2026-06-30');
  assertEqual(grid[30].id, '2026-07-01');
  assert(grid[0].isInDisplayedMonth, 'first grid day should be in June');
  assert(!grid[30].isInDisplayedMonth, 'July spillover should not be in displayed month');
});

test('calendarItemIntersects matches inclusive range behavior from iOS', () => {
  const item = makeItem('a', '2026-06-02T13:00:00Z', '2026-06-02T14:00:00Z');
  assert(calendarItemIntersects(item, new Date('2026-06-02T00:00:00Z'), new Date('2026-06-03T00:00:00Z')), 'event should intersect its day');
  assert(!calendarItemIntersects(item, new Date('2026-06-02T14:00:00Z'), new Date('2026-06-02T15:00:00Z')), 'event ending at range start should not intersect');
});

test('calendarSearchHaystack includes title notes contact address location and member', () => {
  const item = makeItem('a', '2026-06-02T13:00:00Z', '2026-06-02T14:00:00Z');
  const haystack = calendarSearchHaystack(item);
  for (const token of ['event a', 'needs cma', '123 main', 'sarah', '456 queen', 'dana']) {
    assert(haystack.includes(token), `missing ${token}`);
  }
});

test('computeTimedEventLayouts assigns stable overlap columns', () => {
  const day = new Date('2026-06-02T00:00:00');
  const layouts = computeTimedEventLayouts(day, [
    makeItem('a', '2026-06-02T09:00:00', '2026-06-02T10:00:00'),
    makeItem('b', '2026-06-02T09:30:00', '2026-06-02T11:00:00'),
    makeItem('c', '2026-06-02T11:00:00', '2026-06-02T12:00:00'),
  ]);
  assertEqual(layouts.map((layout) => [layout.id, layout.column, layout.columnCount]), [
    ['a', 0, 2],
    ['b', 1, 2],
    ['c', 0, 1],
  ]);
});

test('resolveTimelineSlot snaps to 15-minute increments', () => {
  const slot = resolveTimelineSlot({
    x: 140,
    y: 9.2 * 60,
    timelineWidth: 400,
    gutterWidth: 60,
    hourHeight: 60,
    days: [new Date('2026-06-02T00:00:00')],
  });
  assertEqual(slot?.getHours(), 9);
  assertEqual(slot?.getMinutes(), 15);
});

test('normalizeCalendarEventPayload enforces minimum duration and defaults title/color', () => {
  const payload = normalizeCalendarEventPayload({
    start_at: '2026-06-02T09:00:00.000Z',
    end_at: '2026-06-02T09:05:00.000Z',
    event_type: 'showing',
    contact_name: 'Sarah Johnson',
  });
  assertEqual(payload.title, 'Showing: Sarah Johnson');
  assertEqual(payload.color_key, 'green');
  assertEqual(payload.end_at, '2026-06-02T09:15:00.000Z');
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
if (testsFailed > 0) process.exit(1);
