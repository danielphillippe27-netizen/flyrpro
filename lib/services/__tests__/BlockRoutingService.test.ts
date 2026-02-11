/**
 * BlockRoutingService Unit Tests
 * 
 * Run with: npx tsx lib/services/__tests__/BlockRoutingService.test.ts
 */

import { buildBlockStops, orderAddressesWithinBlock } from '../BlockRoutingService';
import type { BlockAddress } from '../BlockRoutingService';

// Simple test runner
let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (e: any) {
    console.error(`✗ ${name}`);
    console.error(`  ${e.message}`);
    testsFailed++;
  }
}

function assertEqual(actual: any, expected: any, msg?: string) {
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

// Simple linear street (Main St)
const linearStreet: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
  { id: '2', lat: 40.7129, lon: -74.0061, house_number: '102', street_name: 'Main St' },
  { id: '3', lat: 40.7130, lon: -74.0062, house_number: '104', street_name: 'Main St' },
  { id: '4', lat: 40.7131, lon: -74.0063, house_number: '106', street_name: 'Main St' },
  { id: '5', lat: 40.7132, lon: -74.0064, house_number: '108', street_name: 'Main St' },
];

// Two different streets
const twoStreets: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
  { id: '2', lat: 40.7129, lon: -74.0061, house_number: '102', street_name: 'Main St' },
  { id: '3', lat: 40.7130, lon: -74.0070, house_number: '200', street_name: 'Oak Ave' },
  { id: '4', lat: 40.7131, lon: -74.0071, house_number: '202', street_name: 'Oak Ave' },
];

// Large gap in addresses (should split into two blocks)
const withGap: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
  { id: '2', lat: 40.7129, lon: -74.0061, house_number: '102', street_name: 'Main St' },
  { id: '3', lat: 40.7150, lon: -74.0090, house_number: '200', street_name: 'Main St' }, // 500m+ away
  { id: '4', lat: 40.7151, lon: -74.0091, house_number: '202', street_name: 'Main St' },
];

// No street names
const noStreetNames: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060 },
  { id: '2', lat: 40.7129, lon: -74.0061 },
  { id: '3', lat: 40.7130, lon: -74.0062 },
];

// Empty
const empty: BlockAddress[] = [];

// Single address
const single: BlockAddress[] = [
  { id: '1', lat: 40.7128, lon: -74.0060, house_number: '100', street_name: 'Main St' },
];

// ==================== Tests ====================

console.log('Running BlockRoutingService Tests...\n');

// Test 1: Build blocks from linear street
test('buildBlockStops: linear street creates single block', () => {
  const blocks = buildBlockStops(linearStreet);
  assertEqual(blocks.length, 1, 'Should create 1 block for contiguous street');
  assertEqual(blocks[0].addressIds.length, 5, 'Block should have 5 addresses');
  assertEqual(blocks[0].metadata.street_name, 'Main St', 'Should preserve street name');
  assertTrue(blocks[0].metadata.count === 5, 'Count should be 5');
});

// Test 2: Build blocks from two streets
test('buildBlockStops: two streets create separate blocks', () => {
  const blocks = buildBlockStops(twoStreets);
  assertEqual(blocks.length, 2, 'Should create 2 blocks for 2 streets');
  
  // Check that addresses are grouped correctly
  const mainStBlock = blocks.find(b => b.metadata.street_name === 'Main St');
  const oakAveBlock = blocks.find(b => b.metadata.street_name === 'Oak Ave');
  
  assertTrue(!!mainStBlock, 'Should have Main St block');
  assertTrue(!!oakAveBlock, 'Should have Oak Ave block');
  assertEqual(mainStBlock!.addressIds.length, 2, 'Main St should have 2 addresses');
  assertEqual(oakAveBlock!.addressIds.length, 2, 'Oak Ave should have 2 addresses');
});

// Test 3: Large gap splits blocks
test('buildBlockStops: large gap splits into multiple blocks', () => {
  const blocks = buildBlockStops(withGap, { maxRunGapM: 50 });
  assertTrue(blocks.length >= 2, `Should split into at least 2 blocks, got ${blocks.length}`);
});

