import assert from 'node:assert/strict';
import {
  allocateSelfServeDoorOutcomeCounts,
  buildSelfServeDoorOutcomes,
} from '../selfServeDoorOutcomes';

const counts = allocateSelfServeDoorOutcomeCounts(100);
assert.deepEqual(counts, {
  no_answer: 30,
  answered: 30,
  lead: 20,
  appointment: 10,
  other: 10,
});

const outcomes = buildSelfServeDoorOutcomes(100);
assert.equal(outcomes.length, 100);
assert.deepEqual(
  outcomes.reduce<Record<string, number>>((totals, outcome) => {
    totals[outcome] = (totals[outcome] ?? 0) + 1;
    return totals;
  }, {}),
  counts,
);
assert.deepEqual(buildSelfServeDoorOutcomes(100), outcomes);

for (const total of [0, 1, 5, 17, 122, 1000]) {
  const allocated = allocateSelfServeDoorOutcomeCounts(total);
  assert.equal(Object.values(allocated).reduce((sum, value) => sum + value, 0), total);
}

console.log('selfServeDoorOutcomes tests passed');
