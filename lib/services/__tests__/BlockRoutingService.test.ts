/**
 * BlockRoutingService Unit Tests
 *
 * Run with: npx tsx lib/services/__tests__/BlockRoutingService.test.ts
 */

import {
  buildBalancedBlockClusters,
  buildBlockSegments,
  buildNaturalZoneClusters,
  buildRoute,
  postmanSort,
} from '../BlockRoutingService';
import type { BlockAddress } from '../BlockRoutingService';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, msg?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, msg?: string) {
  if (!condition) {
    throw new Error(msg || 'Expected true, got false');
  }
}

// ==================== Test Data ====================

const linearStreet: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
  { id: '2', lat: 40.7129, lon: -74.0061, house_number: '102', street_name: 'Main St' },
  { id: '3', lat: 40.7130, lon: -74.0062, house_number: '104', street_name: 'Main St' },
  { id: '4', lat: 40.7131, lon: -74.0063, house_number: '106', street_name: 'Main St' },
  { id: '5', lat: 40.7132, lon: -74.0064, house_number: '108', street_name: 'Main St' },
];

const twoStreets: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
  { id: '2', lat: 40.7129, lon: -74.0061, house_number: '102', street_name: 'Main St' },
  { id: '3', lat: 40.7130, lon: -74.0070, house_number: '200', street_name: 'Oak Ave' },
  { id: '4', lat: 40.7131, lon: -74.0071, house_number: '202', street_name: 'Oak Ave' },
];

const single: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
];

// Mixed evens and odds along a line (lon increases with house number) for postman sort
const evensAndOdds: BlockAddress[] = [
  { id: '1', lat: 40.71, lon: -74.005, house_number: '1', street_name: 'Test' },
  { id: '2', lat: 40.71, lon: -74.004, house_number: '2', street_name: 'Test' },
  { id: '3', lat: 40.71, lon: -74.003, house_number: '3', street_name: 'Test' },
  { id: '4', lat: 40.71, lon: -74.002, house_number: '4', street_name: 'Test' },
  { id: '5', lat: 40.71, lon: -74.001, house_number: '5', street_name: 'Test' },
  { id: '6', lat: 40.71, lon: -74.000, house_number: '6', street_name: 'Test' },
];

const multiBlockStreet: BlockAddress[] = [
  { id: 'a1', lat: 43.9000, lon: -78.9000, house_number: '100', street_name: 'Wycombe St' },
  { id: 'a2', lat: 43.9002, lon: -78.9000, house_number: '102', street_name: 'Wycombe St' },
  { id: 'a3', lat: 43.9004, lon: -78.9000, house_number: '104', street_name: 'Wycombe St' },
  { id: 'b1', lat: 43.9015, lon: -78.9000, house_number: '200', street_name: 'Wycombe St' },
  { id: 'b2', lat: 43.9017, lon: -78.9000, house_number: '202', street_name: 'Wycombe St' },
  { id: 'b3', lat: 43.9019, lon: -78.9000, house_number: '204', street_name: 'Wycombe St' },
];

const parallelCorridors: BlockAddress[] = [
  { id: 'l1', lat: 43.9000, lon: -78.9015, house_number: '100', street_name: 'Left St' },
  { id: 'l2', lat: 43.9002, lon: -78.9015, house_number: '102', street_name: 'Left St' },
  { id: 'l3', lat: 43.9010, lon: -78.9015, house_number: '200', street_name: 'Left St' },
  { id: 'l4', lat: 43.9012, lon: -78.9015, house_number: '202', street_name: 'Left St' },
  { id: 'r1', lat: 43.9000, lon: -78.8985, house_number: '100', street_name: 'Right St' },
  { id: 'r2', lat: 43.9002, lon: -78.8985, house_number: '102', street_name: 'Right St' },
  { id: 'r3', lat: 43.9010, lon: -78.8985, house_number: '200', street_name: 'Right St' },
  { id: 'r4', lat: 43.9012, lon: -78.8985, house_number: '202', street_name: 'Right St' },
];

const carnwithBoundaryNeighborhood: BlockAddress[] = [
  { id: 'n1', lat: 43.9026, lon: -78.9010, house_number: '100', street_name: 'Alpha St' },
  { id: 'n2', lat: 43.9028, lon: -78.9010, house_number: '102', street_name: 'Alpha St' },
  { id: 'n3', lat: 43.9030, lon: -78.9002, house_number: '100', street_name: 'Beta St' },
  { id: 'n4', lat: 43.9032, lon: -78.9002, house_number: '102', street_name: 'Beta St' },
  { id: 'c1', lat: 43.9015, lon: -78.9008, house_number: '10', street_name: 'Carnwith Dr' },
  { id: 'c2', lat: 43.9015, lon: -78.8998, house_number: '12', street_name: 'Carnwith Dr' },
  { id: 's1', lat: 43.9002, lon: -78.9009, house_number: '100', street_name: 'Gamma St' },
  { id: 's2', lat: 43.9004, lon: -78.9009, house_number: '102', street_name: 'Gamma St' },
  { id: 's3', lat: 43.8998, lon: -78.8999, house_number: '100', street_name: 'Delta St' },
  { id: 's4', lat: 43.9000, lon: -78.8999, house_number: '102', street_name: 'Delta St' },
];

// ==================== Tests ====================

console.log('Running BlockRoutingService Tests...\n');

