import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLivePresence } from '../team-live-map';

type Row = Record<string, unknown>;
function fixture(): Record<string, Row[]> {
  return {
    workspace_members: [{ workspace_id: 'team', user_id: 'rep', color: '#123456', created_at: '2026-01-01' }],
    user_profiles: [{ user_id: 'rep', first_name: 'Alex', last_name: 'Smith' }],
    campaigns: [{ workspace_id: 'team', id: 'campaign', title: 'North Oshawa', name: null }],
    campaign_presence: [{ campaign_id: 'campaign', user_id: 'rep', session_id: 'session', lat: 43.9, lng: -78.8, status: 'active', updated_at: new Date().toISOString() }],
    sessions: [{ workspace_id: 'team', id: 'session', user_id: 'rep', campaign_id: 'campaign', end_time: null, start_time: '2026-01-01', active_seconds: 120, distance_meters: 100, doors_hit: 4, conversations: 2, flyers_delivered: 3 }],
  };
}
// Generic query transport only; all live-map business logic comes from production.
function client(tables: Record<string, Row[]>, failTable?: string) {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { rows = rows.filter(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { rows = rows.filter(row => row[key] !== value); return query; },
      is(key: string, value: unknown) { return query.eq(key, value); },
      in(key: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[key])); return query; },
      gte(key: string, value: string) { rows = rows.filter(row => typeof row[key] === 'string' && row[key] >= value); return query; },
      order(key: string, options: { ascending: boolean }) {
        rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending ? 1 : -1)); return query;
      },
      then(resolve: (result: { data: Row[] | null; error: Error | null }) => unknown) {
        return Promise.resolve(resolve({ data: table === failTable ? null : rows, error: table === failTable ? new Error(`${table} unavailable`) : null }));
      },
    }; return query;
  } } as unknown as Parameters<typeof loadLivePresence>[0];
}
const load = (tables = fixture()) => loadLivePresence(client(tables), 'team');

test('identity, campaign, GPS and activity reach the manager together', async () => {
  const { livePresence } = await load();
  assert.equal(livePresence.length, 1);
  assert.deepEqual(livePresence[0], {
    user_id: 'rep', display_name: 'Alex Smith', color: '#123456', campaign_id: 'campaign', campaign_name: 'North Oshawa', session_id: 'session', lat: 43.9, lng: -78.8, status: 'active', updated_at: livePresence[0].updated_at, started_at: '2026-01-01', active_seconds: 120, distance_meters: 100, doors_hit: 4, conversations: 2, flyers_delivered: 3,
  });
});
test('movement and door counts change on the next refresh', async () => {
  const tables = fixture(); const before = await load(tables);
  tables.campaign_presence[0].lat = 43.91; tables.sessions[0].doors_hit = 5;
  const after = await load(tables);
  assert.notEqual(after.livePresence[0].lat, before.livePresence[0].lat);
  assert.equal(after.livePresence[0].doors_hit, 5);
});
for (const [name, patch] of Object.entries({
  'ended session': { end_time: '2026-01-02' },
  'foreign workspace session': { workspace_id: 'other' },
  'wrong campaign session': { campaign_id: 'other' },
})) test(`${name} is excluded`, async () => {
  const tables = fixture(); Object.assign(tables.sessions[0], patch);
  assert.equal((await load(tables)).livePresence.length, 0);
});
for (const [name, patch] of Object.entries({
  'missing session': { session_id: null }, 'unknown session': { session_id: 'unknown' },
  'inactive rep': { status: 'inactive' },
  'stale presence': { updated_at: new Date(Date.now() - 6 * 60_000).toISOString() },
  'invalid latitude': { lat: 91 }, 'invalid longitude': { lng: -181 },
  'missing GPS': { lat: null }, 'nonfinite GPS': { lat: NaN }, 'nonmember rep': { user_id: 'outsider' },
})) test(`${name} is excluded`, async () => {
  const tables = fixture(); Object.assign(tables.campaign_presence[0], patch);
  assert.equal((await load(tables)).livePresence.length, 0);
});
test('shared-session teammate remains visible when the host owns the session', async () => {
  const tables = fixture(); tables.sessions[0].user_id = 'host';
  assert.equal((await load(tables)).livePresence[0].user_id, 'rep');
});
test('campaign switch produces one rep at their newest valid location', async () => {
  const tables = fixture();
  tables.campaigns.push({ ...tables.campaigns[0], id: 'next' });
  tables.sessions.push({ ...tables.sessions[0], id: 'next-session', campaign_id: 'next' });
  tables.campaign_presence.push({ ...tables.campaign_presence[0], campaign_id: 'next', session_id: 'next-session', lat: 44, updated_at: new Date(Date.now() + 1000).toISOString() });
  const { livePresence } = await load(tables);
  assert.equal(livePresence.length, 1); assert.equal(livePresence[0].campaign_id, 'next'); assert.equal(livePresence[0].lat, 44);
});
test('foreign workspace campaign is excluded', async () => {
  const tables = fixture(); tables.campaigns[0].workspace_id = 'other';
  assert.equal((await load(tables)).livePresence.length, 0);
});
test('paused rep retains paused status', async () => {
  const tables = fixture(); tables.campaign_presence[0].status = 'paused';
  assert.equal((await load(tables)).livePresence[0].status, 'paused');
});
test('missing profile retains Member fallback', async () => {
  const tables = fixture(); tables.user_profiles = [];
  assert.equal((await load(tables)).livePresence[0].display_name, 'Member');
});
for (const table of ['workspace_members', 'user_profiles', 'campaigns', 'campaign_presence', 'sessions']) {
  test(`${table} failure is reported instead of a misleading empty map`, async () => {
    await assert.rejects(() => loadLivePresence(client(fixture(), table), 'team'), new RegExp(`${table} unavailable`));
  });
}
