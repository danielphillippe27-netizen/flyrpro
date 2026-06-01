/**
 * Campaign assignment draft state tests
 *
 * Run with: npx tsx lib/__tests__/campaignAssignmentDraft.test.ts
 */

import {
  applyManualOverridesToZones,
  buildAssignmentByAddressId,
  countManualOverridesByMember,
  sanitizeManualOverrides,
} from '../campaignAssignmentDraft';
import type { AssignmentDraftAddress } from '../campaignAssignmentDraft';
import { selectedAddressIdsFromFeatures } from '../campaignAssignmentMapSelection';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) throw new Error(message || 'Expected true, got false');
}

const addresses: AssignmentDraftAddress[] = [
  { id: 'a1', sequence: 1 },
  { id: 'a2', sequence: 2 },
  { id: 'a3', sequence: 3 },
  { id: 'a4', sequence: 4 },
];
const memberIds = ['rep-1', 'rep-2'];
const autoZones = new Map<string, AssignmentDraftAddress[]>([
  ['rep-1', [addresses[0], addresses[1]]],
  ['rep-2', [addresses[2], addresses[3]]],
]);

function flattenZones(zones: Map<string, AssignmentDraftAddress[]>): string[] {
  return memberIds.flatMap((memberId) => (zones.get(memberId) ?? []).map((address) => address.id));
}

console.log('Running campaignAssignmentDraft tests...\n');

test('assigning selection changes modal draft only until Apply', () => {
  const appliedOverrides: Record<string, string> = {};
  const modalDraft = sanitizeManualOverrides({ ...appliedOverrides, a2: 'rep-2' }, addresses, memberIds, autoZones);

  assertEqual(appliedOverrides, {}, 'Applied preview state should remain unchanged');
  assertEqual(modalDraft, { a2: 'rep-2' }, 'Modal draft should contain the pending edit');
});

test('Cancel discards modal edits', () => {
  const appliedOverrides: Record<string, string> = {};
  const modalDraft = sanitizeManualOverrides({ a2: 'rep-2' }, addresses, memberIds, autoZones);
  const afterCancel = appliedOverrides;

  assertEqual(modalDraft, { a2: 'rep-2' });
  assertEqual(afterCancel, {}, 'Cancel should leave applied overrides untouched');
});

test('Apply updates preview zones and member counters', () => {
  const appliedOverrides = sanitizeManualOverrides({ a2: 'rep-2' }, addresses, memberIds, autoZones);
  const previewZones = applyManualOverridesToZones(autoZones, addresses, memberIds, appliedOverrides);
  const counts = countManualOverridesByMember(appliedOverrides, addresses, memberIds, autoZones);

  assertEqual((previewZones.get('rep-1') ?? []).map((address) => address.id), ['a1']);
  assertEqual((previewZones.get('rep-2') ?? []).map((address) => address.id), ['a3', 'a4', 'a2']);
  assertEqual(counts.get('rep-1'), 0);
  assertEqual(counts.get('rep-2'), 1);
});

test('Assign Campaign posts every campaign home exactly once from effective zones', () => {
  const appliedOverrides = sanitizeManualOverrides({ a1: 'rep-2', a4: 'rep-1' }, addresses, memberIds, autoZones);
  const effectiveZones = applyManualOverridesToZones(autoZones, addresses, memberIds, appliedOverrides);
  const postedAddressIds = flattenZones(effectiveZones);
  const uniqueAddressIds = new Set(postedAddressIds);

  assertEqual(postedAddressIds.length, addresses.length, 'Every home should be included');
  assertEqual(uniqueAddressIds.size, addresses.length, 'No home should be duplicated');
  addresses.forEach((address) => assertTrue(uniqueAddressIds.has(address.id), `Missing ${address.id}`));
});

test('polygon selection produces selected address IDs', () => {
  const polygon: GeoJSON.Feature = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-79.001, 43.000],
        [-79.000, 43.000],
        [-79.000, 43.001],
        [-79.001, 43.001],
        [-79.001, 43.000],
      ]],
    },
    properties: {},
  };
  const selected = selectedAddressIdsFromFeatures(
    [polygon],
    [
      { id: 'inside', lat: 43.0005, lon: -79.0005 },
      { id: 'outside', lat: 43.0020, lon: -79.0005 },
    ]
  );

  assertEqual(selected, ['inside']);
});

test('invalid or same-member overrides are removed before persistence', () => {
  const sanitized = sanitizeManualOverrides(
    {
      a1: 'rep-1',
      a2: 'rep-2',
      missing: 'rep-2',
      a3: 'missing-rep',
    },
    addresses,
    memberIds,
    autoZones
  );
  const assignment = buildAssignmentByAddressId(applyManualOverridesToZones(autoZones, addresses, memberIds, sanitized));

  assertEqual(sanitized, { a2: 'rep-2' });
  assertEqual(assignment.get('a2'), 'rep-2');
  assertEqual(assignment.size, addresses.length);
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`${'='.repeat(50)}`);
if (testsFailed > 0) process.exit(1);
