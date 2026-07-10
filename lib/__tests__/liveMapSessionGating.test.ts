/**
 * Tests: live map session-gating and seat count fix (PR39 map hardening pass)
 *
 * Run with:
 *   npx tsx lib/__tests__/liveMapSessionGating.test.ts
 *
 * Coverage:
 *  1. Presence filter: null session_id is excluded from live map
 *  2. Presence filter: empty string session_id is excluded
 *  3. Presence filter: session_id not in active sessionById is excluded
 *  4. Presence filter: valid session_id in sessionById passes through
 *  5. Presence filter: ended session (not in sessionById) is excluded
 *  6. Seat count: owner role does not consume a paid seat
 *  7. Seat count: member role consumes a paid seat
 *  8. Seat count: seatsRemaining = maxSeats - activePaidMembers - pendingPaidInvites
 *  9. Seat count: workspace with owner only shows max seats remaining
 * 10. Source: map/route.ts contains the presenceWithActiveSession filter
 * 11. Source: manage.ts FREE_SEAT_ROLES includes 'owner'
 * 12. Source: map/route.ts sessions query filters end_time IS NULL
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ─── Pure replica of the presence filter from app/api/team/map/route.ts ───────
// This mirrors the filter applied in loadLivePresence. Any change to the
// production filter should be reflected here.

type PresenceRow = {
  campaign_id: string;
  user_id: string;
  session_id: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  updated_at: string | null;
};

function filterPresenceToActiveSessions(
  validPresence: PresenceRow[],
  sessionById: Map<string, unknown>
): PresenceRow[] {
  return validPresence.filter(
    (row) =>
      typeof row.session_id === 'string' &&
      row.session_id.length > 0 &&
      sessionById.has(row.session_id)
  );
}

// ─── Pure replica of seat usage calculation from app/api/team/_lib/manage.ts ──

type WorkspaceRole = 'owner' | 'admin' | 'member';
const FREE_SEAT_ROLES: WorkspaceRole[] = ['owner', 'admin'];

function calcSeatUsage(options: {
  maxSeats: number | null;
  activeRoles: WorkspaceRole[];
  pendingRoles: Array<'admin' | 'member'>;
}) {
  const maxSeats = Math.max(1, options.maxSeats ?? 1);
  const activeAdmins = options.activeRoles.filter((r) => FREE_SEAT_ROLES.includes(r)).length;
  const pendingAdminInvites = options.pendingRoles.filter((r) => r === 'admin').length;
  const activePaidMembers = options.activeRoles.length - activeAdmins;
  const pendingPaidInvites = options.pendingRoles.length - pendingAdminInvites;
  const seatsUsed = activePaidMembers + pendingPaidInvites;
  return {
    maxSeats,
    activeAdmins,
    activePaidMembers,
    pendingPaidInvites,
    seatsUsed,
    seatsRemaining: Math.max(0, maxSeats - seatsUsed),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePresence(overrides: Partial<PresenceRow> = {}): PresenceRow {
  return {
    campaign_id: 'camp-1',
    user_id: 'user-1',
    session_id: 'sess-1',
    lat: 43.89,
    lng: -78.86,
    status: 'active',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function main() {

// ─── Presence filter ──────────────────────────────────────────────────────────

await test('null session_id is excluded from live map', () => {
  const presence = [makePresence({ session_id: null })];
  const sessionById = new Map([['sess-1', {}]]);
  const result = filterPresenceToActiveSessions(presence, sessionById);
  assert.equal(result.length, 0, 'Row with null session_id must be excluded');
});

await test('empty string session_id is excluded', () => {
  const presence = [makePresence({ session_id: '' })];
  const sessionById = new Map([['sess-1', {}]]);
  const result = filterPresenceToActiveSessions(presence, sessionById);
  assert.equal(result.length, 0, 'Row with empty session_id must be excluded');
});

await test('session_id not in sessionById is excluded', () => {
  const presence = [makePresence({ session_id: 'sess-orphan' })];
  const sessionById = new Map([['sess-active', {}]]); // different session
  const result = filterPresenceToActiveSessions(presence, sessionById);
  assert.equal(result.length, 0, 'Presence whose session is not active must be excluded');
});

await test('valid session_id present in sessionById passes through', () => {
  const presence = [makePresence({ session_id: 'sess-active' })];
  const sessionById = new Map([['sess-active', { id: 'sess-active', end_time: null }]]);
  const result = filterPresenceToActiveSessions(presence, sessionById);
  assert.equal(result.length, 1, 'Active presence must appear on map');
  assert.equal(result[0].session_id, 'sess-active');
});

await test('ended session not in sessionById is excluded', () => {
  // sessionById only holds sessions with end_time IS NULL.
  // A session that has ended will not be in the map, so presence is excluded.
  const presence = [makePresence({ session_id: 'sess-ended' })];
  const sessionById = new Map<string, unknown>(); // ended session not included
  const result = filterPresenceToActiveSessions(presence, sessionById);
  assert.equal(result.length, 0, 'Presence for ended session must be excluded');
});

await test('mixed presence: only active sessions pass', () => {
  const activePresence = makePresence({ session_id: 'sess-a', user_id: 'user-a' });
  const nullPresence = makePresence({ session_id: null, user_id: 'user-b' });
  const endedPresence = makePresence({ session_id: 'sess-ended', user_id: 'user-c' });
  const sessionById = new Map([['sess-a', {}]]);

  const result = filterPresenceToActiveSessions(
    [activePresence, nullPresence, endedPresence],
    sessionById
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].user_id, 'user-a');
});

// ─── Tests: seat count ────────────────────────────────────────────────────────

await test('owner role does not consume a paid seat', () => {
  const usage = calcSeatUsage({
    maxSeats: 1,
    activeRoles: ['owner'],
    pendingRoles: [],
  });
  assert.equal(usage.activePaidMembers, 0, 'Owner must not count as paid member');
  assert.equal(usage.seatsUsed, 0);
  assert.equal(usage.seatsRemaining, 1);
});

await test('admin role does not consume a paid seat', () => {
  const usage = calcSeatUsage({
    maxSeats: 1,
    activeRoles: ['admin'],
    pendingRoles: [],
  });
  assert.equal(usage.activePaidMembers, 0, 'Admin must not count as paid member');
  assert.equal(usage.seatsRemaining, 1);
});

await test('member role consumes a paid seat', () => {
  const usage = calcSeatUsage({
    maxSeats: 2,
    activeRoles: ['member'],
    pendingRoles: [],
  });
  assert.equal(usage.activePaidMembers, 1);
  assert.equal(usage.seatsUsed, 1);
  assert.equal(usage.seatsRemaining, 1);
});

await test('workspace with owner only shows full seats remaining', () => {
  const usage = calcSeatUsage({
    maxSeats: 3,
    activeRoles: ['owner'],
    pendingRoles: [],
  });
  assert.equal(usage.seatsRemaining, 3, 'Owner workspace with no paid members should show full seat count');
});

await test('owner + member: member consumes one seat, owner does not', () => {
  const usage = calcSeatUsage({
    maxSeats: 2,
    activeRoles: ['owner', 'member'],
    pendingRoles: [],
  });
  assert.equal(usage.activePaidMembers, 1, 'Only member counts as paid');
  assert.equal(usage.seatsUsed, 1);
  assert.equal(usage.seatsRemaining, 1);
});

await test('seatsRemaining floors at 0 when over capacity', () => {
  const usage = calcSeatUsage({
    maxSeats: 1,
    activeRoles: ['member', 'member'],
    pendingRoles: [],
  });
  assert.equal(usage.seatsRemaining, 0, 'Must not go negative');
});

await test('pending admin invite does not consume paid seat', () => {
  const usage = calcSeatUsage({
    maxSeats: 2,
    activeRoles: ['owner'],
    pendingRoles: ['admin'],
  });
  assert.equal(usage.seatsUsed, 0);
  assert.equal(usage.seatsRemaining, 2);
});

await test('pending member invite consumes a paid seat', () => {
  const usage = calcSeatUsage({
    maxSeats: 2,
    activeRoles: ['owner'],
    pendingRoles: ['member'],
  });
  assert.equal(usage.pendingPaidInvites, 1);
  assert.equal(usage.seatsUsed, 1);
  assert.equal(usage.seatsRemaining, 1);
});

// ─── Tests: source checks ─────────────────────────────────────────────────────

await test('map/route.ts contains presenceWithActiveSession filter', async () => {
  const src = await read('app/api/team/map/route.ts');
  assert.ok(
    src.includes('presenceWithActiveSession'),
    'Session-gating variable must exist in map route'
  );
  assert.ok(
    src.includes('sessionById.has(row.session_id)'),
    'Filter must check sessionById membership'
  );
});

await test('map/route.ts sessions query filters end_time IS NULL', async () => {
  const src = await read('app/api/team/map/route.ts');
  assert.ok(
    src.includes("is('end_time', null)"),
    'Sessions query must only fetch active (non-ended) sessions'
  );
});

await test("manage.ts FREE_SEAT_ROLES includes 'owner'", async () => {
  const src = await read('app/api/team/_lib/manage.ts');
  // Match the array literal containing both owner and admin
  assert.ok(
    /FREE_SEAT_ROLES[^=]*=\s*\[.*'owner'.*\]/.test(src.replace(/\n/g, ' ')),
    "FREE_SEAT_ROLES must include 'owner'"
  );
});

await test('map/route.ts livePresence uses presenceWithActiveSession not validPresence', async () => {
  const src = await read('app/api/team/map/route.ts');
  // The old code mapped over validPresence directly; after the fix it maps presenceWithActiveSession
  const mapCall = src.match(/livePresence:\s*(\w+)\.map/);
  assert.ok(mapCall, 'livePresence must be assigned from a .map() call');
  assert.equal(
    mapCall?.[1],
    'presenceWithActiveSession',
    'livePresence must map presenceWithActiveSession, not validPresence'
  );
});

} // end main()

// ─── Run ──────────────────────────────────────────────────────────────────────

main()
  .then(() => {
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err: unknown) => {
    console.error('Test runner crashed:', err);
    process.exitCode = 1;
  });
