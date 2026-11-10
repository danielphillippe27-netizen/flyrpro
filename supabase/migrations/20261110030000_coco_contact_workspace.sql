-- Existing contacts, communications and field events remain authoritative.
create table public.crm_contact_properties (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 address_id uuid not null references public.campaign_addresses(id) on delete cascade,
 primary key (workspace_id, contact_id, address_id)
);
create table public.crm_contact_links (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 related_id uuid not null references public.contacts(id) on delete cascade,
 label text not null check (length(trim(label)) between 1 and 80),
 primary key (workspace_id, contact_id, related_id),
 check (contact_id <> related_id)
);
create table public.crm_contact_call_settings (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 enabled boolean not null,
 primary key(user_id,workspace_id,contact_id)
);
create table public.crm_contact_apple_calls (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 provider_id text not null check(provider_id ~ '^[0-9a-f]{64}$'),
 direction text not null check(direction in ('incoming','outgoing')),
 call_kind text not null check(call_kind in ('Phone','FaceTime audio','FaceTime video')),
 duration_seconds integer not null check(duration_seconds between 0 and 604800),
 started_at timestamptz not null,
 unique(user_id,workspace_id,provider_id)
);
create index crm_contact_apple_calls_history on public.crm_contact_apple_calls(user_id,workspace_id,contact_id,started_at desc);
alter table public.crm_contact_call_settings enable row level security;
alter table public.crm_contact_apple_calls enable row level security;
revoke all on public.crm_contact_call_settings,public.crm_contact_apple_calls from public,anon,authenticated;
alter table public.crm_contact_properties enable row level security;
alter table public.crm_contact_links enable row level security;
revoke all on public.crm_contact_properties, public.crm_contact_links from public, anon, authenticated;

create table public.crm_contact_gmail_history (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 mailbox text not null,
 recipient text not null,
 provider_id text not null,
 thread_id text not null,
 message_id_header text,
 direction text not null check(direction in ('incoming','outgoing')),
 subject text not null,
 snippet text not null,
 sent_at timestamptz not null,
 unique(user_id,workspace_id,mailbox,provider_id)
);
create index crm_contact_gmail_timeline on public.crm_contact_gmail_history(user_id,workspace_id,contact_id,sent_at desc);
alter table public.crm_contact_gmail_history enable row level security;
revoke all on public.crm_contact_gmail_history from public,anon,authenticated;
grant select,insert on public.crm_contact_gmail_history to service_role;

alter table public.crm_contact_profiles add column if not exists company text,
 add column if not exists job_title text, add column if not exists contact_type text,
 add column if not exists assigned_rep_id uuid references auth.users(id) on delete set null;
create table public.crm_contact_change_history (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 action text not null,
 changed_at timestamptz not null default now()
);
create index crm_contact_change_history_contact on public.crm_contact_change_history(user_id,workspace_id,contact_id,changed_at desc);
alter table public.crm_contact_change_history enable row level security;
revoke all on public.crm_contact_change_history from public,anon,authenticated;
create function public.coco_audit_contact_stage() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.stage is distinct from old.stage then
   insert into public.crm_contact_change_history(user_id,workspace_id,contact_id,action)
   values(new.user_id,new.workspace_id,new.contact_id,'Lead stage changed to '||new.stage);
 end if;
 return new;
end $$;
revoke all on function public.coco_audit_contact_stage() from public,anon,authenticated;
create trigger coco_audit_contact_stage after update of stage on public.crm_contact_profiles for each row execute function public.coco_audit_contact_stage();
alter table public.crm_relationship_events add column if not exists address_id uuid references public.campaign_addresses(id) on delete set null;
alter table public.crm_email_send_requests add column if not exists subject text, add column if not exists gmail_thread_id text;

