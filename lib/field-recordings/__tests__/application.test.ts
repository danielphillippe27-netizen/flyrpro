import assert from 'node:assert/strict';
import { actionDateInput, localActionDate } from '../application';
import { applicationSchema } from '../review';
const prior = process.env.TZ;
try {
  process.env.TZ = 'America/Toronto';
  assert.equal(actionDateInput('2026-10-07T14:00:00Z'), '2026-10-07T10:00');
  assert.equal(localActionDate('2026-10-07T10:00'), '2026-10-07T14:00:00.000Z');
  assert.throws(() => localActionDate('2026-02-30T10:00'));
  assert.throws(() => localActionDate('2026-03-08T02:30')); // DST gap must not silently shift.
  assert.throws(() => localActionDate(''));
  assert.equal(actionDateInput(null), '');
  const base = { requestId: 'ba8019a4-156a-4c89-b695-bfa1b7a4a207', version: 1, contactId: '05d047ed-7517-4bfa-af8a-592148e15c4d', addressId: '2cc2c49b-3b92-453b-aedb-5d81cd02f466', saveNote: false, actions: [{ proposalIndex: 0, dueAt: '2026-10-07T14:00:00Z' }] };
  assert.equal(applicationSchema.safeParse(base).success, true);
  assert.equal(applicationSchema.safeParse({ ...base, actions: [] }).success, false);
  assert.equal(applicationSchema.safeParse({ ...base, actions: [base.actions[0], base.actions[0]] }).success, false);
  assert.equal(applicationSchema.safeParse({ ...base, actions: [{ proposalIndex: 0, dueAt: null }] }).success, false);
  console.log('Action date timezone conversion, invalid/DST gap rejection, required selections and duplicate action validation passed');
} finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
