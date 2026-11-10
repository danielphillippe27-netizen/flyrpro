import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [user, other, ws, contact, unrelated, campaign, home, otherWs, hiddenHome, card] = Array.from({ length: 10 }, (_, i) => id(i + 1));
await db.exec(`
  create role authenticated; create role anon; create role service_role; create schema auth;
  create table auth.users(id uuid primary key);
  insert into auth.users values('${user}'),('${other}');
  create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
  grant usage on schema auth to authenticated;
  create table workspaces(id uuid primary key);
  create table workspace_members(workspace_id uuid,user_id uuid);
  create table profiles(id uuid,full_name text);
  create table campaign_assignments(id uuid,campaign_id uuid,workspace_id uuid,assigned_to_user_id uuid,status text);
  create table campaign_assignment_homes(campaign_address_id uuid,assignment_id uuid);
  create table contacts(id uuid primary key,workspace_id uuid,user_id uuid,address_id uuid,source text,tags text,do_not_contact boolean,
    full_name text,phone text,email text,address text,status text,appointment_at timestamptz,appointment_title text,appointment_location text,created_at timestamptz default now(),updated_at timestamptz default now());
  create table crm_contact_profiles(user_id uuid,workspace_id uuid,contact_id uuid,stage text default 'Lead',primary key(user_id,contact_id));
  create function mac_contact_identifier(value text) returns text language sql immutable as $$select nullif(lower(trim(value)),'')$$;
  create function coco_crm_command(ws uuid, command text, payload jsonb) returns jsonb language plpgsql as $$
  declare contact uuid:=gen_random_uuid(); begin
    insert into contacts(id,workspace_id,user_id,full_name,phone,email)
      values(contact,ws,auth.uid(),trim(payload->>'first_name'||' '||coalesce(payload->>'last_name','')),payload->>'phone',payload->>'email');
    return jsonb_build_object('id',contact);
  end $$;
  create function mac_owned_identifiers(ws uuid) returns table(contact_id uuid,identifier text) language sql stable as $$
  select c.id, value from contacts c cross join lateral unnest(array[c.phone,c.email]) value where c.workspace_id=ws and c.user_id=auth.uid() and value is not null
  $$;
  create table mac_contact_identifiers(user_id uuid,contact_id uuid,identifier text,primary key(user_id,contact_id,identifier));
  create table campaigns(id uuid primary key,workspace_id uuid,name text);
  create table campaign_addresses(id uuid primary key,campaign_id uuid,address text,deleted_at timestamptz);
  create table address_statuses(campaign_address_id uuid,status text,last_visited_at timestamptz,visit_count int);
  create table card_property_engagement(address_id uuid,workspace_id uuid,campaign_id uuid,qualified_views int,last_engaged_at timestamptz);
  create table card_shares(id uuid,workspace_id uuid,contact_id uuid,rep_id uuid,address_id uuid,campaign_id uuid);
  create table card_events(id uuid,share_id uuid,event_type text,created_at timestamptz);
  create table qr_code_scans(id uuid,address_id uuid,scanned_at timestamptz);
  create table campaign_home_events(id uuid,campaign_address_id uuid,campaign_id uuid,user_id uuid,occurred_at timestamptz,created_at timestamptz,action_type text,applied_to_current bool);
  create table mac_contact_messages(id uuid,contact_id uuid,user_id uuid,sent_at timestamptz,imported_at timestamptz,direction text,body text,has_attachments bool,external_id text);
  create table crm_relationship_events(id uuid default gen_random_uuid(),user_id uuid,workspace_id uuid,contact_id uuid,request_id uuid,kind text,title text,body text,occurred_at timestamptz,unique(user_id,workspace_id,request_id,contact_id));
  create table crm_email_send_requests(id uuid,user_id uuid,workspace_id uuid,contact_id uuid,created_at timestamptz,status text,gmail_message_id text);
  create table dialer_calls(id uuid,user_id uuid,workspace_id uuid,contact_id uuid,created_at timestamptz,disposition text,status text,disposition_note text,duration_seconds int,twilio_call_sid text,direction text,answered_at timestamptz);
  create table dialer_sms_followups(id uuid,user_id uuid,workspace_id uuid,contact_id uuid,created_at timestamptz,sent_at timestamptz,status text,body text,twilio_message_sid text);
  create table dialer_inbound_messages(id uuid,workspace_id uuid,contact_id uuid,received_at timestamptz,body text,twilio_message_sid text);
  create table crm_person_tasks(id uuid,user_id uuid,workspace_id uuid,contact_id uuid,title text,completed_at timestamptz);
  create table field_sales_tasks(id uuid,user_id uuid,workspace_id uuid,contact_id uuid,title text,completed_at timestamptz,status text);
  create table calendar_events(id uuid default gen_random_uuid(),user_id uuid,workspace_id uuid,title text,start_at timestamptz,end_at timestamptz,event_type text,contact_id uuid,contact_name text,contact_address text,source_kind text,source_id uuid,location text,updated_at timestamptz,deleted_at timestamptz);
  create unique index source_unique on calendar_events(source_kind,source_id,event_type) where source_kind is not null and source_id is not null;
  create function mac_workspace_access(ws uuid) returns boolean language sql stable as $$select ws='${ws}' and auth.uid() in ('${user}','${other}')$$;
  create function can_view_campaign(cid uuid, actor uuid) returns boolean language sql stable as $$select cid='${campaign}' and actor='${user}'$$;
  insert into profiles values('${other}','Second Rep');
  insert into workspace_members values('${ws}','${user}'),('${ws}','${other}');
  insert into workspaces values('${ws}'),('${otherWs}');
  insert into contacts(id,workspace_id,user_id,full_name) values('${contact}','${ws}','${user}','Alex'),('${unrelated}','${ws}','${other}','Private');
  insert into campaigns values('${campaign}','${ws}','Durham'),('${id(11)}','${otherWs}','Private campaign');
  insert into campaign_addresses values('${home}','${campaign}','123 Example Street',null),('${hiddenHome}','${id(11)}','123 Private Street',null);
  insert into card_shares values('${card}','${ws}','${contact}','${user}','${home}','${campaign}');
  insert into card_events values('${id(12)}','${card}','qualified_open','2026-10-01'),('${id(13)}','${card}','composer_opened','2026-10-01');
  insert into qr_code_scans values('${id(14)}','${home}','2026-10-02');
  insert into mac_contact_messages values('${id(15)}','${contact}','${user}','2026-10-02',now(),'incoming','Hello',false,'provider-123');
  insert into address_statuses values('${home}','no_answer','2026-10-03',1);
`);
await db.exec(await readFile(new URL("../supabase/migrations/20261110030000_coco_contact_workspace.sql", import.meta.url), "utf8"));
await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}'`);
const create = async payload => (await db.query("select coco_create_contact_dedup($1,$2) as result", [ws, JSON.stringify(payload)])).rows[0].result;
const first = await create({ first_name: "Riley", last_name: "Morgan", email: "riley@example.test" });
const repeated = await create({ first_name: "Riley", last_name: "Morgan", email: "riley@example.test" });
assert.deepEqual(repeated, { id: first.id, existing: true });
assert.notEqual((await create({ first_name: "Riley", last_name: "Lee", email: "riley@example.test" })).id, first.id);
const matching = (await db.query("select coco_contact_call_identifiers($1,$2) as result", [ws, first.id])).rows[0].result;
assert.deepEqual(matching.identifiers, []);
await assert.rejects(db.query("select coco_contact_call_identifiers($1,$2)", [ws, unrelated]), /Contact unavailable/);
const read = async (category = "all", at = null, key = null) => (await db.query("select coco_contact_workspace($1,$2,$3,$4,$5) as result", [ws, contact, category, at, key])).rows[0].result;
const mutate = (action, body) => db.query("select coco_contact_workspace_command($1,$2,$3,$4)", [ws, contact, action, JSON.stringify(body)]);
await assert.rejects(mutate("link-property", { addressId: hiddenHome }), /Property unavailable/);
await assert.rejects(mutate("link-contact", { relatedId: unrelated, label: "Partner" }), /Related contact unavailable/);
assert.equal((await db.query("select coco_search_contact_properties($1,'123') as result", [ws])).rows[0].result.length, 1);
await mutate("link-property", { addressId: home });
await mutate("profile", { source: "Door knock", company: "Example Roofing", jobTitle: "Owner", contactType: "Customer", assignedRepId: other });
assert.equal((await read()).profile.company, "Example Roofing");
assert.equal((await read()).profile.assigned_rep_id, other);
const calls = [{ providerId: "a".repeat(64), direction: "outgoing", kind: "Phone", durationSeconds: 67, startedAt: new Date().toISOString() }];
await assert.rejects(mutate("import-calls", { calls }), /Call sync is off/);
await mutate("call-sync", { enabled: true });
await mutate("import-calls", { calls });
await mutate("import-calls", { calls });
await mutate("call-sync", { enabled: false });
assert.equal((await read("calls")).events.length, 1);
assert.equal((await read("calls")).events[0].provider_ref, calls[0].providerId);
const note = { requestId: id(16), body: "Follow up about the estimate" };
await mutate("note", note);
await mutate("note", note);
const notes = (await read("notes")).events;
assert.equal(notes.length, 1);
assert.equal(notes[0].actor_id, user);
await mutate("edit-note", { eventId: notes[0].edit_id, body: "Follow up Friday", previous: note.body });
await assert.rejects(mutate("edit-note", { eventId: notes[0].edit_id, body: "Stale edit", previous: note.body }), /Note changed/);
await mutate("appointment", { at: "2026-12-01T13:00:00Z", title: "Estimate", location: "At home" });
const workspace = await read();
assert.equal(workspace.properties[0].status, "no_answer");
assert.equal(workspace.events.filter(event => event.title === "Business card opened").length, 1);
assert.equal(workspace.events.filter(event => event.title === "Property QR scan").length, 1);
assert.equal(workspace.events.filter(event => event.title === "Message received").length, 1);
assert.equal(workspace.events.filter(event => event.title === "Appointment").length, 1);
await db.exec(`
  reset role;
  update mac_contact_messages set sent_at=now()-interval '60 days' where id='${id(15)}';
  insert into mac_contact_messages values
    ('${id(120)}','${contact}','${user}',now()-interval '6 hours',now(),'outgoing','Older text',false,'old-text'),
    ('${id(121)}','${contact}','${user}',now()-interval '5 hours',now(),'incoming','Incoming text',false,'reply-text'),
    ('${id(122)}','${contact}','${user}',now()-interval '4 hours',now(),'outgoing',repeat('Latest text ',40),false,'latest-text');
  insert into dialer_sms_followups values
    ('${id(123)}','${user}','${ws}','${contact}',now()-interval '1 hour',now()-interval '1 hour','failed','Failed text',null);
  insert into dialer_calls values
    ('${id(124)}','${user}','${ws}','${contact}',now(),'no_answer','no-answer',null,0,null,'outbound',null),
    ('${id(125)}','${user}','${ws}','${contact}',now(),null,'pending',null,null,null,'outbound',null);
  insert into crm_contact_gmail_history(id,user_id,workspace_id,contact_id,mailbox,recipient,provider_id,thread_id,message_id_header,direction,subject,snippet,sent_at) values
    ('${id(126)}','${user}','${ws}','${contact}','rep@example.test','contact@example.test','gmail-out','thread-one','<sent@example.test>','outgoing','Estimate','Older email',now()-interval '3 hours'),
    ('${id(127)}','${user}','${ws}','${contact}','rep@example.test','contact@example.test','gmail-in','thread-one','<reply@example.test>','incoming','Re: Estimate','Latest email',now()-interval '2 hours');
  insert into crm_email_send_requests(id,user_id,workspace_id,contact_id,created_at,status,gmail_message_id,gmail_thread_id,subject)
    values('${id(128)}','${user}','${ws}','${contact}',now()-interval '3 hours','sent','gmail-out','thread-one','Estimate');
  set role authenticated;
`);
const textPreview = (await read("messages")).events.find(event => event.thread_key === "apple-messages");
assert.equal(textPreview.thread_count, 4);
assert(textPreview.body.startsWith("Latest text") && textPreview.body.length <= 240);
const emailPreviews = (await read("emails")).events;
assert.equal(emailPreviews.length, 1);
assert.equal(emailPreviews[0].thread_count, 2);
assert.match(emailPreviews[0].body, /Latest email/);
assert.equal(emailPreviews[0].reply_id, id(127));
assert.equal((await read("emails", emailPreviews[0].at, emailPreviews[0].id)).events.length, 0);
const totals = (await read()).communication_stats;
assert.equal(totals.attempts, 5);
assert.equal(totals.outgoing_calls, 2);
assert.equal(totals.answered_calls, 1);
assert.equal(totals.average_gap_seconds, 3600);
assert.deepEqual(totals.counted_apple_calls, [calls[0].providerId]);
assert.equal((await read("calls")).communication_stats.attempts, 5, "stats independent of activity filter");
const mixed = (await read("communications")).events;
assert.deepEqual(new Set(mixed.map(event=>event.kind)), new Set(["calls","notes","emails","messages"]));
assert.equal(mixed.filter(event=>event.thread_key === "gmail:thread-one").length,1);
assert.deepEqual(mixed.map(event=>event.at), mixed.map(event=>event.at).toSorted().reverse());
for (let i = 30; i < 65; i++) await mutate("note", { requestId: id(i), body: `Note ${i}` });
const page = (await read("notes")).events;
assert.equal(page.length, 31);
const earlier = (await read("notes", page[29].at, page[29].id)).events;
assert.equal(earlier.length, 6);
assert(!earlier.some(e => page.slice(0, 30).some(p => p.id === e.id)));
await db.exec(`set request.jwt.claim.sub='${other}'`);
await assert.rejects(read(), /Contact unavailable/);
await assert.rejects(mutate("note", { requestId: id(99), body: "Unauthorized" }), /Contact unavailable/);
console.log("PASS: communication totals, thread previews, activity, appointments, pagination, deduplication and contact privacy.");
await db.close();
