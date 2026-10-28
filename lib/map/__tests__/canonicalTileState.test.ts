import assert from 'node:assert/strict';
import { canonicalTileStates, CanonicalTileStateDiff, statusKey } from '../canonicalTileState';
import type { CanonicalTileBundle, CanonicalMapRecord } from '../canonicalTileBundle';
import type { CampaignAddress } from '@/types/database';

const record = (kind: string, id: string, properties = {}): CanonicalMapRecord => ({
  id, feature_id: `${kind}:${id}`, coordinate: [0, 0], bounds: [0, 0, 0, 0], properties,
});
const bundle = {
  tiles: { layers: { building_units: {} } },
  records: { buildings: [record('building', 'house-1'), record('building', 'house-2')],
    addresses: [record('address', 'home-1'), record('address', 'home-2'), record('address', 'unit-1')],
    parcels: [record('parcel', 'lot-1', { linked_address_ids: ['home-1', 'unit-1'] })] },
  links: [{ building_id: 'house-1', address_id: 'home-1' }, { building_id: 'house-1', address_id: 'unit-1' },
    { building_id: 'house-2', address_id: 'home-2' }],
} as unknown as CanonicalTileBundle;
const home = (id: string, address_status = 'none', scans = 0) => ({ id, address_status, scans } as CampaignAddress);
const untouched = [home('home-1'), home('home-2'), home('unit-1')];
const diff = new CanonicalTileStateDiff();
diff.apply(canonicalTileStates(bundle, untouched), () => {});
const changed: string[] = [];
const writes = canonicalTileStates(bundle, [home('home-1', 'lead'), untouched[1], untouched[2]]);
diff.apply(writes, (write) => changed.push(`${write.sourceLayer}/${write.id}`));
assert.deepEqual(changed.sort(), ['buildings/building:house-1', 'parcels/parcel:lot-1',
  'addresses/address:home-1', 'address_circles/address:home-1', 'building_units/address:home-1'].sort());
assert.equal(writes.find((w) => w.id === 'address:home-2')?.state.status, 'UNTOUCHED');
assert.equal(writes.find((w) => w.id === 'address:unit-1')?.state.status, 'UNTOUCHED', 'Sibling units keep their own colour');
assert.equal(writes.find((w) => w.id === 'building:house-1')?.state.color, '#3b82f6');
let repeats = 0; diff.apply(writes, () => repeats++); assert.equal(repeats, 0);
diff.reset(); diff.apply(writes, () => repeats++); assert.equal(repeats, writes.length, 'Style reset replays every state');
const scan = canonicalTileStates(bundle, [home('home-1', 'talked', 1), untouched[1], untouched[2]]);
assert.equal(scan.find((w) => w.id === 'building:house-1')?.state.color, '#8b5cf6');
assert.equal(scan.find((w) => w.id === 'address:unit-1')?.state.color, '#cfd8e3');
const deleted = canonicalTileStates(bundle, untouched, { deletedAddressIds: ['home-1'] });
assert.equal(deleted.find((w) => w.id === 'address:home-1')?.state.hidden, true);
assert.equal(deleted.find((w) => w.id === 'building:house-1')?.state.hidden, false, 'Other address still occupies shared home');
for (const [status, key] of [['none','UNTOUCHED'], ['attempted','NO_ONE_HOME'], ['talked','CONVERSATIONS'], ['lead','LEADS'],
  ['appointment','HOT_LEADS'], ['do_not_knock','DO_NOT_KNOCK'], ['follow-up','HOT_LEADS']] as const) assert.equal(statusKey(status), key);
console.log('PASS: individual home/pin colours, shared units, QR precedence, deletion, status aliases, diff and style replay');
