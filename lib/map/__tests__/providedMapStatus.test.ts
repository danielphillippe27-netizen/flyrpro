import assert from 'node:assert/strict';
import { applyProvidedMapStatus } from '../providedMapStatus';
import type { CampaignAddress } from '@/types/database';

const campaign = { id: 'home', building_id: 'roof', address_status: 'talked', visited: true,
  status_revision: 99, last_action_by: 'teammate', scans: 3, last_scanned_at: '2026-11-05' } as CampaignAddress;
const cycle = { id: 'home', address_status: 'no_answer', visited: true } as CampaignAddress;
const result = applyProvidedMapStatus(campaign, cycle);
assert.equal(result.address_status, 'no_answer');
assert.equal(result.building_id, 'roof');
assert.equal(result.scans, 0);
assert.equal(result.last_action_by, undefined);
assert.equal(result.last_scanned_at, undefined);
assert.equal(applyProvidedMapStatus(campaign).address_status, 'none');
assert.equal(applyProvidedMapStatus(campaign).visited, false);
assert.equal(applyProvidedMapStatus(campaign, { ...cycle, address_status: 'do_not_knock' }).address_status, 'do_not_knock');
assert.equal(campaign.address_status, 'talked');
console.log('PASS: cycle colours override campaign revisions and QR state while preserving building identity');
