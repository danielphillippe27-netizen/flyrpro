// Isolated PostgreSQL. Uses the real outcome functions; no credentials or production data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migrationRoot = process.env.MIGRATION_ROOT || fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const db = new PGlite();
let checks = 0;
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const owner=id(1), outsider=id(2), campaign=id(10), farm=id(20), touch=id(30), nextTouch=id(31), home=id(40), home2=id(41), farmHome=id(50), session=id(60);
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const check = (value,expected,label) => { assert.deepEqual(value,expected,label); console.log(`ok ${++checks} - ${label}`); };
const rejects = async (fn,re,label) => { await assert.rejects(fn,re); console.log(`ok ${++checks} - ${label}`); };
async function load(name) { return readFile(migrationRoot+name,'utf8'); }
async function save(key,opts={}) {
 return scalar(`SELECT v3_record_field_outcome(p_campaign_id=>$1,p_campaign_address_ids=>$2,p_status=>$3,
 p_notes=>$4,p_occurred_at=>$5,p_client_mutation_id=>$6,p_base_revisions=>$7,p_farm_id=>$8,p_farm_touch_id=>$9,
 p_session_id=>$10,p_session_event_type=>$11)`,
 [campaign,opts.ids??[home],opts.status??'delivered',opts.notes??null,opts.time??'2026-11-07T12:00:00Z',key,
 JSON.stringify(opts.revisions??{[home]:opts.revision??0}),opts.plain?null:farm,opts.plain?null:(opts.touch??touch),
 opts.session??null,opts.event??null]);
}
try {
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE DOMAIN geography AS text;
 CREATE FUNCTION st_makepoint(float8,float8) RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-point' $$;
 CREATE FUNCTION st_setsrid(text,integer) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
 CREATE TABLE workspaces(id uuid PRIMARY KEY,owner_id uuid);
 CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
 CREATE TABLE campaigns(id uuid PRIMARY KEY,workspace_id uuid,owner_id uuid,name text,title text,status text DEFAULT 'active',created_at timestamptz DEFAULT now());
 CREATE TABLE campaign_addresses(id uuid PRIMARY KEY,campaign_id uuid,source_id text,gers_id text,formatted text,address text,match_source text,created_by uuid,updated_by uuid,visited boolean DEFAULT false,scans integer DEFAULT 0,deleted_at timestamptz);
 CREATE TABLE buildings(id uuid PRIMARY KEY,campaign_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY,campaign_id uuid);
 CREATE TABLE user_profiles(user_id uuid PRIMARY KEY,full_name text);
 CREATE TABLE address_statuses(campaign_address_id uuid PRIMARY KEY,campaign_id uuid,status text,notes text,last_visited_at timestamptz,visit_count integer,last_action_by uuid,last_session_id uuid,last_home_event_id uuid,revision bigint,source_occurred_at timestamptz,last_client_mutation_id text,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE campaign_home_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid,campaign_address_id uuid,user_id uuid,session_id uuid,action_type text,note text,created_at timestamptz,occurred_at timestamptz,client_mutation_id text,request_hash text,origin_platform text,client_version text,client_build integer,base_revision bigint,result_revision bigint,applied_to_current boolean,override_reason text,result_state jsonb);
 CREATE TABLE receipts(actor uuid,mutation text,hash text,result jsonb,PRIMARY KEY(actor,mutation));
 CREATE TABLE farms(id uuid PRIMARY KEY,owner_id uuid,workspace_id uuid,linked_campaign_id uuid);
 CREATE TABLE farm_touches(id uuid PRIMARY KEY,farm_id uuid,campaign_id uuid,cycle_number integer,homes_reached integer,updated_at timestamptz);
 CREATE TABLE farm_addresses(id uuid PRIMARY KEY,farm_id uuid,campaign_address_id uuid,formatted text,gers_id text,created_at timestamptz DEFAULT now(),visited_count integer DEFAULT 0,last_visited_at timestamptz,last_touch_id uuid,last_outcome_status text);
 CREATE TABLE sessions(id uuid PRIMARY KEY,user_id uuid,campaign_id uuid,farm_id uuid,farm_touch_id uuid,completed_count integer DEFAULT 0,updated_at timestamptz);
 CREATE TABLE session_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,building_id uuid,address_id uuid,event_type text,created_at timestamptz,lat float8,lon float8,event_location geography,metadata jsonb,user_id uuid);
 CREATE FUNCTION can_view_campaign(p_campaign_id uuid,p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM campaigns WHERE id=p_campaign_id AND owner_id=p_user_id) $$;
 CREATE FUNCTION can_manage_campaign(p_campaign_id uuid,p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT can_view_campaign(p_campaign_id,p_user_id) $$;
 CREATE FUNCTION can_mutate_campaign_address(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT can_view_campaign($1,$3) $$;
 CREATE FUNCTION campaign_client_mutation_allowed(text,integer) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 CREATE FUNCTION observe_campaign_client_build(text,text,integer) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 CREATE FUNCTION campaign_mutation_replay(p_actor uuid,p_id text,p_hash text) RETURNS jsonb LANGUAGE sql AS $$ SELECT CASE WHEN hash=p_hash THEN result || '{"replayed":true}'::jsonb ELSE '{"applied":false,"error_code":"IDEMPOTENCY_KEY_REUSED"}'::jsonb END FROM receipts WHERE actor=p_actor AND mutation=p_id $$;
 CREATE FUNCTION store_campaign_mutation_receipt(uuid,text,uuid,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO receipts VALUES($1,$2,$5,$6) ON CONFLICT DO NOTHING $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated;
 `);
 const base=await load('20260716130000_campaign_collaboration_v2.sql');
 for(const name of ['v2_record_campaign_address_outcome','v2_record_campaign_target_outcome']) {
   const start=base.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
   await db.exec(base.slice(start,base.indexOf('\n$$;',start)+4));
 }
 await db.exec(await load('20260716203000_guard_teammate_manual_pin_status.sql'));
 await db.exec(await load('20260414173000_create_farm_touch_address_history.sql'));
 await db.exec(await load('20260919043000_workspace_home_coverage.sql'));
 await db.exec(await load('20261107020000_unified_field_outcomes.sql'));
 await db.query('INSERT INTO campaigns(id,owner_id) VALUES($1,$2)',[campaign,owner]);
 await db.query('INSERT INTO farms VALUES($1,$2,NULL,$3)',[farm,owner,campaign]);
 await db.query('INSERT INTO farm_touches VALUES($1,$2,$3,1,0,NULL),($4,$2,$3,2,0,NULL)',[touch,farm,campaign,nextTouch]);
 await db.query('INSERT INTO campaign_addresses(id,campaign_id,formatted) VALUES($1,$2,$3),($4,$2,$5)',[home,campaign,'10 Main Unit 1',home2,'10 Main Unit 2']);
 await db.query('INSERT INTO farm_addresses(id,farm_id,campaign_address_id) VALUES($1,$2,$3)',[farmHome,farm,home]);
 await db.query('INSERT INTO sessions(id,user_id,campaign_id,farm_id,farm_touch_id) VALUES($1,$2,$3,$4,$5)',[session,owner,campaign,farm,touch]);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
 check((await save('first',{session,event:'flyer_left',notes:'keep'})).applied,true,'One operation saves campaign and farm');
 check(await scalar('SELECT status FROM address_statuses WHERE campaign_address_id=$1',[home]),'delivered','Campaign status persisted');
 check(await scalar('SELECT status FROM farm_touch_addresses'),'delivered','Farm status persisted');
 check(await scalar('SELECT homes_reached FROM farm_touches WHERE id=$1',[touch]),1,'Farm touch credited');
 check((await save('first',{session,event:'flyer_left',notes:'keep'})).replayed,true,'Exact retry replays');
 check(await scalar('SELECT count(*)::int FROM session_events'),1,'Retry creates no duplicate event');
 await rejects(()=>save('first',{touch:nextTouch}),/IDEMPOTENCY_KEY_REUSED/,'Receipt cannot be reused for another round');
 check((await save('stale',{revision:0,status:'talked'})).error_code,'REVISION_CONFLICT','Stale campaign edit rejected');
 check(await scalar('SELECT status FROM farm_touch_addresses'),'delivered','Rejected edit does not alter farm');
 await rejects(()=>save('missing',{ids:[home,home2],revisions:{[home]:1,[home2]:0}}),/FARM_ADDRESS_LINK_REQUIRED/,'Missing unit link blocks entire save');
 check(await scalar('SELECT revision::int FROM address_statuses WHERE campaign_address_id=$1',[home]),1,'Missing link leaves campaign revision unchanged');
 // Fail after the campaign write to prove transaction rollback, including receipts/events.
 await db.exec(`CREATE FUNCTION fail_farm_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test farm failure'; END $$; CREATE TRIGGER fail_farm BEFORE UPDATE ON farm_touch_addresses FOR EACH ROW EXECUTE FUNCTION fail_farm_write();`);
 await rejects(()=>save('rollback',{revision:1,status:'talked',time:'2026-11-07T12:01:00Z'}),/test farm failure/,'Farm failure aborts campaign and farm transaction');
 check(await scalar('SELECT revision::int FROM address_statuses WHERE campaign_address_id=$1',[home]),1,'Campaign rolled back');
 check(await scalar("SELECT count(*)::int FROM receipts WHERE mutation='rollback'"),0,'Underlying receipt rolled back');
 await db.exec('DROP TRIGGER fail_farm ON farm_touch_addresses');
 check((await save('talked',{revision:1,status:'talked',time:'2026-11-07T12:02:00Z',session,event:'conversation'})).applied,true,'Status upgrade accepted');
 check(await scalar('SELECT completed_count FROM sessions WHERE id=$1',[session]),1,'Status upgrade does not double-count session target');
 check(await scalar('SELECT notes FROM farm_touch_addresses'),'keep','Status-only edit preserves notes');
 check((await save('dnk',{revision:2,status:'do_not_knock',time:'2026-11-07T12:03:00Z',session})).applied,true,'Do Not Knock saved');
 check(await scalar('SELECT completed_count FROM sessions WHERE id=$1',[session]),0,'Do Not Knock retracts session credit');
 check(await scalar('SELECT visited FROM campaign_addresses WHERE id=$1',[home]),false,'Do Not Knock is not campaign visited');
 check(await scalar('SELECT homes_reached FROM farm_touches WHERE id=$1',[touch]),0,'Do Not Knock excludes farm coverage');
 check(await scalar('SELECT last_outcome_status FROM farm_addresses WHERE id=$1',[farmHome]),'do_not_knock','Exclusion remains visible');
 const statsAfterExclusion = await scalar('SELECT rpc_get_campaign_stats($1)',[campaign]);
 check(statsAfterExclusion.visited,0,'Server campaign stats exclude Do Not Knock');
 check(statsAfterExclusion.contacted,0,'Server campaign stats do not invent contacts from buildings');
 check((await save('round-two',{revision:3,touch:nextTouch,time:'2026-11-08T12:00:00Z'})).applied,true,'Second round has independent history');
 check(await scalar('SELECT count(*)::int FROM farm_touch_addresses'),2,'Both rounds retained');
 check((await save('reset',{revision:4,status:'none',touch:nextTouch,time:'2026-11-08T12:01:00Z'})).applied,true,'Reset current round');
 check(await scalar('SELECT status FROM farm_touch_addresses WHERE farm_touch_id=$1',[touch]),'do_not_knock','Reset preserves prior round');
 await rejects(()=>scalar(`SELECT record_farm_address_outcome($1,$2,NULL,$3,'talked',NULL,'2026-11-07T12:00:00Z')`,[farm,touch,home]),/FARM_OUTCOME_CONFLICT/,'Delayed legacy write cannot overwrite newer farm history');
 await rejects(()=>save('wrong-session',{revision:5,touch:nextTouch,session}),/SESSION_FARM_CONTEXT_MISMATCH/,'Session cannot be credited to another round');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[outsider]);
 await rejects(()=>save('outsider'),/access denied/,'Other account denied');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await db.exec('SET ROLE authenticated');
 await rejects(()=>scalar('SELECT * FROM field_outcome_receipts'),/permission denied/,'Receipts are not directly accessible');
 check((await save('plain',{plain:true,ids:[home2],revisions:{[home2]:0}})).applied,true,'Ordinary campaign still works through shared operation');
 await db.exec('RESET ROLE');
 check(await scalar('SELECT count(*)::int FROM farm_touch_addresses'),2,'Ordinary campaign does not invent farm history');
 check((await save('fast-one',{revision:5,status:'talked',touch:nextTouch,time:'2026-11-08T12:02:00Z'})).applied,true,'New round edit');
 check((await save('fast-two',{revision:6,status:'delivered',touch:nextTouch,time:'2026-11-08T12:02:00Z'})).applied,true,'Revision-checked edits in the same second are valid');
 check(await scalar('SELECT count(*)::int FROM farm_touch_addresses'),2,'Rapid changes do not duplicate farm history');
 await db.exec('SET ROLE authenticated');
 await rejects(()=>scalar(`SELECT apply_farm_address_outcome($1,$2,NULL,$3,'talked',NULL,now(),true)`,[farm,touch,home]),/permission denied/,'Cannot bypass revision checks through private helper');
 await db.exec('RESET ROLE');
 await db.query('INSERT INTO farm_addresses(id,farm_id,campaign_address_id) VALUES($1,$2,$3)',[id(51),farm,home2]);
 check((await save('bulk',{ids:[home,home2],revisions:{[home]:7,[home2]:1},touch:nextTouch,status:'talked',time:'2026-11-08T12:04:00Z'})).applied,true,'Bulk target saves both homes atomically');
 check(await scalar('SELECT homes_reached FROM farm_touches WHERE id=$1',[nextTouch]),2,'Bulk farm coverage counts each home once');
 check((await save('bulk-stale',{ids:[home,home2],revisions:{[home]:8,[home2]:0},touch:nextTouch,status:'none',time:'2026-11-08T12:05:00Z'})).error_code,'REVISION_CONFLICT','One stale bulk home rejects the whole target');
 check(await scalar('SELECT homes_reached FROM farm_touches WHERE id=$1',[nextTouch]),2,'Rejected bulk reset leaves farm totals intact');
 console.log(`${checks} unified field-outcome PostgreSQL checks passed`);
} finally {await db.close();}