create function public.coco_contact_workspace(ws uuid, target uuid, category text default 'all', before_at timestamptz default null, before_key text default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare person public.contacts; actor uuid := auth.uid(); response jsonb; since timestamptz := now()-interval '30 days';
begin
 if actor is null or not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select * into person from public.contacts where id=target and workspace_id=ws and user_id=actor;
 if not found then raise exception 'Contact unavailable' using errcode='42501'; end if;

 with linked as (
   select address_id from public.crm_contact_properties where workspace_id=ws and contact_id=target
   union select person.address_id where person.address_id is not null
 ), properties as (
   select a.id, a.campaign_id, a.address, c.name campaign, coalesce(a.id=person.address_id,false) as primary_link,
          s.status, s.last_visited_at, s.visit_count, e.qualified_views card_opens, e.last_engaged_at, assigned.names assigned_reps
   from linked l join public.campaign_addresses a on a.id=l.address_id and a.deleted_at is null
   join public.campaigns c on c.id=a.campaign_id and c.workspace_id=ws and public.can_view_campaign(c.id,actor)
   left join public.address_statuses s on s.campaign_address_id=a.id
   left join public.card_property_engagement e on e.address_id=a.id and e.workspace_id=ws and e.campaign_id=c.id
   left join lateral (
     select string_agg(distinct coalesce(nullif(trim(rep.full_name),''),'Assigned representative'), ', ') names
     from public.campaign_assignment_homes h join public.campaign_assignments ca on ca.id=h.assignment_id
     left join public.profiles rep on rep.id=ca.assigned_to_user_id
     where h.campaign_address_id=a.id and ca.campaign_id=c.id and ca.workspace_id=ws and ca.status not in ('cancelled','completed')
   ) assigned on true
 ), shares as (
   select s.* from public.card_shares s where s.contact_id=target and s.workspace_id=ws and s.rep_id=actor
 ), recorded_texts as (
   select m.sent_at at,m.direction='outgoing' outgoing
   from public.mac_contact_messages m where m.contact_id=target and m.user_id=actor and m.sent_at<=now()
   union all
   select m.sent_at,true from public.dialer_sms_followups m
   where m.contact_id=target and m.workspace_id=ws and m.user_id=actor and m.status in ('sent','delivered') and m.sent_at<=now()
   union all
   select m.received_at,false from public.dialer_inbound_messages m
   where m.contact_id=target and m.workspace_id=ws and m.received_at<=now()
 ), text_stats as (
   select max(at) last_message_at,count(*) filter(where at>=since and outgoing) attempts,
     extract(epoch from (max(at) filter(where at>=since) - min(at) filter(where at>=since))) /
       nullif(count(*) filter(where at>=since)-1,0) as average_gap_seconds
   from recorded_texts
 ), recorded_calls as (
   select c.provider_id,c.duration_seconds>0 answered from public.crm_contact_apple_calls c
   where c.contact_id=target and c.workspace_id=ws and c.user_id=actor and c.direction='outgoing'
     and c.started_at between since and now()
   union all
   select null,c.answered_at is not null or c.status in ('answered','in-progress') or coalesce(c.duration_seconds,0)>0
   from public.dialer_calls c where c.contact_id=target and c.workspace_id=ws and c.user_id=actor
     and c.direction='outbound' and c.created_at between since and now()
     and (c.answered_at is not null or c.status in ('completed','answered','in-progress','busy','no-answer'))
 ), call_stats as (
   select count(*) attempts,count(*) filter(where answered) answered,
     coalesce(jsonb_agg(provider_id) filter(where provider_id is not null),'[]'::jsonb) apple_ids
   from recorded_calls
 ), email_stats as (
   select
     (select count(*) from public.crm_contact_gmail_history m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor
       and m.direction='outgoing' and m.sent_at between since and now()) +
     (select count(*) from public.crm_email_send_requests e where e.contact_id=target and e.workspace_id=ws and e.user_id=actor
       and e.status='sent' and e.created_at between since and now()
       and not exists(select 1 from public.crm_contact_gmail_history m where m.user_id=actor and m.workspace_id=ws and m.contact_id=target and m.provider_id=e.gmail_message_id)) attempts
 ), events as (
   select 'message:'||m.id id, 'messages' kind, coalesce(m.sent_at,m.imported_at) at,
     case when m.direction='outgoing' then 'Message sent' else 'Message received' end title,
     coalesce(m.body,case when m.has_attachments then 'Attachment' else 'Message content unavailable' end) body,
     m.user_id actor_id, null::uuid property_id, null::uuid campaign_id, null::uuid edit_id, m.external_id provider_ref, null::uuid reply_id, null::text subject, null::text thread_ref
   from public.mac_contact_messages m where m.contact_id=target and m.user_id=actor
   union all
   select 'outreach:'||e.id, case e.kind when 'text' then 'messages' when 'email' then 'emails' when 'call' then 'calls' when 'note' then 'notes' else 'field' end,
     e.occurred_at, e.title,e.body,e.user_id,p.id,p.campaign_id,case when e.kind='note' then e.id end,null,null,null,null
   from public.crm_relationship_events e left join properties p on p.id=e.address_id where e.contact_id=target and e.workspace_id=ws and e.user_id=actor
   union all
   select 'dialer-call:'||c.id,'calls',c.created_at,'Dialer call · '||replace(coalesce(c.disposition,c.status),'_',' '),
     concat_ws(' · ',nullif(c.disposition_note,''),case when c.duration_seconds is not null then (c.duration_seconds/60)::text||'m '||(c.duration_seconds%60)::text||'s' end),
     c.user_id,null,null,null,c.twilio_call_sid,null,null,null
   from public.dialer_calls c where c.contact_id=target and c.workspace_id=ws and c.user_id=actor
   union all
   select 'dialer-sms:'||m.id,'messages',coalesce(m.sent_at,m.created_at),'Dialer text · '||m.status,
     m.body,m.user_id,null,null,null,m.twilio_message_sid,null,null,null
   from public.dialer_sms_followups m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor
   union all
   select 'dialer-inbound:'||m.id,'messages',m.received_at,'Dialer text received',
     m.body,null,null,null,null,m.twilio_message_sid,null,null,null
   from public.dialer_inbound_messages m where m.contact_id=target and m.workspace_id=ws
   union all
   select 'apple-call:'||c.id,'calls',c.started_at,
     initcap(c.direction)||' '||c.call_kind||case when c.duration_seconds>0 then ' · Connected' else ' · No duration recorded' end,
     case when c.duration_seconds>0 then (c.duration_seconds/60)::text||'m '||(c.duration_seconds%60)::text||'s · Apple call history' else 'Apple call history' end,
     c.user_id,null,null,null,c.provider_id,null,null,null
   from public.crm_contact_apple_calls c where c.contact_id=target and c.workspace_id=ws and c.user_id=actor
   union all
   select 'gmail:'||m.id,'emails',m.sent_at,case when m.direction='incoming' then 'Email received' else 'Email sent' end,
     concat_ws(E'\n',nullif(m.subject,''),nullif(m.snippet,'')),m.user_id,null,null,null,m.provider_id,case when m.message_id_header is not null then m.id end,m.subject,m.thread_id
   from public.crm_contact_gmail_history m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor
   union all
   select 'email:'||e.id,'emails',e.created_at,'Email sent',coalesce(e.subject,''),e.user_id,null,null,null,e.gmail_message_id,null,e.subject,e.gmail_thread_id
   from public.crm_email_send_requests e where e.contact_id=target and e.workspace_id=ws and e.user_id=actor and e.status='sent'
     and not exists(select 1 from public.crm_contact_gmail_history m where m.user_id=actor and m.workspace_id=ws and m.contact_id=target and m.provider_id=e.gmail_message_id)
   union all
   select 'card:'||e.id,'field',e.created_at,case when e.event_type='composer_sent' then 'Business card sent' else 'Business card opened' end,
     p.address,s.rep_id,p.id,p.campaign_id,null,null,null,null,null
   from shares s join public.card_events e on e.share_id=s.id and e.event_type in ('composer_sent','qualified_open')
   left join properties p on p.id=s.address_id and p.campaign_id=s.campaign_id
   union all
   select 'visit:'||e.id,'field',coalesce(e.occurred_at,e.created_at),'Property status · '||replace(e.action_type,'_',' '),
     p.address,e.user_id,p.id,p.campaign_id,null,null,null,null,null
   from properties p join public.campaign_home_events e on e.campaign_address_id=p.id and e.campaign_id=p.campaign_id and e.applied_to_current
   union all
   select 'qr:'||e.id,'field',e.scanned_at,'Property QR scan',p.address,null,p.id,p.campaign_id,null,null,null,null,null
   from properties p join public.qr_code_scans e on e.address_id=p.id
   union all
   select 'appointment:'||e.id,'field',e.start_at,'Appointment',e.title,e.user_id,null,null,null,null,null,null,null
   from public.calendar_events e where e.contact_id=target and e.workspace_id=ws and e.user_id=actor and e.event_type='appointment' and e.deleted_at is null
   union all
   select 'task:'||t.id,'field',t.completed_at,'Follow-up completed',t.title,t.user_id,null,null,null,null,null,null,null
   from public.crm_person_tasks t where t.contact_id=target and t.workspace_id=ws and t.user_id=actor and t.completed_at is not null
   union all
   select 'field-task:'||t.id,'field',t.completed_at,'Follow-up completed',t.title,t.user_id,null,null,null,null,null,null,null
   from public.field_sales_tasks t where t.contact_id=target and t.workspace_id=ws and t.user_id=actor and t.completed_at is not null and t.status='done'
   union all
   select 'change:'||e.id,'field',e.changed_at,e.action,null,e.user_id,null,null,null,null,null,null,null
   from public.crm_contact_change_history e where e.contact_id=target and e.workspace_id=ws and e.user_id=actor
   union all
   select 'created:'||target,'field',person.created_at,'Contact created',person.source,actor,null,null,null,null,null,null,null
 ), keyed as (
   select e.*,case
     when id like 'message:%' then 'apple-messages'
     when id like 'dialer-sms:%' or id like 'dialer-inbound:%' then 'dialer-texts'
     when kind='emails' and thread_ref is not null then 'gmail:'||thread_ref
     else id end thread_key
   from events e where (category='all' or kind=category or category='communications' and kind in ('messages','emails','calls','notes')) and at is not null
 ), ranked as (
   select k.*,row_number() over(partition by thread_key order by at desc,id desc) thread_rank,
     count(*) over(partition by thread_key) thread_count,
     first_value(reply_id) over(partition by thread_key order by (reply_id is not null) desc,at desc,id desc) thread_reply_id
   from keyed k
 ), page as (
   select id,kind,at,title,case when kind in ('messages','emails') then left(body,240) else body end body,
     actor_id,property_id,campaign_id,edit_id,provider_ref,thread_reply_id reply_id,subject,thread_ref,thread_key,thread_count
   from ranked where thread_rank=1 and (before_at is null or (at,id)<(before_at,before_key)) order by at desc,id desc limit 31
 )
 select jsonb_build_object(
   'profile',jsonb_build_object('source',person.source,
      'company',(select p.company from public.crm_contact_profiles p where p.contact_id=target and p.user_id=actor and p.workspace_id=ws),
      'job_title',(select p.job_title from public.crm_contact_profiles p where p.contact_id=target and p.user_id=actor and p.workspace_id=ws),
      'contact_type',(select p.contact_type from public.crm_contact_profiles p where p.contact_id=target and p.user_id=actor and p.workspace_id=ws),
      'assigned_rep_id',(select p.assigned_rep_id from public.crm_contact_profiles p
        join public.workspace_members m on m.user_id=p.assigned_rep_id and m.workspace_id=ws
        where p.contact_id=target and p.user_id=actor and p.workspace_id=ws),
      'tags',person.tags,'do_not_contact',person.do_not_contact,
      'call_sync_enabled',coalesce((select enabled from public.crm_contact_call_settings s where s.user_id=actor and s.workspace_id=ws and s.contact_id=target),false),
      'appointment_at',person.appointment_at,'appointment_title',person.appointment_title,'appointment_location',person.appointment_location),
   'assignees',coalesce((select jsonb_agg(to_jsonb(m) order by m.name,m.id) from (
     select distinct w.user_id id, coalesce(nullif(trim(p.full_name),''),'Workspace member') name
     from public.workspace_members w left join public.profiles p on p.id=w.user_id where w.workspace_id=ws and w.user_id<>actor
   ) m),'[]'),
   'properties',coalesce((select jsonb_agg(to_jsonb(p) order by p.primary_link desc,p.address,p.id) from properties p),'[]'),
   'relationships',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name,'label',l.label) order by c.full_name,c.id)
     from public.crm_contact_links l join public.contacts c on c.id=l.related_id and c.workspace_id=ws and c.user_id=actor
     where l.workspace_id=ws and l.contact_id=target),'[]'),
   'communication_stats',(select jsonb_build_object(
     'window_start',since,'as_of',now(),'attempts',t.attempts+c.attempts+e.attempts,
     'outgoing_calls',c.attempts,'answered_calls',c.answered,'average_gap_seconds',t.average_gap_seconds,
     'last_message_at',t.last_message_at,'counted_apple_calls',c.apple_ids
   ) from text_stats t cross join call_stats c cross join email_stats e),
   'activity_kinds',to_jsonb(array_remove(array[
     case when exists(select 1 from public.mac_contact_messages m where m.contact_id=target and m.user_id=actor)
       or exists(select 1 from public.dialer_inbound_messages m where m.contact_id=target and m.workspace_id=ws)
       or exists(select 1 from public.dialer_sms_followups m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor)
       then 'messages' end,
     case when exists(select 1 from public.crm_contact_gmail_history m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor)
       or exists(select 1 from public.crm_email_send_requests e where e.contact_id=target and e.workspace_id=ws and e.user_id=actor and e.status='sent')
       then 'emails' end,
     case when exists(select 1 from public.crm_contact_apple_calls m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor)
       or exists(select 1 from public.dialer_calls m where m.contact_id=target and m.workspace_id=ws and m.user_id=actor)
       then 'calls' end
   ]::text[],null)),
   'events',coalesce((select jsonb_agg(to_jsonb(p) order by p.at desc,p.id desc) from page p),'[]')
 ) into response;
 return response;
