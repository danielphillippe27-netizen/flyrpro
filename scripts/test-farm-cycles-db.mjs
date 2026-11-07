// Isolated in-memory PostgreSQL test. Never connects to Supabase or reads .env.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
const farm = '10000000-0000-0000-0000-000000000001';
const workspace = '20000000-0000-0000-0000-000000000001';
let checks = 0;
async function scalar(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0]; }
function eq(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
async function rejects(sql, params, pattern) { await assert.rejects(db.query(sql, params), pattern); checks++; }
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE farms(id uuid PRIMARY KEY, owner_id uuid, workspace_id uuid, start_date date);
    CREATE TABLE workspace_members(workspace_id uuid, user_id uuid);
    CREATE TABLE farm_touches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), farm_id uuid REFERENCES farms,
      cycle_number integer DEFAULT 1, status text DEFAULT 'scheduled', scheduled_date timestamptz,
      started_at timestamptz, completed_date timestamptz, completed_at timestamptz,
      last_completed_at timestamptz, completed boolean, created_at timestamptz DEFAULT now());
    CREATE TABLE farm_touch_addresses(farm_touch_id uuid, status text);
    GRANT SELECT, UPDATE ON farms TO authenticated;
    GRANT SELECT ON workspace_members TO authenticated;
    INSERT INTO farms VALUES ('${farm}','${owner}','${workspace}','2026-11-01');
    INSERT INTO workspace_members VALUES ('${workspace}','${member}');
    INSERT INTO farm_touches(farm_id,cycle_number,status,started_at) VALUES ('${farm}',2,'in_progress','2026-11-04');
    INSERT INTO farm_touches(farm_id,cycle_number,status) VALUES ('${farm}',9,'scheduled');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261106012000_explicit_farm_cycles.sql', import.meta.url), 'utf8'));
  eq(await scalar('SELECT active_cycle_number FROM farms'), 2, 'Backfill ignores scheduled future cycle');
  eq(await scalar('SELECT count(*)::int FROM farm_cycles'), 2, 'Existing numbered cycles retained');
  await db.exec(`SET ROLE authenticated; SET test.uid = '${owner}';`);
  let updated = await scalar('SELECT updated_at::text FROM farm_cycles WHERE cycle_number=2');
  eq(await scalar('SELECT ends_on::text FROM set_farm_cycle_end_date($1,2,$2,$3)', [farm,'2026-11-20',updated]), '2026-11-20', 'Edit current end');
  await rejects('SELECT set_farm_cycle_end_date($1,2,$2,$3)', [farm,'2026-11-21',updated], /changed/);
  updated = await scalar('SELECT updated_at::text FROM farm_cycles WHERE cycle_number=2');
  await rejects('SELECT set_farm_cycle_end_date($1,2,$2,$3)', [farm,'2026-11-01',updated], /before/);
  await rejects('UPDATE farms SET active_cycle_number=9 WHERE id=$1', [farm], /settings/);
  await rejects('UPDATE farm_cycles SET ends_on=$1 WHERE farm_id=$2', ['2026-12-01',farm], /permission denied/);
  await rejects('SELECT advance_farm_cycle($1,2,$2,$3)', [farm,'2026-11-03',null], /valid cycle dates/);
  eq(await scalar('SELECT advance_farm_cycle($1,2,$2,$3)', [farm,'2026-11-05','2026-11-30']), 3, 'Advance exactly once');
  await rejects('SELECT advance_farm_cycle($1,2,$2,$3)', [farm,'2026-11-05',null], /changed/);
  eq(await scalar('SELECT active_cycle_number FROM farms'), 3, 'Duplicate advance cannot skip a cycle');
  updated = await scalar('SELECT updated_at::text FROM farm_cycles WHERE cycle_number=2');
  eq(await scalar('SELECT ends_on::text FROM set_farm_cycle_end_date($1,2,$2,$3)', [farm,'2026-11-06',updated]), '2026-11-06', 'Historical end remains editable');
  updated = await scalar('SELECT updated_at::text FROM farm_cycles WHERE cycle_number=3');
  eq(await scalar('SELECT ends_on FROM set_farm_cycle_end_date($1,3,NULL,$2)', [farm,updated]), null, 'Can clear optional end');
  await db.exec(`SET test.uid = '${outsider}';`);
  eq(await scalar('SELECT count(*)::int FROM farm_cycles'), 0, 'Other workspace cannot read dates');
  await rejects('SELECT advance_farm_cycle($1,3,$2,NULL)', [farm,'2026-11-06'], /Access denied/);
  await rejects('SELECT set_farm_cycle_end_date($1,3,NULL,$2)', [farm,updated], /Access denied/);
  await db.exec(`SET test.uid = '${member}';`);
  eq(await scalar('SELECT count(*)::int FROM farm_cycles'), 3, 'Workspace member can read');
  eq(await scalar('SELECT advance_farm_cycle($1,3,$2,NULL)', [farm,'2026-11-06']), 4, 'Workspace member can advance');
  await db.exec('RESET ROLE;');
  eq(await scalar('SELECT cycle_number FROM farm_touches WHERE status=$1', ['in_progress']), 2, 'Existing session stays in old cycle');
  eq(await scalar('INSERT INTO farm_touches(farm_id) VALUES ($1) RETURNING cycle_number', [farm]), 4, 'Unassigned session inherits active');
  eq(await scalar('INSERT INTO farm_touches(farm_id,cycle_number) VALUES ($1,2) RETURNING cycle_number', [farm]), 2, 'Offline assignment preserved');
  eq(await scalar('INSERT INTO farms(id,owner_id,start_date) VALUES (gen_random_uuid(),$1,$2) RETURNING active_cycle_number', [owner,'2026-11-05']), 1, 'New farm starts at one');
  eq(await scalar('SELECT count(*)::int FROM farm_cycles WHERE cycle_number=1'), 1, 'New farm gets dates row');
  await db.exec(`CREATE TABLE sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), farm_id uuid, farm_touch_id uuid REFERENCES farm_touches, end_time timestamptz);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261107010000_simplify_farm_rounds.sql', import.meta.url), 'utf8'));
  await db.exec(`SET ROLE authenticated; SET test.uid = '${owner}';`);
  eq(await scalar('SELECT advance_farm_cycle($1,4,$2,NULL)', [farm,'2026-11-07']), 5, 'Explicit new round');
  eq(await scalar('SELECT undo_farm_round($1,5)', [farm]), 4, 'Undo empty round');
  await rejects('SELECT undo_farm_round($1,5)', [farm], /changed/);
  eq(await scalar('SELECT advance_farm_cycle($1,4,$2,NULL)', [farm,'2026-11-07']), 5, 'Can restart undone round');
  await db.exec('RESET ROLE');
  await rejects('INSERT INTO farm_touches(farm_id,cycle_number) VALUES ($1,6)', [farm], /not been started/);
  const activeTouch = await scalar('INSERT INTO farm_touches(farm_id) VALUES ($1) RETURNING id', [farm]);
  const liveSession = await scalar('INSERT INTO sessions(farm_id,farm_touch_id) VALUES ($1,$2) RETURNING id', [farm,activeTouch]);
  await db.exec(`SET ROLE authenticated; SET test.uid = '${owner}';`);
  await rejects('SELECT advance_farm_cycle($1,5,$2,NULL)', [farm,'2026-11-08'], /Finish the open/);
  await rejects('SELECT undo_farm_round($1,5)', [farm], /already has activity/);
  await db.exec('RESET ROLE');
  await db.query('UPDATE sessions SET end_time=now() WHERE id=$1', [liveSession]);
  await db.exec(`SET ROLE authenticated; SET test.uid = '${owner}';`);
  await rejects('SELECT undo_farm_round($1,5)', [farm], /already has activity/);
  eq(await scalar('SELECT advance_farm_cycle($1,5,$2,NULL)', [farm,'2026-11-08']), 6, 'Ending a session permits explicit advancement');
  await db.exec(`SET test.uid = '${outsider}';`);
  await rejects('SELECT undo_farm_round($1,6)', [farm], /Access denied/);
  await db.exec(`SET test.uid = '${owner}';`);
  eq(await scalar('SELECT undo_farm_round($1,6)', [farm]), 5, 'Undo preserves completed session history');
  await db.exec('RESET ROLE');
  eq(await scalar('SELECT count(*)::int FROM sessions'), 1, 'Session retained');
  console.log(`${checks} isolated PostgreSQL cycle assertions passed`);
} finally { await db.close(); }
