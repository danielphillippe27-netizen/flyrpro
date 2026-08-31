export type SelfServeDoorOutcome =
  | 'no_answer'
  | 'answered'
  | 'lead'
  | 'appointment';

export type SelfServeDoorOutcomeCounts = Record<SelfServeDoorOutcome, number>;

const OUTCOME_WEIGHTS: ReadonlyArray<{
  outcome: SelfServeDoorOutcome;
  weight: number;
}> = [
  { outcome: 'no_answer', weight: 20 },
  { outcome: 'answered', weight: 40 },
  { outcome: 'lead', weight: 20 },
  { outcome: 'appointment', weight: 10 },
];

const TOTAL_OUTCOME_WEIGHT = OUTCOME_WEIGHTS.reduce((sum, { weight }) => sum + weight, 0);

export function allocateSelfServeDoorOutcomeCounts(total: number): SelfServeDoorOutcomeCounts {
  const safeTotal = Math.max(0, Math.trunc(total));
  const allocations = OUTCOME_WEIGHTS.map(({ outcome, weight }, order) => {
    const exact = safeTotal * (weight / TOTAL_OUTCOME_WEIGHT);
    return {
      outcome,
      order,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });

  const remaining = safeTotal - allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  const remainderOrder = [...allocations].sort(
    (left, right) => right.remainder - left.remainder || left.order - right.order,
  );
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index % remainderOrder.length].count += 1;
  }

  return allocations.reduce<SelfServeDoorOutcomeCounts>(
    (counts, allocation) => ({ ...counts, [allocation.outcome]: allocation.count }),
    { no_answer: 0, answered: 0, lead: 0, appointment: 0 },
  );
}

function stableShuffleScore(index: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  return value >>> 0;
}

export function buildSelfServeDoorOutcomes(total: number): SelfServeDoorOutcome[] {
  const counts = allocateSelfServeDoorOutcomeCounts(total);
  const shuffledIndices = Array.from({ length: Math.max(0, Math.trunc(total)) }, (_, index) => index)
    .sort((left, right) => stableShuffleScore(left) - stableShuffleScore(right));
  const outcomes = Array<SelfServeDoorOutcome>(shuffledIndices.length).fill('no_answer');
  let cursor = 0;

  for (const { outcome } of OUTCOME_WEIGHTS) {
    const end = cursor + counts[outcome];
    for (; cursor < end; cursor += 1) {
      outcomes[shuffledIndices[cursor]] = outcome;
    }
  }

  return outcomes;
}