end $$;

-- Mutations are scoped to the same owner and workspace as existing Coco commands.
create function public.coco_contact_workspace_command(ws uuid,target uuid,command text,payload jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); other uuid; txt text; req uuid; person public.contacts; scheduled timestamptz;
begin
 if actor is null or not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 perform 1 from public.contacts where id=target and workspace_id=ws and user_id=actor for update;
 if not found then raise exception 'Contact unavailable' using errcode='42501'; end if;
 if command in ('note','call') then
   txt:=trim(payload->>'body'); req:=(payload->>'requestId')::uuid;
   if req is null or txt is null or length(txt)>10000 or (command='note' and txt='') then raise exception 'Invalid activity'; end if;
   if command='call' and coalesce(payload->>'outcome','') not in ('Reached','Left voicemail','No answer','Wrong number','Other') then raise exception 'Choose a call outcome'; end if;
   other:=case when command='note' then (payload->>'addressId')::uuid end;
   if other is not null and not exists (
     select 1 from public.campaign_addresses a join public.campaigns c on c.id=a.campaign_id
     where a.id=other and a.deleted_at is null and c.workspace_id=ws and public.can_view_campaign(c.id,actor)
       and (exists(select 1 from public.crm_contact_properties where workspace_id=ws and contact_id=target and address_id=other)
         or exists(select 1 from public.contacts where id=target and address_id=other))
   ) then raise exception 'Property unavailable' using errcode='42501'; end if;
   insert into public.crm_relationship_events(user_id,workspace_id,contact_id,request_id,kind,title,body,occurred_at,address_id)
   values(actor,ws,target,req,command,case when command='note' then 'Note added' else 'Call logged · '||(payload->>'outcome') end,txt,now(),other)
   on conflict(user_id,workspace_id,request_id,contact_id) do nothing;
 elsif command='profile' then
   other:=(payload->>'assignedRepId')::uuid;
   if other is not null and not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=other) then
     raise exception 'Representative unavailable' using errcode='42501';
   end if;
   update public.contacts set source=nullif(left(trim(payload->>'source'),120),''),updated_at=now()
     where id=target and user_id=actor and workspace_id=ws;
   insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,stage,company,job_title,contact_type,assigned_rep_id)
   select actor,ws,target,case when c.status in ('warm','hot') then 'Warm' else 'Lead' end,nullif(left(trim(payload->>'company'),160),''),nullif(left(trim(payload->>'jobTitle'),120),''),nullif(left(trim(payload->>'contactType'),80),''),other
   from public.contacts c where c.id=target and c.user_id=actor and c.workspace_id=ws
   on conflict(user_id,contact_id) do update set company=excluded.company,job_title=excluded.job_title,contact_type=excluded.contact_type,assigned_rep_id=excluded.assigned_rep_id
   where crm_contact_profiles.workspace_id=ws;
   insert into public.crm_contact_change_history(user_id,workspace_id,contact_id,action) values(actor,ws,target,'Contact profile updated');
 elsif command in ('add-identifier','remove-identifier') then
   txt:=public.mac_contact_identifier(payload->>'identifier');
   if txt is null then raise exception 'Enter a valid phone number or email'; end if;
   if command='add-identifier' then
     insert into public.mac_contact_identifiers values(actor,target,txt) on conflict do nothing;
   else
     delete from public.mac_contact_identifiers where user_id=actor and contact_id=target and identifier=txt;
   end if;
 elsif command='call-sync' then
   if jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'Choose a setting'; end if;
   insert into public.crm_contact_call_settings values(actor,ws,target,(payload->>'enabled')::boolean)
   on conflict(user_id,workspace_id,contact_id) do update set enabled=excluded.enabled;
 elsif command='import-calls' then
   if not exists(select 1 from public.crm_contact_call_settings where user_id=actor and workspace_id=ws and contact_id=target and enabled)
     then raise exception 'Call sync is off' using errcode='42501'; end if;
   if jsonb_typeof(payload->'calls') is distinct from 'array' or jsonb_array_length(payload->'calls')>10 then raise exception 'Invalid calls'; end if;
   insert into public.crm_contact_apple_calls(user_id,workspace_id,contact_id,provider_id,direction,call_kind,duration_seconds,started_at)
   select actor,ws,target,c->>'providerId',c->>'direction',c->>'kind',(c->>'durationSeconds')::int,(c->>'startedAt')::timestamptz
   from jsonb_array_elements(payload->'calls') c
   where (c->>'startedAt')::timestamptz between now()-interval '91 days' and now()+interval '5 minutes'
   on conflict(user_id,workspace_id,provider_id) do nothing;
 elsif command='edit-note' then
   txt:=trim(payload->>'body');
   if coalesce(length(txt),0) not between 1 and 10000 then raise exception 'Enter a note'; end if;
   update public.crm_relationship_events set body=txt where id=(payload->>'eventId')::uuid and user_id=actor and workspace_id=ws and contact_id=target and kind='note' and body=payload->>'previous';
   if not found then raise exception 'Note changed or unavailable' using errcode='40001'; end if;
 elsif command in ('link-property','unlink-property') then
   other:=(payload->>'addressId')::uuid;
   if command='unlink-property' then
     delete from public.crm_contact_properties where workspace_id=ws and contact_id=target and address_id=other;
   else
     if not exists (select 1 from public.campaign_addresses a join public.campaigns c on c.id=a.campaign_id
       where a.id=other and a.deleted_at is null and c.workspace_id=ws and public.can_view_campaign(c.id,actor)) then
       raise exception 'Property unavailable' using errcode='42501';
     end if;
     insert into public.crm_contact_properties values(ws,target,other) on conflict do nothing;
   end if;
 elsif command in ('link-contact','unlink-contact') then
   other:=(payload->>'relatedId')::uuid;
   if other=target or not exists (select 1 from public.contacts where id=other and workspace_id=ws and user_id=actor) then
     raise exception 'Related contact unavailable' using errcode='42501';
   end if;
   if command='unlink-contact' then
     delete from public.crm_contact_links where workspace_id=ws and contact_id=target and related_id=other;
   else
     insert into public.crm_contact_links values(ws,target,other,trim(payload->>'label'))
       on conflict(workspace_id,contact_id,related_id) do update set label=excluded.label;
   end if;
 elsif command='appointment' then
   scheduled:=(payload->>'at')::timestamptz;
   update public.contacts set appointment_at=scheduled, appointment_title=nullif(left(payload->>'title',200),''),
     appointment_location=nullif(left(payload->>'location',500),''),updated_at=now() where id=target and user_id=actor and workspace_id=ws returning * into person;
   if scheduled is null then
     update public.calendar_events set deleted_at=now(),updated_at=now()
       where user_id=actor and workspace_id=ws and source_kind='contact_appointment' and source_id=target and event_type='appointment';
   else
     insert into public.calendar_events(user_id,workspace_id,title,start_at,end_at,event_type,contact_id,contact_name,contact_address,source_kind,source_id,location)
     values(actor,ws,coalesce(person.appointment_title,'Appointment: '||person.full_name,'Appointment'),scheduled,scheduled+interval '1 hour',
       'appointment',target,person.full_name,person.address,'contact_appointment',target,coalesce(person.appointment_location,person.address))
     on conflict(source_kind,source_id,event_type) where source_kind is not null and source_id is not null
     do update set title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,location=excluded.location,updated_at=now(),deleted_at=null
     where calendar_events.user_id=actor and calendar_events.workspace_id=ws;
     if not found then raise exception 'Appointment unavailable' using errcode='42501'; end if;
   end if;
 else raise exception 'Unsupported contact action';
 end if;
