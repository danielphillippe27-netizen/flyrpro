import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createSalesFixture} from './field_sales_fixture.mjs';
const {db,id}=await createSalesFixture();
const workspace=id(10),rep=id(2),owner=id(1),foreign=id(4);
await db.exec(`ALTER TABLE session_events ADD user_id uuid;
ALTER TABLE sessions ADD start_time timestamptz DEFAULT now(),ADD end_time timestamptz,ADD active_seconds numeric,ADD distance_meters numeric DEFAULT 0,ADD goal_amount int DEFAULT 0,ADD goal_type text DEFAULT 'knocks',ADD doors_hit int,ADD flyers_delivered int;
ALTER TABLE contacts ADD status text DEFAULT 'new',ADD last_contacted timestamptz,ADD reminder_date timestamptz,ADD updated_at timestamptz DEFAULT now();
CREATE TABLE user_profiles(user_id uuid PRIMARY KEY,full_name text,daily_door_goal int,weekly_door_goal int);
INSERT INTO user_profiles VALUES('${rep}','Rep',75,500),('${owner}','Owner',50,300);
INSERT INTO field_sales_settings VALUES('${workspace}',true,'CAD','America/Toronto',false);
INSERT INTO sessions(id,workspace_id,user_id,campaign_id,start_time,end_time,active_seconds,distance_meters,goal_amount,doors_hit) VALUES
('${id(100)}','${workspace}','${rep}','${id(20)}',now()-interval '2 hours',now()-interval '1 hour',3600,1200,2,4),
('${id(101)}','${workspace}','${owner}','${id(20)}',now()-interval '2 hours',now()-interval '1 hour',3600,800,2,2),
('${id(102)}','${id(11)}','${foreign}',null,now()-interval '2 hours',now()-interval '1 hour',3600,999999,2,999);
INSERT INTO session_events(id,session_id,building_id,created_at,event_type,metadata) VALUES
('${id(110)}','${id(100)}','a',now()-interval '50 minutes','conversation','{}'),
('${id(111)}','${id(100)}','a',now()-interval '49 minutes','conversation','{}'),
('${id(112)}','${id(100)}','b',now()-interval '48 minutes','conversation','{}'),
('${id(113)}','${id(100)}','b',now()-interval '47 minutes','completion_undone','{}'),
('${id(114)}','${id(100)}','c',now()-interval '46 minutes','conversation','{"address_status":"noAnswer"}'),
('${id(115)}','${id(101)}','d',now()-interval '45 minutes','flyer_left','{}'),
('${id(116)}','${id(102)}','e',now()-interval '44 minutes','conversation','{}');
UPDATE contacts SET status='hot',reminder_date=now()-interval '1 day' WHERE id='${id(30)}';
INSERT INTO field_sales(workspace_id,contact_id,rep_id,campaign_id,value_minor,currency,sold_on,status,created_by,request_id) VALUES
('${workspace}','${id(30)}','${rep}','${id(20)}',9000000000000000,'CAD',current_date,'verified','${rep}','${id(200)}');
INSERT INTO field_sales_tasks(id,workspace_id,contact_id,user_id,title,kind,due_at,status,completed_at) VALUES
('${id(201)}','${workspace}','${id(30)}','${rep}','Private task title','call',now()-interval '2 days','done',now()-interval '3 days'),
('${id(202)}','${workspace}','${id(30)}','${rep}','Private task title','call',now()-interval '1 day','pending',null);
`);
await db.exec(await readFile(new URL('../migrations/20260916010000_wolfy_field_intelligence.sql',import.meta.url),'utf8'));
const login=async user=>db.exec(`RESET ROLE;SET ROLE authenticated;SET request.jwt.claim.sub='${user}'`);
const context=async(scope='self',zone='America/Toronto',days=90)=>(await db.query(`SELECT wolfy_field_context($1,$2,$3,$4) c`,[workspace,zone,scope,days])).rows[0].c;
await login(rep);
const c=await context();
assert(c.rows.every(r=>r.rep===rep));assert(c.people.every(p=>p.id===rep));
const total=(ctx,k)=>ctx.rows.reduce((sum,r)=>sum+Number(r.values[k]??0),0);
assert.equal(total(c,'doors'),2);assert.equal(total(c,'conversations'),1);assert.equal(total(c,'active_seconds'),3600);
assert.equal(total(c,'verified_sales'),1);assert(c.rows.some(r=>r.values.revenue_minor==='9000000000000000'));
assert.equal(total(c,'tasks_done'),1);assert.equal(total(c,'tasks_on_time'),1);assert.equal(total(c,'overdue_tasks'),1);
assert(c.unavailable.includes('qr'));assert(!c.available.includes('qr'));
assert(c.priorities.some(p=>p.name==='Private customer'));assert(!JSON.stringify(c).includes('Private task title'));
await assert.rejects(context('team'));await assert.rejects(context('self','bad-zone'));await assert.rejects(context('self','UTC',400));
await login(owner);const team=await context('team');assert.equal(total(team,'doors'),3);assert.equal(team.priorities.length,0);
assert(!JSON.stringify(team).includes('Private customer'));assert(!JSON.stringify(team).includes('Foreign customer'));
assert(!team.rows.some(r=>r.rep===foreign));
await login(foreign);await assert.rejects(context());
await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(context());
// Missing sources remain unavailable; enabled zero rows is a real zero.
await db.exec('RESET ROLE;DROP TABLE field_sales_tasks');await login(rep);const missing=await context();assert(missing.unavailable.includes('tasks'));assert(missing.unavailable.includes('pipeline'));
await db.exec('RESET ROLE;ALTER TABLE contact_activities DROP COLUMN status');await login(rep);
const noOutcomes=await context();assert(noOutcomes.unavailable.includes('appointment_outcomes'));assert(!noOutcomes.available.includes('appointment_outcomes'));
// Role downgrade is re-checked in the database on every request.
await db.exec(`RESET ROLE;UPDATE workspace_members SET role='member' WHERE user_id='${owner}'`);await login(owner);await assert.rejects(context('team'));
await writeFile('/tmp/wolfy-field-context-fixture.json',JSON.stringify(c));
console.log('PASS field intelligence SQL: dedup/undo/outcomes, rep/team/foreign/anonymous isolation, exact revenue, follow-up completion, optional-source failure, role downgrade');
await db.close();
