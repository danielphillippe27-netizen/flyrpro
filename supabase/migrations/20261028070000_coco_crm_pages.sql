-- KimiCoco contact/inbox parity over existing WolfGrid contacts. Personal data stays owner-scoped.
create table public.crm_contact_profiles(
 user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,first_name text,last_name text,name_snapshot text,
 labels text[] not null default '{}',stage text not null default 'Lead' check(stage in('Lead','Warm','Active Client','Past Client')),
 primary key(user_id,contact_id),check(labels <@ array['Family','Friend','Client','Lead','Active Client']::text[])
);
create table public.crm_person_tasks(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,contact_id uuid references public.contacts(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 200),notes text,due_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),version integer not null default 1
);
create table public.crm_person_deals(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,source_key text not null,property_address text,side text check(side in('buyer','seller')),price numeric check(price>=0),closing_date date,
 evidence_subject text not null default '',evidence_date timestamptz,evidence jsonb not null default '{}',unique(user_id,workspace_id,source_key)
);
create table public.crm_conversation_reads(user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,contact_id uuid not null references public.contacts(id) on delete cascade,last_read_at timestamptz not null default now(),primary key(user_id,contact_id));
alter table public.crm_contact_profiles enable row level security;
alter table public.crm_person_tasks enable row level security;
alter table public.crm_person_deals enable row level security;
alter table public.crm_conversation_reads enable row level security;
create policy own_profiles on public.crm_contact_profiles for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
create policy own_tasks on public.crm_person_tasks for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
create policy own_deals on public.crm_person_deals for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
create policy own_reads on public.crm_conversation_reads for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.crm_contact_profiles,public.crm_person_tasks,public.crm_person_deals,public.crm_conversation_reads to authenticated;
revoke insert,update,delete on public.crm_contact_profiles,public.crm_person_tasks,public.crm_person_deals,public.crm_conversation_reads from authenticated,anon;
create index crm_person_tasks_owner on public.crm_person_tasks(user_id,workspace_id,due_at);
create function public.coco_crm_snapshot(ws uuid,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare clients jsonb;conversations jsonb;tasks jsonb;field_tasks jsonb:='[]';deals jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if page_offset<0 or page_offset>1000000 then raise exception 'Invalid page';end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into clients from(
 select c.id,c.workspace_id,coalesce(case when p.name_snapshot=c.full_name then p.first_name end,split_part(trim(c.full_name),' ',1)) first_name,
 coalesce(case when p.name_snapshot=c.full_name then p.last_name end,case when position(' ' in trim(c.full_name))>0 then substr(trim(c.full_name),position(' ' in trim(c.full_name))+1) else '' end) last_name,
 c.phone,c.email,c.address,c.notes,c.appointment_at,to_jsonb(c)->>'last_contacted' last_contacted_at,c.follow_up_at next_follow_up_at,
 coalesce(p.labels,'{}') contact_labels,coalesce(p.stage,case when c.status in('warm','hot') then 'Warm' else 'Lead' end) stage,
 coalesce(to_jsonb(c)->>'created_at',c.updated_at::text) created_at,c.updated_at,
 coalesce((select jsonb_agg(identifier) from public.mac_owned_identifiers(ws) i where i.contact_id=c.id),'[]') identifiers
 from public.contacts c left join public.crm_contact_profiles p on p.contact_id=c.id and p.user_id=auth.uid() and p.workspace_id=ws
 where c.user_id=auth.uid() and c.workspace_id=ws order by c.id offset page_offset limit 500) r;
 select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','client_id',c->>'id','channel',coalesce(m.service,'sms'),'last_message_at',m.sent_at,'last_read_at',r.last_read_at,'preview',m.body,'message_id',m.id)),'[]') into conversations
 from jsonb_array_elements(clients) c join lateral(select * from public.mac_contact_messages m where m.contact_id=(c->>'id')::uuid and m.user_id=auth.uid() order by m.sent_at desc nulls last,m.id desc limit 1) m on true
 left join public.crm_conversation_reads r on r.contact_id=(c->>'id')::uuid and r.user_id=auth.uid() and r.workspace_id=ws;
 if page_offset=0 then
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into tasks from(select id,workspace_id,contact_id client_id,title,notes,due_at,completed_at,created_at,version,'crm' source from public.crm_person_tasks where user_id=auth.uid() and workspace_id=ws order by created_at,id) t;
 if to_regclass('public.field_sales_tasks') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]'') from(select t.id,t.workspace_id,t.contact_id client_id,t.title,null::text notes,t.due_at,t.completed_at,t.created_at,t.version,''field'' source from public.field_sales_tasks t join public.contacts c on c.id=t.contact_id where t.user_id=$1 and t.workspace_id=$2 and c.user_id=$1 and c.workspace_id=$2 and t.status<>''cancelled'') t' into field_tasks using auth.uid(),ws;
 end if;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]') into deals from(select id,contact_id client_id,property_address,side,price,closing_date,evidence_subject,evidence_date from public.crm_person_deals where user_id=auth.uid() and workspace_id=ws) d;
 end if;
 return jsonb_build_object('clients',clients,'conversations',conversations,'tasks',coalesce(tasks,'[]')||field_tasks,'deals',coalesce(deals,'[]'),'messages','[]'::jsonb);
