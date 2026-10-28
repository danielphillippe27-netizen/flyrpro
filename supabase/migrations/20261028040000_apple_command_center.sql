-- Apple command centre: explicit, identity-pinned per-contact authorization.
-- Existing imported history is preserved; no contacts are silently approved.
alter table public.mac_crm_preferences add column poll_interval_seconds integer not null default 5 check(poll_interval_seconds between 5 and 60);
alter table public.mac_crm_devices add column agent_version text;
create table public.mac_message_permissions (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 enabled boolean not null default false,
 identifiers text[] not null default '{}',
 history_range text not null default 'future' check(history_range in ('future','30d','90d','all')),
 import_after timestamptz,
 approved_at timestamptz, revoked_at timestamptz,
 primary key(user_id,workspace_id,contact_id)
);
alter table public.mac_message_permissions enable row level security;
create policy private_mac_message_permissions on public.mac_message_permissions for select to authenticated
 using(user_id=auth.uid() and public.mac_workspace_access(workspace_id) and exists(select 1 from public.contacts c where c.id=contact_id and c.user_id=auth.uid() and c.workspace_id=mac_message_permissions.workspace_id));
grant select on public.mac_message_permissions to authenticated;
revoke insert,update,delete on public.mac_message_permissions from authenticated,anon;
create table public.mac_permission_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade, contact_id uuid references public.contacts(id) on delete set null,
 action text not null, created_at timestamptz not null default now()
);
alter table public.mac_permission_events enable row level security;
create policy private_mac_permission_events on public.mac_permission_events for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.mac_permission_events to authenticated;
revoke insert,update,delete on public.mac_permission_events from authenticated,anon;

