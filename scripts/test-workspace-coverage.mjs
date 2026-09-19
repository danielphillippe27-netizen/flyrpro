// Isolated PostgreSQL test: real outcome functions + real coverage migration.
// Existing auth/access/client-policy dependencies use fixture implementations.
// npm install --prefix /tmp/wolfgrid-coverage-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/wolfgrid-coverage-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-workspace-coverage.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE workspaces(id uuid PRIMARY KEY, owner_id uuid);
CREATE TABLE workspace_members(workspace_id uuid, user_id uuid, role text);
CREATE TABLE campaigns(id uuid PRIMARY KEY, workspace_id uuid, owner_id uuid, name text, title text, status text DEFAULT 'active', created_at timestamptz DEFAULT now());
CREATE TABLE campaign_addresses(id uuid PRIMARY KEY, campaign_id uuid, source_id text, gers_id text, formatted text, address text, match_source text, created_by uuid, updated_by uuid, visited boolean DEFAULT false, deleted_at timestamptz);
CREATE TABLE user_profiles(user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE address_statuses(campaign_address_id uuid PRIMARY KEY, campaign_id uuid, status text, notes text, last_visited_at timestamptz, visit_count integer, last_action_by uuid, last_session_id uuid, last_home_event_id uuid, revision bigint, source_occurred_at timestamptz, last_client_mutation_id text, created_at timestamptz, updated_at timestamptz);
CREATE TABLE campaign_home_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, campaign_address_id uuid, user_id uuid, session_id uuid, action_type text, note text, created_at timestamptz, occurred_at timestamptz, client_mutation_id text, request_hash text, origin_platform text, client_version text, client_build integer, base_revision bigint, result_revision bigint, applied_to_current boolean, override_reason text, result_state jsonb);
CREATE TABLE receipts(actor uuid, mutation text, hash text, result jsonb, PRIMARY KEY(actor,mutation));
CREATE FUNCTION can_view_campaign(p_campaign_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM campaigns c WHERE c.id=p_campaign_id AND (c.owner_id=p_user_id OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=p_user_id))) $$;
CREATE FUNCTION can_manage_campaign(p_campaign_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM campaigns WHERE id=p_campaign_id AND owner_id=p_user_id) $$;
CREATE FUNCTION can_mutate_campaign_address(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT can_view_campaign($1,$3) $$;
CREATE FUNCTION campaign_client_mutation_allowed(text,integer) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION observe_campaign_client_build(text,text,integer) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION campaign_mutation_replay(p_actor uuid,p_id text,p_hash text) RETURNS jsonb LANGUAGE sql AS $$ SELECT CASE WHEN hash=p_hash THEN result || '{"replayed":true}'::jsonb ELSE '{"applied":false,"error_code":"IDEMPOTENCY_KEY_REUSED"}'::jsonb END FROM receipts WHERE actor=p_actor AND mutation=p_id $$;
CREATE FUNCTION store_campaign_mutation_receipt(uuid,text,uuid,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO receipts VALUES($1,$2,$5,$6) ON CONFLICT DO NOTHING $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON workspaces,workspace_members TO authenticated;
`);
const base = await readFile(new URL('../supabase/migrations/20260716130000_campaign_collaboration_v2.sql', import.meta.url), 'utf8');
for (const name of ['can_manage_campaign', 'v2_record_campaign_address_outcome', 'v2_record_campaign_target_outcome']) {
  const start = base.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = base.indexOf('\n$$;', start) + 4;
  assert.ok(start >= 0 && end > start);
  await db.exec(base.slice(start, end));
}
await db.exec(await readFile(new URL('../supabase/migrations/20260716203000_guard_teammate_manual_pin_status.sql', import.meta.url), 'utf8'));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1), rep=id(2), manager=id(3), outsider=id(4), w=id(10), foreign=id(11), a=id(20), b=id(21), c=id(22);
await db.query('INSERT INTO workspaces VALUES($1,$2),($3,$4)', [w,owner,foreign,outsider]);
await db.query("INSERT INTO workspace_members VALUES($1,$2,'owner'),($1,$3,'member'),($1,$4,'admin'),($5,$6,'owner')", [w,owner,rep,manager,foreign,outsider]);
for (const [campaign, workspace, user] of [[a,w,owner],[b,w,rep],[c,foreign,outsider]]) {
  await db.query('INSERT INTO campaigns(id,workspace_id,owner_id,name) VALUES($1,$2,$3,$4)', [campaign,workspace,user,`Campaign ${campaign.slice(-2)}`]);
}
await db.query("INSERT INTO campaign_addresses(id,campaign_id,source_id,formatted) VALUES($1,$2,'source:existing','8 Oak St Unit 1')",[id(99),a]);
await db.query("INSERT INTO address_statuses(campaign_address_id,campaign_id,status,last_action_by,last_visited_at,updated_at) VALUES($1,$2,'delivered',$3,now(),now())",[id(99),a,owner]);
await db.exec(await readFile(new URL('../supabase/migrations/20260919010000_workspace_home_coverage.sql', import.meta.url), 'utf8'));
let checks=0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); console.log(`ok ${++checks} - ${message}`); }
async function rejects(fn,pattern,message) { await assert.rejects(fn,pattern); console.log(`ok ${++checks} - ${message}`); }
async function actor(user) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]); }
async function scalar(sql,params=[]) { return Object.values((await db.query(sql,params)).rows[0])[0]; }
async function address(n,campaign,source='municipal:home-1',label='10 Oak St Unit 1') { await db.query('INSERT INTO campaign_addresses(id,campaign_id,source_id,formatted) VALUES($1,$2,$3,$4)',[id(n),campaign,source,label]); }
async function outcome(campaign,n,mutation,options={}) { return scalar(`SELECT v2_record_campaign_address_outcome(p_campaign_id=>$1,p_campaign_address_id=>$2,p_status=>$3,p_client_mutation_id=>$4,p_base_revision=>$5,p_override_reason=>$6,p_occurred_at=>'2026-09-19T00:00:00Z')`,[campaign,id(n),options.status??'delivered',mutation,options.revision??0,options.reason??null]); }
await actor(rep);
check((await scalar('SELECT get_workspace_coverage_settings($1)',[w])).enabled,false,'default is off');
await rejects(()=>db.query('SELECT set_workspace_coverage($1,true)',[w]),/Only workspace owners/,'campaign creator cannot enable coverage');
await rejects(()=>db.query('SELECT get_workspace_coverage_settings($1)',[foreign]),/Workspace access denied/,'foreign workspace settings denied');
await actor(manager); check((await scalar('SELECT set_workspace_coverage($1,true)',[w])).enabled,true,'manager can enable');
await actor(owner); await scalar('SELECT set_workspace_coverage($1,false)',[w]);
await address(100,a); await address(101,b); await address(102,b,'municipal:home-1','10 Oak St Unit 2'); await address(103,c); await address(104,b,'synthetic-123'); await address(105,b,'source:existing','8 Oak St Unit 1');
check((await outcome(a,100,'first-off')).applied,true,'first visit accepted while off');
await actor(rep); check((await outcome(b,101,'second-off')).applied,true,'duplicate accepted while off');
await actor(owner); await scalar('SELECT set_workspace_coverage($1,true)',[w]);
check((await outcome(a,100,'owner-no-reason',{revision:1})).error_code,'OVERRIDE_REASON_REQUIRED','owner requires explicit override reason');
check((await outcome(a,100,'owner-override',{revision:1,reason:'Scheduled follow-up'})).applied,true,'owner override accepted');
check(await scalar("SELECT action_type FROM campaign_home_events WHERE client_mutation_id='owner-override'"),'manager_override','override is audited');
await actor(rep);
check((await outcome(b,101,'rep-blocked',{revision:1,reason:'I own this campaign'})).error_code,'WORKSPACE_HOME_ALREADY_VISITED','campaign owner is not workspace manager');
check((await outcome(b,102,'unit-two')).applied,true,'different apartment remains available');
check((await outcome(b,104,'synthetic')).applied,true,'synthetic pin remains unmatched');
check((await outcome(b,105,'backfilled')).error_code,'WORKSPACE_HOME_ALREADY_VISITED','historical visits were backfilled');
const snapshot = await scalar('SELECT get_campaign_workspace_coverage($1)',[b]);
check(snapshot.homes.find(h=>h.address_id===id(101)).state,'visited_elsewhere','snapshot contains cross-campaign lock');
check(snapshot.summary.unmatched,1,'snapshot distinguishes unmatched homes');
check(JSON.stringify(snapshot).includes('notes'),false,'coverage does not disclose notes');
check((await outcome(b,102,'unit-two')).replayed,true,'successful mutation replay is preserved');
await actor(outsider); check((await outcome(c,103,'foreign-visit')).applied,true,'another workspace can visit same home');
await rejects(()=>scalar('SELECT get_campaign_workspace_coverage($1)',[a]),/Campaign access denied/,'coverage cannot leak across workspaces');
await actor(owner); await db.query("UPDATE campaigns SET status='archived' WHERE id=$1",[a]);
await actor(rep); check((await outcome(b,105,'archived-block')).error_code,'WORKSPACE_HOME_ALREADY_VISITED','archiving retains visited lock');
await address(106,a,'source:overlap','12 Oak St'); await address(107,b,'source:overlap','12 Oak St');
check((await scalar('SELECT get_campaign_workspace_coverage($1)',[b])).homes.some(h=>h.address_id===id(107)),false,'archiving releases untouched overlap');
await db.query("UPDATE campaigns SET status='active' WHERE id=$1",[a]);
check((await scalar('SELECT get_campaign_workspace_coverage($1)',[b])).homes.find(h=>h.address_id===id(107)).state,'overlap','active untouched campaign is a warning');
await address(200,b,'source:bulk-free','20 Oak St'); await address(201,b,'source:existing','8 Oak St Unit 1');
const bulk=await scalar(`SELECT v2_record_campaign_target_outcome(p_campaign_id=>$1,p_campaign_address_ids=>$2::uuid[],p_status=>'delivered',p_client_mutation_id=>'bulk-conflict',p_base_revisions=>$3::jsonb)`,[b,[id(200),id(201)],JSON.stringify({[id(200)]:0,[id(201)]:0})]);
check(bulk.error_code,'WORKSPACE_HOME_ALREADY_VISITED','bulk returns typed coverage conflict');
check(await scalar('SELECT count(*)::integer FROM address_statuses WHERE campaign_address_id=$1',[id(200)]),0,'earlier bulk child rolled back');
check(await scalar("SELECT count(*)::integer FROM campaign_home_events WHERE client_mutation_id LIKE 'bulk-conflict:%'"),0,'bulk event writes rolled back');
await rejects(()=>db.query("UPDATE address_statuses SET status='talked' WHERE campaign_address_id=$1",[id(101)]),/WORKSPACE_HOME_ALREADY_VISITED/,'direct status write cannot bypass guard');
await db.exec('SET ROLE authenticated');
await rejects(()=>db.query('UPDATE workspace_coverage_settings SET enabled=false WHERE workspace_id=$1',[w]),/permission denied/,'direct setting write denied by privileges');
await rejects(()=>db.query('SELECT * FROM workspace_home_coverage'),/permission denied/,'raw ledger access denied');
await db.exec('RESET ROLE');
await actor(owner); await scalar('SELECT set_workspace_coverage($1,false)',[w]);
await actor(rep);
check((await outcome(b,101,'rep-blocked',{revision:1,reason:'I own this campaign'})).replayed,true,'rejected mutation replays after disabling policy');
check((await outcome(b,101,'disabled-again',{revision:1})).applied,true,'turning off restores normal campaign writes');
await actor(owner); await scalar('SELECT set_workspace_coverage($1,true)',[w]);
await actor(manager);
check((await outcome(b,105,'manager-override',{reason:'Approved follow-up'})).applied,true,'workspace admin can override without owning campaign');
await actor(rep);
check((await outcome(b,101,'clear-local',{status:'none',revision:2})).applied,true,'local reset allowed');
await actor(owner);
check((await outcome(a,100,'history-after-clear',{revision:2})).error_code,'OVERRIDE_REASON_REQUIRED','resetting local status retains team visit history');
await db.query('DELETE FROM campaigns WHERE id=$1',[a]);
await actor(rep);
check((await scalar('SELECT get_campaign_workspace_coverage($1)',[b])).homes.some(h=>h.address_id===id(201) && h.state==='visited_elsewhere'),false,'manager override moves current shared coverage to its campaign');
// A different already-visited home survives deleting its originating campaign.
await actor(outsider); await scalar('SELECT set_workspace_coverage($1,true)',[foreign]);
await address(300,c,'source:retained','30 Oak St');
check((await outcome(c,300,'delete-source-visit')).applied,true,'record before campaign removal');
await db.query('DELETE FROM campaigns WHERE id=$1',[c]);
check(await scalar('SELECT count(*)::int FROM workspace_home_coverage WHERE workspace_id=$1 AND campaign_address_id=$2',[foreign,id(300)]),1,'deleting campaign retains ledger history');
console.log(`PASS ${checks} database assertions (isolated PostgreSQL; no production changes)`);
await db.close();