end $$;
create function public.coco_crm_command(ws uuid,command text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;ids uuid[];row public.contacts;item public.contacts;labels text[];chosen text;result jsonb;task public.crm_person_tasks;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if command='create' then
 if coalesce(length(trim(payload->>'first_name')),0) not between 1 and 100 then raise exception 'Enter a first name';end if;
 insert into public.contacts(id,user_id,workspace_id,full_name,phone,email,address,notes,status)
 values(gen_random_uuid(),auth.uid(),ws,trim((payload->>'first_name')||' '||coalesce(payload->>'last_name','')),nullif(trim(payload->>'phone'),''),nullif(trim(payload->>'email'),''),'',null,'new') returning * into row;
 select coalesce(array_agg(value),'{}') into labels from jsonb_array_elements_text(coalesce(payload->'contact_labels','[]'));
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,first_name,last_name,name_snapshot,labels) values(auth.uid(),ws,row.id,trim(payload->>'first_name'),trim(coalesce(payload->>'last_name','')),row.full_name,labels);
 return to_jsonb(row);
 end if;
 if command in('bulk-label','bulk-stage','delete') then
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(payload->'ids');
 if cardinality(ids) is null or cardinality(ids) not between 1 and 500 then raise exception 'Select 1 to 500 contacts';end if;
 if exists(select 1 from unnest(ids) requested(contact_id) where not exists(select 1 from public.contacts c where c.id=requested.contact_id and c.user_id=auth.uid() and c.workspace_id=ws)) then raise exception 'Contact unavailable' using errcode='42501';end if;
 perform 1 from public.contacts c where c.id=any(ids) order by c.id for update;
 if command='delete' then
 if payload->>'confirmation' is distinct from 'DELETE' then raise exception 'Confirm deletion';end if;
 -- Retain personal tasks detached from a deleted contact. Unrelated financial/field references can veto deletion transactionally.
 if to_regclass('public.field_sales_tasks') is not null then
 execute 'insert into public.crm_person_tasks(id,user_id,workspace_id,contact_id,title,due_at,completed_at,created_at) select id,user_id,workspace_id,null,title,due_at,completed_at,created_at from public.field_sales_tasks where user_id=$1 and workspace_id=$2 and contact_id=any($3) on conflict(id) do nothing' using auth.uid(),ws,ids;
 execute 'delete from public.field_sales_tasks where user_id=$1 and workspace_id=$2 and contact_id=any($3)' using auth.uid(),ws,ids;
 end if;
 delete from public.contacts where id=any(ids) and user_id=auth.uid() and workspace_id=ws;
 return jsonb_build_object('deleted',ids);
 end if;
 chosen:=payload->>'value';
 if command='bulk-stage' and chosen not in('Lead','Warm','Active Client','Past Client') then raise exception 'Invalid stage';end if;
 if command='bulk-label' and chosen not in('Family','Friend','Client','Lead','Active Client') then raise exception 'Invalid label';end if;
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id) select auth.uid(),ws,id from unnest(ids) id on conflict do nothing;
 if command='bulk-stage' then update public.crm_contact_profiles set stage=chosen where user_id=auth.uid() and workspace_id=ws and contact_id=any(ids);
 else update public.crm_contact_profiles set labels=array(select distinct unnest(crm_contact_profiles.labels||array[chosen])) where user_id=auth.uid() and workspace_id=ws and contact_id=any(ids);end if;
 return '{}';
 end if;
 if command='task-create' then
 target:=nullif(payload->>'client_id','')::uuid;
 if target is not null and not exists(select 1 from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws) then raise exception 'Contact unavailable' using errcode='42501';end if;
 insert into public.crm_person_tasks(user_id,workspace_id,contact_id,title,due_at) values(auth.uid(),ws,target,trim(payload->>'title'),nullif(payload->>'due_at','')::timestamptz) returning * into task;return to_jsonb(task);
 end if;
 if command='task-toggle' then
 if payload->>'source'='field' then
 execute 'update public.field_sales_tasks set status=case when completed_at is null then ''done'' else ''pending'' end,completed_at=case when completed_at is null then now() else null end,version=version+1 where id=$1 and user_id=$2 and workspace_id=$3 and version=$4 returning to_jsonb(field_sales_tasks.*)' into result using (payload->>'id')::uuid,auth.uid(),ws,(payload->>'version')::integer;
 else
 update public.crm_person_tasks set completed_at=case when completed_at is null then now() else null end,version=version+1 where id=(payload->>'id')::uuid and user_id=auth.uid() and workspace_id=ws and version=(payload->>'version')::integer returning to_jsonb(crm_person_tasks.*) into result;
 end if;
 if result is null then raise exception 'Task changed; refresh before updating' using errcode='40001';end if;return result;
 end if;
 target:=(payload->>'id')::uuid;
 select * into row from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws for update;
 if not found then raise exception 'Contact unavailable' using errcode='42501';end if;
 if command='read' then
 insert into public.crm_conversation_reads(user_id,workspace_id,contact_id,last_read_at) values(auth.uid(),ws,target,clock_timestamp()) on conflict(user_id,contact_id) do update set last_read_at=excluded.last_read_at;return '{}';
 elsif command='labels' then
 select coalesce(array_agg(value),'{}') into labels from jsonb_array_elements_text(payload->'labels');
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,labels) values(auth.uid(),ws,target,labels) on conflict(user_id,contact_id) do update set labels=excluded.labels;return '{}';
 elsif command='stage' then
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,stage) values(auth.uid(),ws,target,payload->>'stage') on conflict(user_id,contact_id) do update set stage=excluded.stage;return '{}';
 elsif command='update' then
 if row.updated_at is distinct from (payload->>'updated_at')::timestamptz then raise exception 'This contact changed elsewhere. Cancel to reload its latest details before saving.' using errcode='40001';end if;
 if coalesce(length(trim(payload->>'first_name')),0) not between 1 and 100 then raise exception 'Enter a first name';end if;
 update public.contacts set full_name=trim((payload->>'first_name')||' '||coalesce(payload->>'last_name','')),phone=nullif(trim(payload->>'phone'),''),email=nullif(trim(payload->>'email'),''),address=coalesce(payload->>'address',''),notes=nullif(payload->>'notes',''),last_contacted=nullif(payload->>'last_contacted_at','')::timestamptz,follow_up_at=nullif(payload->>'next_follow_up_at','')::timestamptz,updated_at=clock_timestamp() where id=target and user_id=auth.uid() and workspace_id=ws;
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,first_name,last_name,name_snapshot) values(auth.uid(),ws,target,trim(payload->>'first_name'),trim(coalesce(payload->>'last_name','')),trim((payload->>'first_name')||' '||coalesce(payload->>'last_name',''))) on conflict(user_id,contact_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,name_snapshot=excluded.name_snapshot;
 return (select jsonb_build_object('updated_at',updated_at) from public.contacts where id=target);
 end if;
 raise exception 'Unknown CRM action';
end $$;
revoke all on function public.coco_crm_snapshot(uuid,integer),public.coco_crm_command(uuid,text,jsonb) from public,anon;
grant execute on function public.coco_crm_snapshot(uuid,integer),public.coco_crm_command(uuid,text,jsonb) to authenticated;

create table public.crm_gmail_auth_tickets(id text primary key,user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,challenge_hash text not null,verifier_encrypted text not null,origin text not null,native boolean not null,scopes text[] not null,pending_tokens text,email text,expires_at timestamptz not null,claimed_at timestamptz);
alter table public.crm_gmail_auth_tickets enable row level security;
revoke all on public.crm_gmail_auth_tickets from anon,authenticated;
grant all on public.crm_gmail_auth_tickets to service_role;
create table public.crm_email_send_requests(id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,contact_id uuid references public.contacts(id) on delete set null,payload_hash text not null,status text not null default 'sending' check(status in('sending','sent','failed','unknown')),gmail_message_id text,created_at timestamptz not null default now(),primary key(user_id,id));
alter table public.crm_email_send_requests enable row level security;
create policy own_email_requests on public.crm_email_send_requests for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.crm_email_send_requests to authenticated;grant all on public.crm_email_send_requests to service_role;

create function public.coco_save_gmail_candidate(ws uuid,candidate jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous uuid;target uuid;matches integer;name text;parts text[];new_contact boolean:=false;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 -- Serialize repeated imports for the same personal mailbox candidate.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||ws::text||lower(candidate->>'email'),0));
 select contact_id into previous from public.crm_person_deals where user_id=auth.uid() and workspace_id=ws and source_key=candidate->>'messageId';
 if previous is not null then return jsonb_build_object('client_id',previous,'already_imported',true);end if;
 select count(distinct contact_id),min(contact_id::text)::uuid into matches,target from public.mac_owned_identifiers(ws) where identifier=public.mac_contact_identifier(candidate->>'email');
 if matches>1 then raise exception 'Multiple contacts share this email. Review duplicates in Contacts first.' using errcode='40001';end if;
 name:=trim(candidate->>'name');parts:=string_to_array(name,' ');
 if target is null then
 target:=gen_random_uuid();new_contact:=true;
 insert into public.contacts(id,user_id,workspace_id,full_name,email,phone,address,status,notes) values(target,auth.uid(),ws,name,lower(trim(candidate->>'email')),nullif(candidate->>'phone',''),coalesce(candidate->>'propertyAddress',''),'new',null);
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,first_name,last_name,name_snapshot,labels,stage)
 values(auth.uid(),ws,target,parts[1],coalesce(array_to_string(parts[2:],' '),''),name,array['Client'],case when candidate->>'status'='closed' then 'Past Client' else 'Lead' end);
 end if;
 insert into public.crm_person_deals(user_id,workspace_id,contact_id,source_key,property_address,side,price,closing_date,evidence_subject,evidence_date,evidence)
 values(auth.uid(),ws,target,candidate->>'messageId',nullif(candidate->>'propertyAddress',''),nullif(candidate->>'side',''),(candidate->>'price')::numeric,nullif(candidate->>'closingDate','')::date,coalesce(candidate->>'subject',''),nullif(candidate->>'messageDate','')::timestamptz,jsonb_build_object('confidence',candidate->'confidence','status',candidate->'status','sources',candidate->'sources','warnings',candidate->'warnings','notes',candidate->'notes','excerpt',candidate->'evidenceExcerpt'));
 return jsonb_build_object('client_id',target,'created',new_contact);