create function public.set_mac_message_permission(ws uuid,target uuid,active boolean,handles text[] default '{}',history text default 'future') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen text[]; since_date timestamptz; result public.mac_message_permissions;
begin
 if not public.mac_workspace_access(ws) or not exists(select 1 from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 if active is null or history is null or history not in ('future','30d','90d','all') or cardinality(handles)>100 then raise exception 'Invalid permission'; end if;
 insert into public.mac_crm_preferences(user_id,workspace_id) values(auth.uid(),ws) on conflict do nothing;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws for update;
 if active then
  if coalesce(cardinality(handles),0)=0 then raise exception 'Select an identifier'; end if;
  select array_agg(distinct public.mac_contact_identifier(h)) into chosen from unnest(handles) h;
  if array_position(chosen,null) is not null or exists(
   select 1 from unnest(chosen) h where not exists(select 1 from public.mac_owned_identifiers(ws) m where m.identifier=h and m.contact_id=target)
   or (select count(distinct m.contact_id) from public.mac_owned_identifiers(ws) m where m.identifier=h)<>1
  ) then raise exception 'Identifiers must uniquely match this CRM contact'; end if;
  since_date:=case history when 'future' then clock_timestamp() when '30d' then now()-interval '30 days' when '90d' then now()-interval '90 days' else null end;
 else chosen:='{}'; since_date:=null;
 end if;
 insert into public.mac_message_permissions(user_id,workspace_id,contact_id,enabled,identifiers,history_range,import_after,approved_at,revoked_at)
 values(auth.uid(),ws,target,active,chosen,history,since_date,case when active then now() end,case when not active then now() end)
 on conflict(user_id,workspace_id,contact_id) do update set enabled=excluded.enabled,identifiers=excluded.identifiers,history_range=excluded.history_range,
 import_after=excluded.import_after,approved_at=case when active then now() else mac_message_permissions.approved_at end,revoked_at=excluded.revoked_at returning * into result;
 update public.mac_contact_sync set cursor=0,enabled=active where user_id=auth.uid() and contact_id=target;
 update public.mac_crm_preferences set revision=revision+1,updated_at=now() where user_id=auth.uid() and workspace_id=ws;
 insert into public.mac_permission_events(user_id,workspace_id,contact_id,action) values(auth.uid(),ws,target,case when active then 'messages_approved_'||history else 'messages_revoked' end);
 return to_jsonb(result)-'user_id';
end $$;

create function public.mac_approved_identifiers(ws uuid) returns table(contact_id uuid,identifier text,import_after timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 with handles as(select * from public.mac_owned_identifiers(ws)), unique_handles as(select identifier from handles group by identifier having count(distinct contact_id)=1)
 select h.contact_id,h.identifier,p.import_after from handles h join unique_handles u using(identifier)
 join public.mac_message_permissions p on p.contact_id=h.contact_id and p.user_id=auth.uid() and p.workspace_id=ws and p.enabled and h.identifier=any(p.identifiers)
$$;
alter function public.prepare_mac_crm_sync(uuid,uuid,boolean) rename to prepare_mac_crm_sync_account_wide;
revoke all on function public.prepare_mac_crm_sync_account_wide(uuid,uuid,boolean) from public,authenticated,anon;
create function public.prepare_mac_crm_sync(ws uuid,device uuid,recheck boolean default false,history_capable boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.mac_crm_preferences; result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if not coalesce(history_capable,false) then return jsonb_build_object('enabled',false,'requiresUpdate',true,'contacts','[]'::jsonb); end if;
 select * into pref from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws for update;
 if not coalesce(pref.sync_enabled,false) then return jsonb_build_object('enabled',false,'contacts','[]'::jsonb); end if;
 with eligible as(select contact_id,md5(string_agg(identifier,',' order by identifier)) signature from public.mac_approved_identifiers(ws) group by contact_id)
 insert into public.mac_contact_sync(user_id,device_id,contact_id,enabled,identifier_signature)
 select auth.uid(),device,contact_id,true,signature from eligible on conflict(user_id,device_id,contact_id) do update set enabled=true,
 cursor=case when recheck or mac_contact_sync.identifier_signature is distinct from excluded.identifier_signature then 0 else mac_contact_sync.cursor end,identifier_signature=excluded.identifier_signature;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'full_name',c.full_name,'identifiers',h.identifiers,'cursor',s.cursor,'importAfter',h.import_after) order by c.id),'[]') into result
 from public.contacts c join public.mac_contact_sync s on s.contact_id=c.id and s.user_id=auth.uid() and s.device_id=device
 join (select contact_id,jsonb_agg(identifier order by identifier) identifiers,min(import_after) import_after from public.mac_approved_identifiers(ws) group by contact_id) h on h.contact_id=c.id
 where c.user_id=auth.uid() and c.workspace_id=ws;
 insert into public.mac_crm_devices(user_id,device_id,workspace_id,status) values(auth.uid(),device,ws,'syncing')
 on conflict(user_id,device_id,workspace_id) do update set last_seen_at=now(),status='syncing';
 return jsonb_build_object('enabled',true,'revision',pref.revision,'contacts',result);
end $$;

