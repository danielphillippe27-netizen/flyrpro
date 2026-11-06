import assert from 'node:assert/strict';
import { buildFarmDashboardAnalytics } from '../analytics';
import { cycleDateError, cycleMapStatus } from '../cycles';
import type { Farm, FarmAddress, FarmTouch, FarmTouchAddress } from '@/types/database';

const touch = (id: string, cycle: number, status: FarmTouch['status']): FarmTouch => ({
  id, farm_id: 'farm', cycle_number: cycle, status, mode: 'doorknock',
  scheduled_date: '2026-11-05T12:00:00Z', created_at: '2026-11-05T12:00:00Z',
} as FarmTouch);
const outcome = (id: string, session: string, address: string, status: FarmTouchAddress['status'] = 'talked'): FarmTouchAddress => ({
  id, farm_id: 'farm', farm_touch_id: session, farm_address_id: address, status,
  occurred_at: '2026-11-05T12:00:00Z', created_at: '2026-11-05T12:00:00Z',
} as FarmTouchAddress);
const args = {
  farm: { active_cycle_number: 2, frequency: 1, touches_interval: 'month' } as Farm,
  addresses: [{ id: 'a' }, { id: 'b' }] as FarmAddress[],
  touches: [touch('old', 1, 'completed'), touch('monday', 2, 'completed'), touch('wednesday', 2, 'in_progress'), touch('future', 9, 'scheduled')],
  touchOutcomes: [outcome('old', 'old', 'b'), outcome('m', 'monday', 'a'), outcome('w', 'wednesday', 'a')],
  leads: [], contacts: [], financeEntries: [],
};
const result = buildFarmDashboardAnalytics(args);
assert.equal(result.currentCycleNumber, 2, 'Future plans do not change active cycle');
assert.deepEqual(new Set(result.currentCycleTouchIds), new Set(['monday', 'wednesday']));
assert.equal(result.currentCycleCoverageCount, 1, 'Repeated visits count as one home this round');
assert.equal(result.currentCycleVisits, 2);
const fresh = buildFarmDashboardAnalytics({ ...args, farm: { ...args.farm, active_cycle_number: 3 } });
assert.equal(fresh.currentCycleVisits, 0);
assert.equal(fresh.currentCycleCoverageCount, 0);
assert.equal(fresh.totalVisits, 3, 'Starting another cycle preserves history');
assert.equal(fresh.allTimeUniqueVisitedHomes, 2);
assert.equal(buildFarmDashboardAnalytics({ ...args, farm: null }).currentCycleNumber, 1, 'Missing settings do not imply the highest planned cycle');
assert.equal(cycleDateError('2026-11-05', '2026-11-04'), 'End date cannot be before the cycle start date.');
assert.equal(cycleDateError('2026-11-05', '2026-11-05'), null);
assert.equal(cycleDateError('2026-11-05', ''), null, 'End date can be cleared');
assert.equal(cycleDateError(null, '2026-02-30'), 'Choose a valid end date.');
assert.equal(cycleDateError(null, 'not-a-date'), 'Choose a valid end date.');
assert.equal(cycleDateError(null, '2028-02-29'), null);
assert.equal(cycleMapStatus(undefined, outcome('d', 'old', 'a', 'do_not_knock'), null), 'do_not_knock');
assert.equal(cycleMapStatus(undefined, undefined, 'do_not_knock'), 'do_not_knock');
assert.equal(cycleMapStatus(undefined, outcome('a', 'old', 'a'), 'talked'), 'none', 'Old visits do not mark homes visited this cycle');
assert.equal(cycleMapStatus(outcome('m', 'monday', 'a'), undefined, null), 'talked');
console.log('20 farm cycle assertions passed');