end $$;
revoke all on function public.coco_save_gmail_candidate(uuid,jsonb) from public,anon;grant execute on function public.coco_save_gmail_candidate(uuid,jsonb) to authenticated;

create function public.coco_crm_recipient(ws uuid,target uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.contacts;identifier text;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 select * into c from public.contacts where id=target and workspace_id=ws and user_id=auth.uid();
 if not found then raise exception 'Contact unavailable' using errcode='42501';end if;
 with handles as(select * from public.mac_owned_identifiers(ws)),unique_handles as(select h.identifier from handles h group by h.identifier having count(distinct h.contact_id)=1)
 select h.identifier into identifier from handles h join unique_handles u using(identifier) where h.contact_id=target order by case when h.identifier=public.mac_contact_identifier(c.phone) then 0 when h.identifier=public.mac_contact_identifier(c.email) then 1 else 2 end,h.identifier limit 1;
 if identifier is null then raise exception 'Add a unique phone or email before sending' using errcode='42501';end if;
 return jsonb_build_object('id',c.id,'name',c.full_name,'identifier',identifier,'revision',c.updated_at);
end $$;
revoke all on function public.coco_crm_recipient(uuid,uuid) from public,anon;grant execute on function public.coco_crm_recipient(uuid,uuid) to authenticated;

alter table public.mac_crm_preferences add column attachment_sync_enabled boolean not null default false;
create table public.crm_message_attachments(
 user_id uuid not null references auth.users(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,message_guid text not null,guid text not null,
 file_name text not null,mime_type text,byte_count bigint not null check(byte_count between 0 and 52428800),object_key text not null,
 status text not null default 'pending' check(status in('pending','uploaded')),created_at timestamptz not null default now(),
 primary key(user_id,workspace_id,contact_id,message_guid,guid),unique(object_key)
);
alter table public.crm_message_attachments enable row level security;
create policy own_files on public.crm_message_attachments for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.crm_message_attachments to authenticated;
revoke all on public.crm_message_attachments from anon;
grant all on public.crm_message_attachments to service_role;
create function public.coco_attachment_preference(ws uuid,enabled boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 update public.mac_crm_preferences set attachment_sync_enabled=enabled,revision=revision+1 where user_id=auth.uid() and workspace_id=ws;
 if not found then raise exception 'Enable contact sync first';end if;
 if enabled then perform public.recheck_mac_crm_history(ws);end if;
 return jsonb_build_object('enabled',enabled);
end $$;
revoke all on function public.coco_attachment_preference(uuid,boolean) from public;
grant execute on function public.coco_attachment_preference(uuid,boolean) to authenticated;
DO $$begin if to_regclass('storage.buckets') is not null then
 execute $q$insert into storage.buckets(id,name,public,file_size_limit) values('crm-private-message-attachments','crm-private-message-attachments',false,52428800) on conflict(id) do nothing$q$;
end if;end $$;

create or replace function public.delete_mac_message_history(ws uuid,target uuid,confirmation text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if confirmation is distinct from 'DELETE' then raise exception 'Confirm deletion'; end if;
 if not public.mac_workspace_access(ws) or not exists(select 1 from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws for update;
 update public.mac_message_permissions set enabled=false,revoked_at=now() where user_id=auth.uid() and workspace_id=ws and contact_id=target;
 update public.mac_contact_sync set enabled=false,cursor=0,last_sync_at=null where user_id=auth.uid() and contact_id=target;
 delete from public.crm_message_attachments where user_id=auth.uid() and workspace_id=ws and contact_id=target;
 delete from public.mac_contact_messages where user_id=auth.uid() and contact_id=target;
 update public.mac_crm_preferences set revision=revision+1,updated_at=now() where user_id=auth.uid() and workspace_id=ws;
 insert into public.mac_permission_events(user_id,workspace_id,contact_id,action) values(auth.uid(),ws,target,'imported_history_deleted');
end $$;