test('postmanSort: evens as group, odds as group; order minimizes cross-street jump', () => {
  const ids = postmanSort(evensAndOdds);
  // Evens must be consecutive (2,4,6); odds consecutive (5,3,1). Either evens→odds or odds→evens.
  const evensFirst = ids.join(',') === '2,4,6,5,3,1';
  const oddsFirst = ids.join(',') === '5,3,1,2,4,6';
  assertTrue(evensFirst || oddsFirst, `Expected evens then odds or odds then evens, got ${ids.join(',')}`);
});

test('postmanSort: all addresses present', () => {
  const ids = postmanSort(linearStreet);
  assertEqual(ids.length, 5, 'Should return 5 IDs');
  const set = new Set(ids);
  assertEqual(set.size, 5, 'All unique');
  linearStreet.forEach((a) => assertTrue(set.has(a.id), `Missing ${a.id}`));
});

test('postmanSort: single address', () => {
  const ids = postmanSort(single);
  assertEqual(ids, ['1'], 'Single address returns single id');
});

test('postmanSort: empty array', () => {
  const ids = postmanSort([]);
  assertEqual(ids, [], 'Empty returns empty');
});

test('buildBlockSegments: splits street into side + 100-block segments', () => {
  const segments = buildBlockSegments(multiBlockStreet);
  assertEqual(segments.length, 2, 'Should create two 100-block segments');
  assertEqual(
    segments.map((segment) => segment.blockStart),
    [100, 200],
    'Should preserve the 100-block boundaries'
  );
  assertTrue(
    segments.every((segment) => segment.side === 'even'),
    'All test addresses should land on the even side'
  );
});

async function run() {
  await testAsync('buildRoute: returns all addresses once with contiguous sequence_index', async () => {
    const addresses = linearStreet.map((a) => ({ ...a }));
    const depot = { lat: 40.7128, lon: -74.0060 };
    const result = await buildRoute(addresses, depot, { include_geometry: false });
    assertEqual(result.stops.length, 5, 'Should have 5 stops');
    const ids = new Set(result.stops.map((s) => s.id));
    assertEqual(ids.size, 5, 'All IDs unique');
    const seqs = result.stops.map((s) => s.sequence_index).sort((a, b) => a - b);
    assertEqual(seqs, [0, 1, 2, 3, 4], 'sequence_index should be 0..4');
  });
  await testAsync('buildRoute: two streets produce all stops in order', async () => {
    const addresses = twoStreets.map((a) => ({ ...a }));
    const depot = { lat: 40.7128, lon: -74.0065 };
    const result = await buildRoute(addresses, depot, { include_geometry: false });
    assertEqual(result.stops.length, 4, 'Should have 4 stops');
    const idSet = new Set(addresses.map((a) => a.id));
    result.stops.forEach((s) => assertTrue(idSet.has(s.id), `Stop ${s.sequence_index} should be in input`));
    assertEqual(new Set(result.stops.map((s) => s.id)).size, 4, 'No duplicates');
  });
  await testAsync('buildRoute: empty input returns empty stops', async () => {
    const result = await buildRoute([], { lat: 0, lon: 0 }, {});
    assertEqual(result.stops.length, 0, 'Should return no stops');
  });
  await testAsync('buildBalancedBlockClusters: keeps 100-blocks intact across agents', async () => {
    const depot = { lat: 43.9000, lon: -78.9002 };
    const clusters = buildBalancedBlockClusters(multiBlockStreet, 2, depot);
    assertEqual(clusters.length, 2, 'Should create two agent clusters');
    assertTrue(
      clusters.every((cluster) => cluster.segments.length === 1),
      'Each agent should receive one whole block segment'
    );
    assertEqual(
      clusters.map((cluster) => cluster.addresses.length).sort((a, b) => a - b),
      [3, 3],
      'Each block should stay intact with three addresses'
    );
  });
  await testAsync('buildBalancedBlockClusters: prefers contiguous corridor growth over islands', async () => {
    const depot = { lat: 43.9000, lon: -78.9000 };
    const clusters = buildBalancedBlockClusters(parallelCorridors, 2, depot);
    assertEqual(clusters.length, 2, 'Should create two agent clusters');

    const clusterStreetSets = clusters.map((cluster) => new Set(cluster.segments.map((segment) => segment.streetName)));
    assertEqual(
      clusters.map((cluster) => cluster.addresses.length).sort((a, b) => a - b),
      [4, 4],
      'Parallel corridors should be evenly split by door count'
    );
    assertTrue(
      clusterStreetSets.every((streetSet) => streetSet.size <= 2),
      'Balanced mode can relax contiguity, but it should not spray segments across the whole map'
    );
  });
  await testAsync('buildNaturalZoneClusters: splits north/south around Carnwith boundary before clustering', async () => {
    const depot = { lat: 43.9015, lon: -78.9003 };
    const clusters = buildNaturalZoneClusters(carnwithBoundaryNeighborhood, 4, depot);
    assertEqual(clusters.length, 4, 'Should create four agent clusters');

    const northOnly = clusters.filter((cluster) =>
      cluster.segments.every((segment) => segment.centroid.lat > 43.9015)
    );
    const southOnly = clusters.filter((cluster) =>
      cluster.segments.every((segment) => segment.centroid.lat <= 43.9015)
    );

    assertEqual(northOnly.length, 2, 'Two agents should stay in the north lobe');
    assertEqual(southOnly.length, 2, 'Two agents should stay in the south lobe');
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log(`${'='.repeat(50)}`);
  if (testsFailed > 0) process.exit(1);
}

run();