alter function public.import_mac_contact_messages(uuid,uuid,bigint,jsonb) rename to import_mac_contact_messages_checked;
revoke all on function public.import_mac_contact_messages_checked(uuid,uuid,bigint,jsonb) from public,authenticated,anon;
create function public.import_mac_contact_messages(target_device uuid,target_contact uuid,expected_cursor bigint,batch jsonb,scanned_cursor bigint default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ws uuid; permission public.mac_message_permissions; item jsonb; result jsonb; through bigint;
begin
 select workspace_id into ws from public.contacts where id=target_contact and user_id=auth.uid();
 if ws is null or not public.mac_workspace_access(ws) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws and sync_enabled for update;
 if not found then raise exception 'Sync is paused' using errcode='42501'; end if;
 select * into permission from public.mac_message_permissions where user_id=auth.uid() and workspace_id=ws and contact_id=target_contact and enabled for update;
 if not found then raise exception 'Approve this contact before importing' using errcode='42501'; end if;
 if batch is null or jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)>100 then raise exception 'Invalid batch'; end if;
 for item in select value from jsonb_array_elements(batch) loop
  if jsonb_typeof(item->'participants') is distinct from 'array' or jsonb_array_length(item->'participants')<>1
   or not coalesce(public.mac_contact_identifier(item->'participants'->>0)=any(permission.identifiers),false) then raise exception 'Identifier not approved'; end if;
  if permission.import_after is not null and (nullif(item->>'sentAt','') is null or (item->>'sentAt')::timestamptz<permission.import_after) then raise exception 'Message is outside the approved history range'; end if;
 end loop;
 result:=public.import_mac_contact_messages_checked(target_device,target_contact,expected_cursor,batch);
 through:=coalesce(scanned_cursor,(result->>'cursor')::bigint);
 if through<(result->>'cursor')::bigint or through>9007199254740991 or (jsonb_array_length(batch)=100 and through<>(result->>'cursor')::bigint) then raise exception 'Invalid scan checkpoint'; end if;
 update public.mac_contact_sync set cursor=through where user_id=auth.uid() and device_id=target_device and contact_id=target_contact;
 return jsonb_set(result,'{cursor}',to_jsonb(through));
end $$;