end $$;

create function public.coco_search_contact_properties(ws uuid, query text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(m) order by m.address,m.id),'[]')
 from (select a.id,a.address,c.name campaign from public.campaign_addresses a join public.campaigns c on c.id=a.campaign_id
   where public.mac_workspace_access(ws) and c.workspace_id=ws and public.can_view_campaign(c.id,auth.uid()) and a.deleted_at is null
     and length(trim(query)) between 3 and 100 and strpos(lower(a.address),lower(trim(query)))>0
   order by a.address,a.id limit 25) m
$$;

revoke all on function public.coco_contact_workspace(uuid,uuid,text,timestamptz,text),
 public.coco_contact_workspace_command(uuid,uuid,text,jsonb),public.coco_search_contact_properties(uuid,text) from public,anon;
grant execute on function public.coco_contact_workspace(uuid,uuid,text,timestamptz,text),
 public.coco_contact_workspace_command(uuid,uuid,text,jsonb),public.coco_search_contact_properties(uuid,text) to authenticated;

create index if not exists crm_email_contact_history on public.crm_email_send_requests(user_id,workspace_id,contact_id,created_at desc) where status='sent';

-- A repeated manual create with the same name and matched contact method opens the existing record.
create function public.coco_create_contact_dedup(ws uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); person_name text; contact_phone text; contact_email text; matches uuid[];
begin
 if actor is null or not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 person_name:=lower(trim(trim(payload->>'first_name')||' '||trim(coalesce(payload->>'last_name',''))));
 contact_phone:=public.mac_contact_identifier(payload->>'phone');
 contact_email:=public.mac_contact_identifier(payload->>'email');
 if contact_phone is not null or contact_email is not null then
   perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||ws::text||':'||person_name,0));
   select array_agg(distinct c.id) into matches from public.contacts c
   join public.mac_owned_identifiers(ws) i on i.contact_id=c.id and i.identifier in (contact_phone,contact_email)
   where c.workspace_id=ws and c.user_id=actor and lower(trim(c.full_name))=person_name;
   if cardinality(matches)>1 then raise exception 'Multiple contacts match' using errcode='23505'; end if;
   if cardinality(matches)=1 then return jsonb_build_object('id',matches[1],'existing',true); end if;
 end if;
 return public.coco_crm_command(ws,'create',payload);
end $$;
revoke all on function public.coco_create_contact_dedup(uuid,jsonb) from public,anon;
grant execute on function public.coco_create_contact_dedup(uuid,jsonb) to authenticated;

-- Resolve and disambiguate identifiers in one database snapshot before a native history read.
create function public.coco_contact_call_identifiers(ws uuid,target uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not public.mac_workspace_access(ws)
   or not exists(select 1 from public.contacts where id=target and workspace_id=ws and user_id=actor)
 then raise exception 'Contact unavailable' using errcode='42501'; end if;
 return jsonb_build_object('id',target,'identifiers',coalesce((
   with handles as (select * from public.mac_owned_identifiers(ws)), own as (
     select h.identifier from handles h where h.contact_id=target and not exists (
       select 1 from handles other where other.contact_id<>target and other.identifier=h.identifier)
     order by h.identifier limit 100
   )
   select jsonb_agg(own.identifier order by own.identifier) from own
 ),'[]'::jsonb));
end $$;
revoke all on function public.coco_contact_call_identifiers(uuid,uuid) from public,anon;
grant execute on function public.coco_contact_call_identifiers(uuid,uuid) to authenticated;
