import assert from 'node:assert/strict';
import { fieldPinDeletionEnabled } from '../rollout';
assert.equal(fieldPinDeletionEnabled('true', 'true'), true);
for (const enabled of ['', 'false', 'TRUE', '1', 'invalid']) assert.equal(fieldPinDeletionEnabled(enabled, 'true'), false);
for (const verified of ['', 'false', 'TRUE', '1', 'invalid']) assert.equal(fieldPinDeletionEnabled('true', verified), false);
console.log('Pin deletion requires both literal rollout and verified-list flags');
