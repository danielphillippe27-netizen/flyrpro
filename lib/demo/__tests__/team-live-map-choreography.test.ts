/**
 * Run with: npx tsx lib/demo/__tests__/team-live-map-choreography.test.ts
 */

import {
  buildDemoLiveChoreography,
  completedAssignedHomes,
  demoBuildingPhase,
  DEMO_STREET_TRANSITION_MS,
  MAX_DEMO_ASSIGNMENT_HOMES,
  type DemoBuildingCandidate,
  type DemoLiveMember,
} from '../team-live-map-choreography';

let passed = 0;
let failed = 0;

function test(name: string, callback: () => void) {
  try {
    callback();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error instanceof Error ? `  ${error.message}` : error);
    failed += 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rectangle(center: [number, number]): GeoJSON.Polygon {
  const [lng, lat] = center;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - 0.00002, lat - 0.000015],
      [lng + 0.00002, lat - 0.000015],
      [lng + 0.00002, lat + 0.000015],
      [lng - 0.00002, lat + 0.000015],
      [lng - 0.00002, lat - 0.000015],
    ]],
  };
}

function candidate(
  id: string,
  center: [number, number],
  streetName?: string,
  houseNumber?: number,
): DemoBuildingCandidate {
  return { id, center, geometry: rectangle(center), streetName, houseNumber };
}

const members: DemoLiveMember[] = [
  { user_id: 'maya', display_name: 'Maya', color: '#ef4444' },
  { user_id: 'leo', display_name: 'Leo', color: '#2563eb' },
  { user_id: 'ava', display_name: 'Ava', color: '#16a34a' },
  { user_id: 'noah', display_name: 'Noah', color: '#7c3aed' },
];

test('retains all buildings while assigning a balanced 96-home demo', () => {
  const candidates = Array.from({ length: 120 }, (_, index) =>
    candidate(
      `home-${index}`,
      [-79.42 + index * 0.0001, 43.7 + (index % 8) * 0.0001],
      `Street ${Math.floor(index / 12)}`,
      index + 1,
    )
  );
  const choreography = buildDemoLiveChoreography(candidates, members);

  assert(choreography.buildings.length === 120, 'all context buildings should be retained');
  assert(choreography.assignedHomes.length === MAX_DEMO_ASSIGNMENT_HOMES, 'assignment should be capped at 96');
  const counts = members.map((member) =>
    choreography.assignedHomes.filter((home) => home.assigneeId === member.user_id).length
  );
  assert(Math.max(...counts) - Math.min(...counts) <= 1, `rep zones should be balanced: ${counts.join(', ')}`);
});

test('assigns contiguous house-number runs instead of evenly scattered homes', () => {
  const candidates = Array.from({ length: 120 }, (_, index) =>
    candidate(
      `oak-${index + 1}`,
      [-79.42 + index * 0.00001, 43.7],
      'Oak Road',
      index + 1,
    )
  );
  const choreography = buildDemoLiveChoreography(candidates, members);

  members.forEach((member) => {
    const numbers = choreography.assignedHomes
      .filter((home) => home.assigneeId === member.user_id)
      .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
      .map((home) => Number(home.houseNumber));
    assert(numbers.length === 24, `${member.display_name} should receive 24 homes`);
    assert(
      numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1),
      `${member.display_name} should work one continuous street run: ${numbers.join(', ')}`,
    );
  });
});

test('keeps a large campaign assignment inside one dense neighborhood', () => {
  const denseNeighborhood = Array.from({ length: 120 }, (_, index) =>
    candidate(
      `dense-${index}`,
      [-79.34 + (index % 20) * 0.00008, 43.78 + Math.floor(index / 20) * 0.00008],
      `Dense Street ${Math.floor(index / 20)}`,
      (index % 20) + 1,
    )
  );
  const distantHomes = Array.from({ length: 120 }, (_, index) =>
    candidate(
      `distant-${index}`,
      [-79.52 + (index % 12) * 0.002, 43.62 + Math.floor(index / 12) * 0.002],
      `Distant Street ${index}`,
      index + 1,
    )
  );
  const choreography = buildDemoLiveChoreography(
    [...distantHomes, ...denseNeighborhood],
    members,
  );
  const longitudes = choreography.assignedHomes.map((home) => home.center[0]);
  const latitudes = choreography.assignedHomes.map((home) => home.center[1]);

  assert(Math.max(...longitudes) - Math.min(...longitudes) < 0.01, 'assigned homes should not span distant city zones');
  assert(Math.max(...latitudes) - Math.min(...latitudes) < 0.01, 'assigned homes should stay in a walkable cluster');
});

test('orders a street by house number and inserts a segment transition', () => {
  const oneMember = [members[0]];
  const candidates = [
    candidate('oak-30', [-79.4, 43.7], 'Oak Road', 30),
    candidate('oak-10', [-79.3999, 43.7], 'Oak Road', 10),
    candidate('oak-20', [-79.3998, 43.7], 'Oak Road', 20),
    candidate('pine-1', [-79.3997, 43.701], 'Pine Road', 1),
  ];
  const choreography = buildDemoLiveChoreography(candidates, oneMember);
  const oak = choreography.assignedHomes
    .filter((home) => home.streetKey === 'oak road')
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  assert(oak.map((home) => home.id).join(',') === 'oak-10,oak-20,oak-30', 'house numbers should ascend within a street');

  const ordered = [...choreography.assignedHomes].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const streetChangeIndex = ordered.findIndex((home, index) => index > 0 && home.streetKey !== ordered[index - 1].streetKey);
  assert(streetChangeIndex > 0, 'fixture should contain a street transition');
  const previous = ordered[streetChangeIndex - 1];
  const current = ordered[streetChangeIndex];
  assert(
    (current.activeFromMs ?? 0) - (previous.completeAtMs ?? 0) === DEMO_STREET_TRANSITION_MS,
    'street changes should include the cinematic pause',
  );
});

test('uses geometric street groups when metadata is absent', () => {
  const choreography = buildDemoLiveChoreography([
    candidate('unknown-a', [-79.4, 43.70001]),
    candidate('unknown-b', [-79.3999, 43.70002]),
  ], [members[0]]);
  assert(choreography.assignedHomes.every((home) => home.streetKey.startsWith('near-')), 'missing streets should use geometric rows');
});

test('finishes assigned progress before cascading every context building green', () => {
  const candidates = Array.from({ length: 104 }, (_, index) =>
    candidate(`home-${index}`, [-79.42 + index * 0.0001, 43.7 + (index % 10) * 0.0001], `Street ${index % 8}`, index)
  );
  const choreography = buildDemoLiveChoreography(candidates, members);
  const justBefore = Math.max(0, choreography.assignmentDurationMs - 1);
  assert(completedAssignedHomes(choreography, justBefore) < 96, 'progress must not hit 96 before assignment completion');
  assert(completedAssignedHomes(choreography, choreography.assignmentDurationMs) === 96, 'progress should reach 96 at assignment completion');

  const context = choreography.buildings.filter((home) => home.assigneeId === null);
  assert(context.length === 8, 'fixture should retain eight context buildings');
  assert(context.some((home) => demoBuildingPhase(home, justBefore) === 'context'), 'context should remain neutral during assignments');
  assert(
    choreography.buildings.every((home) => demoBuildingPhase(home, choreography.totalDurationMs) === 'completed'),
    'every campaign building should be green after the finale',
  );
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
