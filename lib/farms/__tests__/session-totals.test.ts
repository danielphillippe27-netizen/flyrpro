import assert from 'node:assert/strict';
import { farmSessionTotals, type FarmActivitySession } from '../session-totals';

const touches = [{ id: 'first', resolvedCycleNumber: 1 }, { id: 'second', resolvedCycleNumber: 2 }];
const session = (id: string, doors: number, conversations: number, touch: string | null = 'first'): FarmActivitySession => ({
  id, doors_hit: doors, conversations, farm_touch_id: touch, session_mode: 'door_knocking',
});
const rows = [session('a', 17, 5), session('b', 14, 6), session('c', 19, 2), session('d', 1, 1, 'second'), session('e', 6, 3, null), session('f', 19, 6)];
assert.deepEqual(farmSessionTotals(rows, touches), { doors: 76, conversations: 23, answerRate: 23 / 76 });
assert.deepEqual(farmSessionTotals([...rows, rows[0]], touches), farmSessionTotals(rows, touches), 'Overlapping farm/campaign reads must not double-count');
assert.deepEqual(farmSessionTotals(rows, touches, 2), { doors: 1, conversations: 1, answerRate: 1 });
assert.equal(farmSessionTotals(rows, touches, 3), null);
assert.equal(farmSessionTotals([], touches), null);
assert.deepEqual(farmSessionTotals([...rows, { ...session('flyer', 100, 0), session_mode: 'flyer' }], touches), farmSessionTotals(rows, touches));
assert.deepEqual(farmSessionTotals([session('bad', NaN, -1)], touches), { doors: 0, conversations: 0, answerRate: 0 });
assert.equal('homes' in farmSessionTotals(rows, touches)!, false, 'Attempts cannot establish unique-home coverage');
console.log('Farm session totals checks passed');
