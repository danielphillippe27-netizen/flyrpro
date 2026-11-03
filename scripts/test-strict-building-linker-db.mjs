/** Isolated PostgreSQL integration tests. NEVER point at a campaign database.
 * STRICT_LINKER_TEST_DATABASE_URL must name wolfgrid_strict_test on localhost.
 * node scripts/test-strict-building-linker-db.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
const url = process.env.STRICT_LINKER_TEST_DATABASE_URL;
if (!url) throw new Error('Provide an isolated STRICT_LINKER_TEST_DATABASE_URL');
const target = new URL(url);
assert(['localhost','127.0.0.1'].includes(target.hostname) && target.pathname === '/wolfgrid_strict_test', 'Use a disposable local wolfgrid_strict_test database');
const client = new pg.Client({connectionString:url});
await client.connect();
let passed=0;
const campaign='10000000-0000-4000-8000-000000000001';
const otherCampaign='10000000-0000-4000-8000-000000000002';
const address=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(n,building,extra={})=>({campaign_id:campaign,address_id:address(n),building_id:building,match_type:'parcel_verified',confidence:.95,distance_meters:2,...extra});
const save=(records,gold=false,c=client)=>c.query('SELECT save_strict_automatic_links($1,$2,$3)',[campaign,JSON.stringify(records),gold]);
const insert=(r,c=client)=>c.query('INSERT INTO building_address_links(campaign_id,address_id,building_id,match_type) VALUES($1,$2,$3,$4)',[r.campaign_id,r.address_id,r.building_id,r.match_type]);
async function test(name,fn){await fn();console.log(`✓ ${name}`);passed++;}
async function reject(fn){await assert.rejects(fn,e=>e.code==='23514');}
try {
  assert.equal((await client.query("SELECT to_regclass('public.campaign_addresses') AS name")).rows[0].name,null,'Database must be empty');
  await client.query(`DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE buildings(id uuid PRIMARY KEY,gers_id text);
    CREATE TABLE campaign_addresses(id uuid PRIMARY KEY,campaign_id uuid,building_id uuid,building_gers_id text,match_source text,source text,confidence float);
    CREATE TABLE building_address_links(id uuid DEFAULT gen_random_uuid(),campaign_id uuid,building_id text NOT NULL,address_id uuid,match_type text,confidence float,distance_meters float,street_match_score float,building_area_sqm float,building_class text,building_height float,is_multi_unit boolean,unit_count integer,unit_arrangement text,overture_release text,linker_version integer,user_confirmed boolean,locked boolean,UNIQUE(campaign_id,address_id));
    CREATE TABLE address_orphans(campaign_id uuid,address_id uuid);
    CREATE FUNCTION apply_global_reverse_assignment_core(uuid,uuid,jsonb,text) RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
  for(let n=1;n<=40;n++) await client.query('INSERT INTO campaign_addresses(id,campaign_id) VALUES($1,$2)',[address(n),campaign]);
  await insert(record(1,'historical',{match_type:'manual'}));
  await insert(record(2,'historical',{match_type:'manual'}));
  await client.query(fs.readFileSync(new URL('../supabase/migrations/20261103140000_strict_additive_building_linker.sql',import.meta.url),'utf8'));
  await test('migration preserves historical multi-address groups',async()=>assert.equal((await client.query("SELECT count(*)::int AS n FROM building_address_links WHERE building_id='historical'")).rows[0].n,2));
  await test('unique pair saves both tables atomically and retries are idempotent',async()=>{
    await save([record(3,'home-3')],true);await save([record(3,'home-3')],true);
    assert.equal((await client.query('SELECT building_gers_id FROM campaign_addresses WHERE id=$1',[address(3)])).rows[0].building_gers_id,'home-3');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM building_address_links WHERE address_id=$1',[address(3)])).rows[0].n,1);
  });
  await test('occupied building rejects a second automatic address',async()=>reject(()=>save([record(4,'home-3')])));
  await test('an occupied address cannot be reassigned',async()=>reject(()=>save([record(3,'other-home')])));
  await test('historical manual assignment cannot be overwritten automatically',async()=>reject(()=>client.query("UPDATE building_address_links SET match_type='parcel_verified' WHERE address_id=$1",[address(1)])));
  await test('manual groups remain explicitly editable',async()=>{await insert(record(4,'historical',{match_type:'manual'}));});
  await test('a conflicting batch rolls back every link and Gold mirror',async()=>{
    await reject(()=>save([record(5,'home-5'),record(6,'home-3')],true));
    assert.equal((await client.query('SELECT building_gers_id FROM campaign_addresses WHERE id=$1',[address(5)])).rows[0].building_gers_id,null);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM building_address_links WHERE address_id=$1',[address(5)])).rows[0].n,0);
  });
  await test('duplicate building claims in one batch are rejected',async()=>reject(()=>save([record(5,'duplicate'),record(6,'duplicate')])));
  await test('Gold-only assignments reserve buildings',async()=>{
    await client.query("UPDATE campaign_addresses SET building_gers_id='gold-only',match_source='gold_exact' WHERE id=$1",[address(7)]);
    await reject(()=>save([record(8,'gold-only')]));
  });
  await test('UUID and public building aliases share occupancy',async()=>{
    const uuid='30000000-0000-4000-8000-000000000001';
    await client.query("INSERT INTO buildings VALUES($1,'public-home')",[uuid]);
    await insert(record(9,uuid,{match_type:'manual'}));
    await reject(()=>save([record(10,'public-home')]));
    await reject(()=>save([record(10,'overture:building:public-home')]));
    await reject(()=>save([record(10,uuid),record(11,'public-home')]));
  });
  await test('direct legacy writes cannot bypass occupancy checks',async()=>{
    await reject(()=>insert(record(12,'home-3')));
    await reject(()=>client.query("UPDATE campaign_addresses SET building_gers_id='home-3' WHERE id=$1",[address(12)]));
  });
  await test('legacy destructive reset is disabled before touching data',async()=>{
    await assert.rejects(()=>client.query('SELECT clear_campaign_building_links($1)',[campaign]),/Legacy resetting linker disabled/);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM building_address_links WHERE address_id=$1',[address(3)])).rows[0].n,1);
  });
  await test('global reconciliation cannot delete/rebuild an occupied assignment',async()=>{
    const args=[campaign,campaign,JSON.stringify([{address_id:address(3),building_id:'elsewhere'}]),'test'];
    await reject(()=>client.query('SELECT apply_global_reverse_assignment_core($1,$2,$3,$4)',args));
    await reject(()=>client.query('SELECT apply_global_reverse_assignment($1,$2,$3,$4)',args));
  });
  await test('concurrent database sessions cannot claim the same empty building',async()=>{
    const first=new pg.Client({connectionString:url}),second=new pg.Client({connectionString:url});
    await first.connect();await second.connect();
    try {
      await first.query('BEGIN');await insert(record(13,'race-home'),first);
      let settled=false;
      const competing=insert(record(14,'race-home'),second).then(()=>{settled=true;return null},e=>{settled=true;return e});
      await new Promise(resolve=>setTimeout(resolve,60));assert.equal(settled,false,'second writer waits for campaign lock');
      await first.query('COMMIT');
      const error=await competing;assert.equal(error?.code,'23514');
      assert.equal((await client.query("SELECT count(*)::int AS n FROM building_address_links WHERE building_id='race-home'")).rows[0].n,1);
      // Gold mirrors and link-table writers must share the same lock too.
      await first.query('BEGIN');
      await first.query("UPDATE campaign_addresses SET building_gers_id='race-gold' WHERE id=$1",[address(16)]);
      const goldVsLink=insert(record(17,'race-gold'),second).then(()=>null,e=>e);
      await new Promise(resolve=>setTimeout(resolve,40));await first.query('COMMIT');
      assert.equal((await goldVsLink)?.code,'23514');
      await first.query('BEGIN');
      await first.query("UPDATE campaign_addresses SET building_gers_id='race-gold-only' WHERE id=$1",[address(18)]);
      const goldVsGold=second.query("UPDATE campaign_addresses SET building_gers_id='race-gold-only' WHERE id=$1",[address(19)]).then(()=>null,e=>e);
      await new Promise(resolve=>setTimeout(resolve,40));await first.query('COMMIT');
      assert.equal((await goldVsGold)?.code,'23514');
    } finally {await first.query('ROLLBACK');await first.end();await second.end();}
  });
  await test('the same physical building can belong to a separate campaign',async()=>{
    await client.query('INSERT INTO campaign_addresses(id,campaign_id) VALUES($1,$2)',[address(40).replace('20000000','40000000'),otherCampaign]);
    await insert({campaign_id:otherCampaign,address_id:address(40).replace('20000000','40000000'),building_id:'home-3',match_type:'parcel_verified'});
  });
  console.log(`${passed} PostgreSQL integration checks passed (including two-session concurrency).`);
} finally {await client.end();}