// Test 4: Empty input
test('buildBlockStops: empty input returns empty array', () => {
  const blocks = buildBlockStops(empty);
  assertEqual(blocks.length, 0, 'Should return empty array for empty input');
});

// Test 5: Single address
test('buildBlockStops: single address creates single block', () => {
  const blocks = buildBlockStops(single);
  assertEqual(blocks.length, 1, 'Should create 1 block for single address');
  assertEqual(blocks[0].addressIds.length, 1, 'Block should have 1 address');
});

// Test 6: No street names
test('buildBlockStops: handles addresses without street names', () => {
  const blocks = buildBlockStops(noStreetNames);
  assertEqual(blocks.length, 1, 'Should handle missing street names');
  assertEqual(blocks[0].addressIds.length, 3, 'Block should have all 3 addresses');
});

// Test 7: Block centroid calculation
test('buildBlockStops: calculates correct centroid', () => {
  const blocks = buildBlockStops(linearStreet);
  const block = blocks[0];
  
  // Centroid should be roughly in the middle
  const expectedLat = linearStreet.reduce((s, a) => s + a.lat, 0) / linearStreet.length;
  const expectedLon = linearStreet.reduce((s, a) => s + a.lon, 0) / linearStreet.length;
  
  assertTrue(Math.abs(block.lat - expectedLat) < 0.0001, 'Lat should be close to centroid');
  assertTrue(Math.abs(block.lon - expectedLon) < 0.0001, 'Lon should be close to centroid');
});

// Test 8: Block ID generation
test('buildBlockStops: generates deterministic IDs', () => {
  const blocks1 = buildBlockStops(linearStreet);
  const blocks2 = buildBlockStops(linearStreet);
  
  assertEqual(blocks1[0].id, blocks2[0].id, 'Same input should produce same ID');
});

// Test 9: Order within block - linear street should maintain order
test('orderAddressesWithinBlock: maintains linear order', async () => {
  const orderedIds = await orderAddressesWithinBlock(linearStreet, { useWalkwayProjection: false });
  
  // PCA should order them in some linear sequence
  assertEqual(orderedIds.length, 5, 'Should return all 5 addresses');
  
  // All IDs should be present
  const originalIds = new Set(linearStreet.map(a => a.id));
  const returnedIds = new Set(orderedIds);
  assertEqual(returnedIds.size, 5, 'Should have 5 unique IDs');
  assertTrue([...returnedIds].every(id => originalIds.has(id)), 'All IDs should be from original set');
});

// Test 10: Empty block ordering
test('orderAddressesWithinBlock: handles empty array', async () => {
  const orderedIds = await orderAddressesWithinBlock([], { useWalkwayProjection: false });
  assertEqual(orderedIds.length, 0, 'Should return empty array for empty input');
});

// Test 11: Single address ordering
test('orderAddressesWithinBlock: handles single address', async () => {
  const orderedIds = await orderAddressesWithinBlock(single, { useWalkwayProjection: false });
  assertEqual(orderedIds.length, 1, 'Should return 1 ID');
  assertEqual(orderedIds[0], '1', 'Should return the single address ID');
});

// Test 12: Target block size splitting
test('buildBlockStops: respects target block size', () => {
  // Create many addresses on same street
  const manyAddresses: BlockAddress[] = [];
  for (let i = 0; i < 100; i++) {
    manyAddresses.push({
      id: `addr-${i}`,
      lat: 40.7128 + i * 0.0001,
      lon: -74.0060 - i * 0.0001,
      house_number: `${100 + i * 2}`,
      street_name: 'Main St'
    });
  }
  
  const blocks = buildBlockStops(manyAddresses, { targetBlockSize: 10 });
  
  // Should have roughly target block size (allowing for merge tolerance)
  assertTrue(blocks.length <= 15, `Should have at most 15 blocks, got ${blocks.length}`);
  assertTrue(blocks.length >= 3, `Should have at least 3 blocks, got ${blocks.length}`);
});

// ==================== Summary ====================

console.log(`\n${'='.repeat(50)}`);
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`${'='.repeat(50)}`);

if (testsFailed > 0) {
  process.exit(1);
}