create function public.set_mac_poll_interval(ws uuid,seconds integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if seconds is null or seconds not between 5 and 60 then raise exception 'Choose 5 to 60 seconds'; end if;
 insert into public.mac_crm_preferences(user_id,workspace_id,poll_interval_seconds) values(auth.uid(),ws,seconds)
 on conflict(user_id,workspace_id) do update set poll_interval_seconds=seconds,revision=mac_crm_preferences.revision+1,updated_at=now();
end $$;
create function public.report_apple_agent(ws uuid,device uuid,device_status text,version text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.report_mac_crm_device(ws,device,device_status);
 update public.mac_crm_devices set agent_version=left(version,40) where user_id=auth.uid() and device_id=device and workspace_id=ws;
end $$;

create function public.mac_apple_contacts(ws uuid,query text default '',page_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if page_offset not between 0 and 1000000 or length(query)>200 then raise exception 'Invalid page'; end if;
 with handles as(select * from public.mac_owned_identifiers(ws)), counts as(select identifier,count(distinct contact_id) matches from handles group by identifier), rows as(
 select c.id,c.full_name,c.phone,c.email,
 coalesce((select jsonb_agg(jsonb_build_object('value',h.identifier,'unique',x.matches=1) order by h.identifier) from handles h join counts x using(identifier) where h.contact_id=c.id),'[]') identifiers,
 p.enabled,p.history_range,p.import_after,p.approved_at,
 (select count(*) from public.mac_contact_messages m where m.user_id=auth.uid() and m.contact_id=c.id) message_count
 from public.contacts c left join public.mac_message_permissions p on p.user_id=auth.uid() and p.workspace_id=ws and p.contact_id=c.id
 where c.user_id=auth.uid() and c.workspace_id=ws and (query='' or position(lower(query) in lower(coalesce(c.full_name,'')||' '||coalesce(c.phone,'')||' '||coalesce(c.email,'')))>0)
 order by coalesce(p.enabled,false) desc,c.full_name,c.id limit 51 offset page_offset)
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from rows;
 return result;
end $$;

create function public.mac_apple_overview(ws uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select jsonb_build_object(
 'messages',(select count(*) from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws),
 'conversations',(select count(distinct m.contact_id) from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws),
 'approvedContacts',(select count(*) from public.mac_message_permissions p join public.contacts c on c.id=p.contact_id where p.user_id=auth.uid() and c.user_id=auth.uid() and p.workspace_id=ws and c.workspace_id=ws and p.enabled),
 'matchedContacts',(select count(distinct contact_id) from public.mac_approved_identifiers(ws)),
 'importedContacts',(select count(distinct i.contact_id) from public.mac_apple_imports i join public.contacts c on c.id=i.contact_id where i.user_id=auth.uid() and c.user_id=auth.uid() and i.workspace_id=ws and c.workspace_id=ws),
 'lastSyncAt',(select max(s.last_sync_at) from public.mac_contact_sync s join public.contacts c on c.id=s.contact_id where s.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws)
 ) into result; return result;
end $$;

create function public.mac_apple_conversations(ws uuid,query text default '',page_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if page_offset not between 0 and 1000000 or length(query)>200 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from(
 select c.id,c.full_name,c.phone,c.email,coalesce(p.enabled,false) approved,p.history_range,
 last_message.id message_id,left(last_message.body,140) preview,last_message.sent_at,last_message.direction,
 (select count(*) from public.mac_contact_messages m where m.user_id=auth.uid() and m.contact_id=c.id) message_count
 from public.contacts c left join public.mac_message_permissions p on p.contact_id=c.id and p.user_id=auth.uid() and p.workspace_id=ws
 left join lateral(select m.id,m.body,m.sent_at,m.direction from public.mac_contact_messages m where m.user_id=auth.uid() and m.contact_id=c.id order by m.sent_at desc nulls last,m.id desc limit 1) last_message on true
 where c.user_id=auth.uid() and c.workspace_id=ws and (coalesce(p.enabled,false) or last_message.id is not null)
 and (query='' or position(lower(query) in lower(coalesce(c.full_name,'')))>0 or exists(select 1 from public.mac_contact_messages m where m.user_id=auth.uid() and m.contact_id=c.id and m.search_document@@websearch_to_tsquery('simple',left(query,200))))
 order by last_message.sent_at desc nulls last,c.full_name,c.id limit 51 offset page_offset) rows;
 return result;
end $$;

create function public.delete_mac_message_history(ws uuid,target uuid,confirmation text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if confirmation is distinct from 'DELETE' then raise exception 'Confirm deletion'; end if;
 if not public.mac_workspace_access(ws) or not exists(select 1 from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws for update;
 update public.mac_message_permissions set enabled=false,revoked_at=now() where user_id=auth.uid() and workspace_id=ws and contact_id=target;
 update public.mac_contact_sync set enabled=false,cursor=0,last_sync_at=null where user_id=auth.uid() and contact_id=target;
 delete from public.mac_contact_messages where user_id=auth.uid() and contact_id=target;
 update public.mac_crm_preferences set revision=revision+1,updated_at=now() where user_id=auth.uid() and workspace_id=ws;
 insert into public.mac_permission_events(user_id,workspace_id,contact_id,action) values(auth.uid(),ws,target,'imported_history_deleted');
end $$;

create or replace function public.crm_ai_context(ws uuid,question text,selected_contact uuid default null,after_date timestamptz default null,before_date timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare people jsonb; messages jsonb:='[]'; tasks jsonb:='[]'; pref public.mac_crm_preferences; terms tsquery;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if selected_contact is not null and not exists(select 1 from public.contacts where id=selected_contact and user_id=auth.uid() and workspace_id=ws) then raise exception 'Contact unavailable' using errcode='42501'; end if;
 select * into pref from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws;
 terms:=websearch_to_tsquery('simple',left(question,1200));
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into people from (
 select id,full_name,left(notes,1200) notes,follow_up_at,appointment_at from public.contacts
 where user_id=auth.uid() and workspace_id=ws and (selected_contact is null or id=selected_contact)
 order by (to_tsvector('simple',coalesce(full_name,'')||' '||coalesce(notes,''))@@terms) desc,updated_at desc nulls last,id limit 30
 ) c;
 if coalesce(pref.ai_messages_enabled,false) then
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into messages from (
 select m.id,m.contact_id,c.full_name,m.direction,left(m.body,1800) body,m.sent_at
 from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id
 where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws and exists(select 1 from public.mac_message_permissions p where p.user_id=auth.uid() and p.workspace_id=ws and p.contact_id=c.id and p.enabled and (p.import_after is null or m.sent_at>=p.import_after))
 and (selected_contact is null or c.id=selected_contact) and (after_date is null or m.sent_at>=after_date) and (before_date is null or m.sent_at<=before_date)
 and (selected_contact is not null or m.search_document@@terms or exists(select 1 from public.contacts matched where matched.id=c.id and to_tsvector('simple',coalesce(matched.full_name,''))@@terms))
 order by ts_rank(m.search_document,terms) desc,m.sent_at desc nulls last,m.id limit 40
 ) m;
 -- General questions still get recent context when no keyword matched; explicitly bounded.
 if jsonb_array_length(messages)=0 and selected_contact is null then
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into messages from (
 select m.id,m.contact_id,c.full_name,m.direction,left(m.body,1800) body,m.sent_at
 from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id
 where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws and exists(select 1 from public.mac_message_permissions p where p.user_id=auth.uid() and p.workspace_id=ws and p.contact_id=c.id and p.enabled and (p.import_after is null or m.sent_at>=p.import_after))
 and (after_date is null or m.sent_at>=after_date) and (before_date is null or m.sent_at<=before_date)
 order by m.sent_at desc nulls last,m.id limit 20) m;
 end if;
 end if;
 if to_regclass('public.field_sales_tasks') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from (select t.id,t.contact_id,left(t.title,200) title,t.due_at,t.status from public.field_sales_tasks t join public.contacts c on c.id=t.contact_id where t.user_id=$1 and c.user_id=$1 and t.workspace_id=$2 and c.workspace_id=$2 and ($3 is null or t.contact_id=$3) and t.status=''pending'' order by t.due_at limit 30) t'
 into tasks using auth.uid(),ws,selected_contact;
 end if;
 return jsonb_build_object('contacts',people,'messages',messages,'tasks',tasks,'messagesEnabled',coalesce(pref.ai_messages_enabled,false),'consentRevision',coalesce(pref.revision,0),'partial',true);
end $$;

revoke all on function public.set_mac_message_permission(uuid,uuid,boolean,text[],text),public.mac_approved_identifiers(uuid),public.set_mac_poll_interval(uuid,integer),public.report_apple_agent(uuid,uuid,text,text),public.mac_apple_contacts(uuid,text,integer),public.mac_apple_overview(uuid),public.mac_apple_conversations(uuid,text,integer),public.delete_mac_message_history(uuid,uuid,text),public.import_mac_contact_messages(uuid,uuid,bigint,jsonb,bigint) from public,anon;
grant execute on function public.set_mac_message_permission(uuid,uuid,boolean,text[],text),public.mac_approved_identifiers(uuid),public.set_mac_poll_interval(uuid,integer),public.report_apple_agent(uuid,uuid,text,text),public.mac_apple_contacts(uuid,text,integer),public.mac_apple_overview(uuid),public.mac_apple_conversations(uuid,text,integer),public.delete_mac_message_history(uuid,uuid,text),public.import_mac_contact_messages(uuid,uuid,bigint,jsonb,bigint) to authenticated;

create function public.mac_apple_productivity(ws uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare events jsonb; reminders jsonb; tasks jsonb:='[]';
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into events from(select id,full_name,appointment_at from public.contacts where user_id=auth.uid() and workspace_id=ws and appointment_at>=now()-interval '1 day' order by appointment_at,id limit 100) e;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into reminders from(select id,id contact_id,full_name,'Follow up with '||coalesce(full_name,'contact') title,follow_up_at due_at,'contact' source from public.contacts where user_id=auth.uid() and workspace_id=ws and follow_up_at is not null order by follow_up_at,id limit 100) r;
 if to_regclass('public.field_sales_tasks') is not null then
 execute 'select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from(select t.id,t.contact_id,c.full_name,left(t.title,200) title,t.due_at,''task'' source from public.field_sales_tasks t join public.contacts c on c.id=t.contact_id where t.user_id=$1 and c.user_id=$1 and t.workspace_id=$2 and c.workspace_id=$2 and t.status=''pending'' and t.due_at is not null order by t.due_at,t.id limit 100) r' into tasks using auth.uid(),ws;
 end if;
 return jsonb_build_object('appointments',events,'reminders',reminders||tasks);
end $$;
revoke all on function public.mac_apple_productivity(uuid) from public,anon;
grant execute on function public.mac_apple_productivity(uuid) to authenticated;

-- User-directed behaviour: saving a reviewed Apple contact authorizes future
-- messages for its unique identifiers. It never enables global sync or AI.
alter function public.import_apple_contact(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid) rename to import_apple_contact_reviewed;
revoke all on function public.import_apple_contact_reviewed(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid) from public,authenticated,anon;
create function public.import_apple_contact(ws uuid,device uuid,external text,person_name text,phones jsonb,emails jsonb,primary_phone text,primary_email text,target uuid default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare selected uuid; chosen text[];
begin
 selected:=public.import_apple_contact_reviewed(ws,device,external,person_name,phones,emails,primary_phone,primary_email,target);
 with handles as(select * from public.mac_owned_identifiers(ws)), unique_handles as(select identifier from handles group by identifier having count(distinct contact_id)=1)
 select array_agg(h.identifier order by h.identifier) into chosen from handles h join unique_handles u using(identifier) where h.contact_id=selected;
 if coalesce(cardinality(chosen),0)>0 and not exists(select 1 from public.mac_message_permissions p where p.user_id=auth.uid() and p.workspace_id=ws and p.contact_id=selected and p.enabled and chosen<@p.identifiers) then
  perform public.set_mac_message_permission(ws,selected,true,chosen,'future');
 end if;
 return selected;
end $$;
revoke all on function public.import_apple_contact(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid) from public,anon;
grant execute on function public.import_apple_contact(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid) to authenticated;

revoke all on function public.prepare_mac_crm_sync(uuid,uuid,boolean,boolean) from public,anon;
grant execute on function public.prepare_mac_crm_sync(uuid,uuid,boolean,boolean) to authenticated;

create function public.audit_mac_preferences() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (tg_op='INSERT' and new.sync_enabled) or (tg_op='UPDATE' and new.sync_enabled is distinct from old.sync_enabled) then
  insert into public.mac_permission_events(user_id,workspace_id,action) values(new.user_id,new.workspace_id,case when new.sync_enabled then 'sync_enabled' else 'sync_paused' end);
 end if;
 if (tg_op='INSERT' and new.ai_messages_enabled) or (tg_op='UPDATE' and new.ai_messages_enabled is distinct from old.ai_messages_enabled) then
  insert into public.mac_permission_events(user_id,workspace_id,action) values(new.user_id,new.workspace_id,case when new.ai_messages_enabled then 'ai_message_access_allowed' else 'ai_message_access_removed' end);
 end if;
 return new;
end $$;
revoke all on function public.audit_mac_preferences() from public,anon,authenticated;
create trigger audit_mac_preferences after insert or update on public.mac_crm_preferences for each row execute function public.audit_mac_preferences();
create function public.mac_apple_audit(ws uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]') into result from(select id,action,contact_id,created_at from public.mac_permission_events where user_id=auth.uid() and workspace_id=ws order by created_at desc,id desc limit 30) rows;
 return result;
end $$;
revoke all on function public.mac_apple_audit(uuid) from public,anon;
grant execute on function public.mac_apple_audit(uuid) to authenticated;

-- The consent model changed from all owned contacts to explicit identities.
-- Pause older clients until the user reviews permissions in the updated app.
-- No imported messages, contact data, device checkpoints or API keys are deleted.
update public.mac_crm_preferences set sync_enabled=false,ai_messages_enabled=false,revision=revision+1,updated_at=now();
