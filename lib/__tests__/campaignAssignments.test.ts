/**
 * Run with: npx tsx lib/__tests__/campaignAssignments.test.ts
 */

import {
  distributeWholeTeamGoals,
  normalizeZoneAssignments,
} from '../campaignAssignments';

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

function assertThrows(fn: () => void, expectedMessage: string) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(`Expected message containing "${expectedMessage}", got "${message}"`);
    }
    return;
  }
  throw new Error('Expected function to throw');
}

test('distributeWholeTeamGoals: splits evenly and assigns remainder by member order', () => {
  const goals = distributeWholeTeamGoals(10, ['u1', 'u2', 'u3']);
  assertEqual(Array.from(goals.entries()), [
    ['u1', 4],
    ['u2', 3],
    ['u3', 3],
  ]);
});

test('distributeWholeTeamGoals: dedupes members before splitting', () => {
  const goals = distributeWholeTeamGoals(5, ['u1', 'u1', 'u2']);
  assertEqual(Array.from(goals.entries()), [
    ['u1', 3],
    ['u2', 2],
  ]);
});

test('normalizeZoneAssignments: accepts exact one-time coverage', () => {
  const normalized = normalizeZoneAssignments({
    memberIds: ['u1', 'u2'],
    campaignAddressIds: ['a1', 'a2', 'a3'],
    zoneAssignments: [
      { userId: 'u1', addressIds: ['a1', 'a2'] },
      { userId: 'u2', addressIds: ['a3'] },
    ],
  });
  assertEqual(normalized.map((zone) => [zone.userId, zone.goalHomes, zone.zoneIndex]), [
    ['u1', 2, 1],
    ['u2', 1, 2],
  ]);
});

test('normalizeZoneAssignments: rejects homes outside campaign', () => {
  assertThrows(
    () =>
      normalizeZoneAssignments({
        memberIds: ['u1'],
        campaignAddressIds: ['a1'],
        zoneAssignments: [{ userId: 'u1', addressIds: ['missing'] }],
      }),
    'outside this campaign'
  );
});

test('normalizeZoneAssignments: rejects duplicate homes', () => {
  assertThrows(
    () =>
      normalizeZoneAssignments({
        memberIds: ['u1', 'u2'],
        campaignAddressIds: ['a1', 'a2'],
        zoneAssignments: [
          { userId: 'u1', addressIds: ['a1'] },
          { userId: 'u2', addressIds: ['a1'] },
        ],
      }),
    'duplicate home'
  );
});

test('normalizeZoneAssignments: rejects missing homes', () => {
  assertThrows(
    () =>
      normalizeZoneAssignments({
        memberIds: ['u1'],
        campaignAddressIds: ['a1', 'a2'],
        zoneAssignments: [{ userId: 'u1', addressIds: ['a1'] }],
      }),
    'every campaign home'
  );
});

console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
if (testsFailed > 0) process.exit(1);
