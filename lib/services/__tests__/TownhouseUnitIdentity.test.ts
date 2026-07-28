/**
 * Run with: npx tsx lib/services/__tests__/TownhouseUnitIdentity.test.ts
 */
import {
  canonicalizePolygonRing,
  deterministicTownhouseUnitId,
  orderTownhouseAddressesAlongAxis,
  townhouseSplitSignature,
} from '../TownhouseUnitIdentity';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const campaignId = '11111111-1111-4111-8111-111111111111';
const parentBuildingId = 'building-1799';
const ring = [
  [-78.9000, 43.9000],
  [-78.8998, 43.9000],
  [-78.8998, 43.9002],
  [-78.9000, 43.9002],
  [-78.9000, 43.9000],
];
const rotatedReversedRing = [
  [-78.8998, 43.9002],
  [-78.8998, 43.9000],
  [-78.9000, 43.9000],
  [-78.9000, 43.9002],
  [-78.8998, 43.9002],
];
const addresses = [
  { id: 'a-1', lon: -78.89998, lat: 43.9, house_number: '1795', street_name: 'Willow Way' },
  { id: 'a-2', lon: -78.8999, lat: 43.9, house_number: '1797', street_name: 'Willow Way' },
];

const firstId = deterministicTownhouseUnitId({ campaignId, parentBuildingId, unitIndex: 0 });
const secondId = deterministicTownhouseUnitId({ campaignId, parentBuildingId, unitIndex: 0 });
assert(firstId === secondId, 'unit ids must be stable across reruns');
assert(
  firstId === '63192119-95f3-5563-b77a-dccd0eead1e3',
  'all splitter implementations must satisfy the shared UUIDv5 fixture'
);
assert(
  firstId !== deterministicTownhouseUnitId({ campaignId, parentBuildingId, unitIndex: 1 }),
  'different unit indexes must produce different ids'
);

assert(
  JSON.stringify(canonicalizePolygonRing(ring)) === JSON.stringify(canonicalizePolygonRing(rotatedReversedRing)),
  'equivalent rotated/reversed rings must canonicalize identically'
);

const signature = townhouseSplitSignature({
  parentBuildingId,
  ring,
  orderedAddresses: addresses,
  splitMethod: 'obb_linear',
});
const equivalentSignature = townhouseSplitSignature({
  parentBuildingId,
  ring: rotatedReversedRing,
  orderedAddresses: addresses,
  splitMethod: 'obb_linear',
});
assert(signature === equivalentSignature, 'equivalent polygon encodings must share a split signature');

const ordered = orderTownhouseAddressesAlongAxis(
  [...addresses].reverse(),
  [-78.9000, 43.9000],
  [-78.8998, 43.9000]
);
assert(
  ordered.map((address) => address.id).join(',') === 'a-1,a-2',
  'input address order must not affect deterministic spatial unit indexes'
);
const reversedAxisOrder = orderTownhouseAddressesAlongAxis(
  addresses,
  [-78.8998, 43.9000],
  [-78.9000, 43.9000]
);
assert(
  reversedAxisOrder.map((address) => address.id).join(',') === 'a-1,a-2',
  'axis endpoint order must not affect deterministic spatial unit indexes'
);

console.log('✓ deterministic townhouse identity regression tests passed');
