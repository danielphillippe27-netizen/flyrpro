-- Additive extension of the Mac preview. Never share personal message bodies with a team.
create function public.mac_workspace_access(ws uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and ws is not null and (
 exists(select 1 from public.workspace_members where workspace_id=ws and user_id=auth.uid())
 or exists(select 1 from public.workspaces where id=ws and owner_id=auth.uid()))
$$;
create table public.mac_crm_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 sync_enabled boolean not null default false, ai_messages_enabled boolean not null default false,
 sync_consent_at timestamptz, ai_consent_at timestamptz, revision bigint not null default 1,
 updated_at timestamptz not null default now(), primary key(user_id,workspace_id)
);
create table public.mac_contact_identifiers (
 user_id uuid not null references auth.users(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 identifier text not null check(identifier=public.mac_contact_identifier(identifier)),
 primary key(user_id,contact_id,identifier)
);
create index mac_identifier_lookup on public.mac_contact_identifiers(user_id,identifier);
create table public.mac_apple_imports (
 user_id uuid not null references auth.users(id) on delete cascade, device_id uuid not null,
 external_id text not null check(length(external_id) between 1 and 512),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 primary key(user_id,device_id,workspace_id,external_id)
);
create table public.mac_crm_devices (
 user_id uuid not null references auth.users(id) on delete cascade, device_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 last_seen_at timestamptz not null default now(), status text not null default 'idle',
 primary key(user_id,device_id,workspace_id)
);
alter table public.mac_contact_sync add column identifier_signature text;
alter table public.mac_contact_messages add column search_document tsvector generated always as (to_tsvector('simple',coalesce(body,''))) stored;
create index mac_message_search on public.mac_contact_messages using gin(search_document);
create index mac_contact_search on public.contacts using gin(to_tsvector('simple',coalesce(full_name,'')||' '||coalesce(notes,'')));

alter table public.mac_crm_preferences enable row level security;
alter table public.mac_contact_identifiers enable row level security;
alter table public.mac_apple_imports enable row level security;
alter table public.mac_crm_devices enable row level security;
create policy private_mac_preferences on public.mac_crm_preferences for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
create policy private_mac_identifiers on public.mac_contact_identifiers for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.contacts c where c.id=contact_id and c.user_id=auth.uid() and public.mac_workspace_access(c.workspace_id)));
create policy private_mac_imports on public.mac_apple_imports for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
create policy private_mac_devices on public.mac_crm_devices for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.mac_crm_preferences,public.mac_contact_identifiers,public.mac_apple_imports,public.mac_crm_devices to authenticated;
revoke insert,update,delete on public.mac_crm_preferences,public.mac_contact_identifiers,public.mac_apple_imports,public.mac_crm_devices from authenticated,anon;
-- Harden preview reads against contact reassignment or loss of workspace access.
drop policy mac_messages_private on public.mac_contact_messages;
create policy mac_messages_private on public.mac_contact_messages for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.contacts c where c.id=contact_id and c.user_id=auth.uid() and public.mac_workspace_access(c.workspace_id)));

create function public.set_mac_crm_preferences(ws uuid,sync_active boolean,ai_active boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.mac_crm_preferences;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if sync_active is null or ai_active is null then raise exception 'Invalid consent'; end if;
 insert into public.mac_crm_preferences(user_id,workspace_id,sync_enabled,ai_messages_enabled,sync_consent_at,ai_consent_at)
 values(auth.uid(),ws,sync_active,ai_active,case when sync_active then now() end,case when ai_active then now() end)
 on conflict(user_id,workspace_id) do update set sync_enabled=excluded.sync_enabled,ai_messages_enabled=excluded.ai_messages_enabled,
 sync_consent_at=case when excluded.sync_enabled and not mac_crm_preferences.sync_enabled then now() else mac_crm_preferences.sync_consent_at end,
 ai_consent_at=case when excluded.ai_messages_enabled and not mac_crm_preferences.ai_messages_enabled then now() else mac_crm_preferences.ai_consent_at end,
 revision=mac_crm_preferences.revision+1,updated_at=now() returning * into result;
 return to_jsonb(result)-'user_id';
end $$;

create function public.mac_owned_identifiers(ws uuid) returns table(contact_id uuid,identifier text)
language sql stable security definer set search_path=public,pg_temp as $$
 select distinct c.id,h.value from public.contacts c
 cross join lateral (
 select public.mac_contact_identifier(c.phone) value union select public.mac_contact_identifier(c.email)
 union select i.identifier from public.mac_contact_identifiers i where i.contact_id=c.id and i.user_id=auth.uid()
 ) h where c.user_id=auth.uid() and c.workspace_id=ws and public.mac_workspace_access(ws) and h.value is not null
$$;

create function public.prepare_mac_crm_sync(ws uuid,device uuid,recheck boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.mac_crm_preferences; result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 select * into pref from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws for update;
 if not coalesce(pref.sync_enabled,false) then return jsonb_build_object('enabled',false,'contacts','[]'::jsonb); end if;
 with handles as (select * from public.mac_owned_identifiers(ws)), unique_handles as (
 select identifier from handles group by identifier having count(*)=1
 ), eligible as (
 select h.contact_id,md5(string_agg(h.identifier,',' order by h.identifier)) signature from handles h join unique_handles u using(identifier) group by h.contact_id
 )
 insert into public.mac_contact_sync(user_id,device_id,contact_id,enabled,identifier_signature)
 select auth.uid(),device,contact_id,true,signature from eligible
 on conflict(user_id,device_id,contact_id) do update set enabled=true,
 cursor=case when recheck or mac_contact_sync.identifier_signature is distinct from excluded.identifier_signature then 0 else mac_contact_sync.cursor end,
 identifier_signature=excluded.identifier_signature;
 with handles as (select * from public.mac_owned_identifiers(ws)), unique_handles as (
 select identifier from handles group by identifier having count(*)=1
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'full_name',c.full_name,'identifiers',h.identifiers,'cursor',s.cursor) order by c.id),'[]') into result
 from public.contacts c join public.mac_contact_sync s on s.contact_id=c.id and s.user_id=auth.uid() and s.device_id=device
 join (select contact_id,jsonb_agg(identifier order by identifier) identifiers from handles join unique_handles using(identifier) group by contact_id) h on h.contact_id=c.id
 where c.user_id=auth.uid() and c.workspace_id=ws;
 insert into public.mac_crm_devices(user_id,device_id,workspace_id,status) values(auth.uid(),device,ws,'syncing')
 on conflict(user_id,device_id,workspace_id) do update set last_seen_at=now(),status='syncing';
 return jsonb_build_object('enabled',true,'revision',pref.revision,'contacts',result);
end $$;

create function public.recheck_mac_crm_history(ws uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws and sync_enabled for update;
 if not found then raise exception 'Enable sync first'; end if;
 update public.mac_contact_sync s set cursor=0 where s.user_id=auth.uid() and exists(select 1 from public.contacts c where c.id=s.contact_id and c.workspace_id=ws and c.user_id=auth.uid());
end $$;

create or replace function public.import_mac_contact_messages(target_device uuid,target_contact uuid,expected_cursor bigint,batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved bigint; item jsonb; row_number bigint; previous_row bigint; participant_handle text;
  matching_map jsonb; matches integer; matched uuid; added integer:=0; affected integer; owner_id uuid:=auth.uid(); scope_id uuid;
begin
  if owner_id is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  select workspace_id into scope_id from public.contacts where id=target_contact and user_id=owner_id;
  if not found or not public.mac_workspace_access(scope_id) then raise exception 'Contact unavailable' using errcode='42501'; end if;
  perform 1 from public.mac_crm_preferences where user_id=owner_id and workspace_id=scope_id and sync_enabled for update;
  if not found then raise exception 'Sync is paused' using errcode='42501'; end if;
  select cursor into saved from public.mac_contact_sync where user_id=owner_id and device_id=target_device and contact_id=target_contact and enabled for update;
  if saved is null then raise exception 'Enable this contact before importing' using errcode='42501'; end if;
  if saved is distinct from expected_cursor then raise exception 'Sync changed. Refresh and retry.' using errcode='40001'; end if;
  select workspace_id into scope_id from public.contacts where id=target_contact and user_id=owner_id;
  if not found then raise exception 'Contact unavailable' using errcode='42501'; end if;
  if batch is null or jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)>100 or octet_length(batch::text)>2000000 then raise exception 'Invalid batch'; end if;
  select coalesce(jsonb_object_agg(h.identifier,h.contact_id),'{}') into matching_map from (
    select identifier,min(contact_id::text)::uuid contact_id from public.mac_owned_identifiers(scope_id) group by identifier having count(distinct contact_id)=1
  ) h;
  previous_row:=saved;
  for item in select value from jsonb_array_elements(batch) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'rowID') is distinct from 'number'
      or coalesce(item->>'rowID','') !~ '^[0-9]+$' then raise exception 'Invalid message row'; end if;
    row_number:=(item->>'rowID')::bigint;
    if row_number<=previous_row or row_number>9007199254740991
      or jsonb_typeof(item->'guid') is distinct from 'string' or length(item->>'guid') not between 1 and 256
      or coalesce(item->>'direction','') not in ('incoming','outgoing')
      or coalesce(item->>'bodyStatus','') not in ('decoded','unsupported','empty')
      or (jsonb_typeof(item->'body') is distinct from 'string' and jsonb_typeof(item->'body') is distinct from 'null')
      or length(coalesce(item->>'body',''))>100000
      or jsonb_typeof(item->'participants') is distinct from 'array' then raise exception 'Invalid message'; end if;
    if jsonb_array_length(item->'participants')<>1 or jsonb_typeof(item->'participants'->0) is distinct from 'string' then raise exception 'Only one-to-one conversations are allowed'; end if;
    participant_handle:=public.mac_contact_identifier(item->'participants'->>0);
    matched:=(matching_map->>participant_handle)::uuid;
    if matched is null or matched<>target_contact then raise exception 'Participant does not uniquely match this contact'; end if;
    insert into public.mac_contact_messages(user_id,contact_id,external_id,direction,body,body_status,service,sent_at,has_attachments)
    values(owner_id,target_contact,item->>'guid',item->>'direction',item->>'body',item->>'bodyStatus',left(item->>'service',32),nullif(item->>'sentAt','')::timestamptz,coalesce((item->>'hasAttachments')::boolean,false))
    on conflict(user_id,external_id) do update set
      body=case when mac_contact_messages.body is null or mac_contact_messages.body='' then excluded.body else mac_contact_messages.body end,
      body_status=case when (mac_contact_messages.body is null or mac_contact_messages.body='') and excluded.body is not null then excluded.body_status else mac_contact_messages.body_status end
    where mac_contact_messages.contact_id=excluded.contact_id;
    get diagnostics affected = row_count; added:=added+affected;
    previous_row:=row_number;
  end loop;
  update public.mac_contact_sync set cursor=previous_row,last_sync_at=now() where user_id=owner_id and device_id=target_device and contact_id=target_contact;
  update public.mac_crm_devices set last_seen_at=now(),status='connected' where user_id=owner_id and device_id=target_device and workspace_id=scope_id;
  return jsonb_build_object('saved',added,'cursor',previous_row);
end $$;

revoke execute on function public.configure_mac_contact(uuid,uuid,boolean) from authenticated;

create function public.mac_contact_name(raw text) returns text language sql immutable as $$
 select regexp_replace(lower(translate(btrim(raw),'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ','AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),'\s+',' ','g')
$$;
create function public.review_apple_contact(ws uuid,phones jsonb,emails jsonb,person_name text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if jsonb_typeof(phones) is distinct from 'array' or jsonb_typeof(emails) is distinct from 'array' or jsonb_array_length(phones)>100 or jsonb_array_length(emails)>100 then raise exception 'Invalid identifiers'; end if;
 with incoming as (
 select public.mac_contact_identifier(value) identifier from jsonb_array_elements_text(phones||emails)
 ), matches as (
 select c.id,c.full_name,c.phone,c.email from public.contacts c where c.user_id=auth.uid() and c.workspace_id=ws and (
 public.mac_contact_name(c.full_name)=public.mac_contact_name(person_name)
 or exists(select 1 from public.mac_owned_identifiers(ws) h join incoming i using(identifier) where h.contact_id=c.id))
 ) select coalesce(jsonb_agg(to_jsonb(matches)),'[]') into result from matches;
 return result;
end $$;

create function public.import_apple_contact(ws uuid,device uuid,external text,person_name text,phones jsonb,emails jsonb,primary_phone text,primary_email text,target uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare selected uuid; prior uuid; candidates jsonb; raw text; handle text;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if length(btrim(person_name)) not between 1 and 200 or length(external) not between 1 and 512 then raise exception 'Invalid contact'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||ws::text,0));
 candidates:=public.review_apple_contact(ws,phones,emails,person_name);
 if exists(select 1 from jsonb_array_elements(phones||emails) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>256) then raise exception 'Invalid identifiers'; end if;
 if nullif(primary_phone,'') is not null and not phones ? primary_phone then raise exception 'Choose a supplied phone'; end if;
 if nullif(primary_email,'') is not null and not emails ? primary_email then raise exception 'Choose a supplied email'; end if;
 select contact_id into prior from public.mac_apple_imports where user_id=auth.uid() and device_id=device and workspace_id=ws and external_id=external;
 if prior is not null then
   if not exists(select 1 from public.contacts where id=prior and user_id=auth.uid() and workspace_id=ws) then raise exception 'Previously imported contact unavailable' using errcode='42501'; end if;
   if target is not null and target<>prior then raise exception 'Import already linked to another contact'; end if;
   selected:=prior;
 elsif target is not null then
   if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'id'=target::text) then raise exception 'Review a matching contact first'; end if;
   selected:=target;
 elsif jsonb_array_length(candidates)>0 then raise exception 'Choose which existing person to update';
 else
   insert into public.contacts(id,user_id,workspace_id,full_name,phone,email,address,status)
   values(gen_random_uuid(),auth.uid(),ws,btrim(person_name),nullif(primary_phone,''),nullif(primary_email,''),'','new') returning id into selected;
 end if;
 update public.contacts set phone=case when nullif(btrim(phone),'') is null then nullif(primary_phone,'') else phone end,
 email=case when nullif(btrim(email),'') is null then nullif(primary_email,'') else email end
 where id=selected and user_id=auth.uid() and workspace_id=ws;
 for raw in select value from jsonb_array_elements_text(phones||emails) loop
   handle:=public.mac_contact_identifier(raw);
   if handle is not null then insert into public.mac_contact_identifiers(user_id,contact_id,identifier) values(auth.uid(),selected,handle) on conflict do nothing; end if;
 end loop;
 insert into public.mac_apple_imports(user_id,device_id,workspace_id,external_id,contact_id) values(auth.uid(),device,ws,external,selected) on conflict do nothing;
 return selected;
end $$;

create function public.report_mac_crm_device(ws uuid,device uuid,device_status text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if device_status not in ('idle','connected','syncing','paused','permission_required','schema_changed','offline','authentication_required','error') then raise exception 'Invalid status'; end if;
 insert into public.mac_crm_devices(user_id,device_id,workspace_id,status) values(auth.uid(),device,ws,device_status)
 on conflict(user_id,device_id,workspace_id) do update set status=excluded.status,last_seen_at=now();
end $$;

create table public.crm_ai_connections (
 user_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid not null references public.workspaces(id) on delete cascade,
 encrypted_key text not null, version uuid not null default gen_random_uuid(), updated_at timestamptz not null default now(), primary key(user_id,workspace_id)
);
create table public.crm_ai_usage (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 status text not null default 'reserved' check(status in ('reserved','completed','failed')),
 model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0,
 error_code text, created_at timestamptz not null default now()
);
create index crm_ai_usage_window on public.crm_ai_usage(user_id,created_at);
alter table public.crm_ai_connections enable row level security;
alter table public.crm_ai_usage enable row level security;
revoke all on public.crm_ai_connections,public.crm_ai_usage from authenticated,anon;
grant all on public.crm_ai_connections,public.crm_ai_usage to service_role;
create policy crm_ai_usage_private on public.crm_ai_usage for select to authenticated using(user_id=auth.uid() and public.mac_workspace_access(workspace_id));
grant select on public.crm_ai_usage to authenticated;
create function public.reserve_crm_ai_request(ws uuid,ai_model text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare request_id uuid;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if length(ai_model) not between 1 and 100 then raise exception 'Invalid model'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-ai:'||auth.uid()::text,0));
 if (select count(*) from public.crm_ai_usage where user_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'AI request limit reached' using errcode='P0003'; end if;
 insert into public.crm_ai_usage(user_id,workspace_id,model) values(auth.uid(),ws,ai_model) returning id into request_id;
 return request_id;
end $$;

create function public.crm_ai_context(ws uuid,question text,selected_contact uuid default null,after_date timestamptz default null,before_date timestamptz default null)
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
 where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws
 and (selected_contact is null or c.id=selected_contact) and (after_date is null or m.sent_at>=after_date) and (before_date is null or m.sent_at<=before_date)
 and (selected_contact is not null or m.search_document@@terms or exists(select 1 from public.contacts matched where matched.id=c.id and to_tsvector('simple',coalesce(matched.full_name,''))@@terms))
 order by ts_rank(m.search_document,terms) desc,m.sent_at desc nulls last,m.id limit 40
 ) m;
 -- General questions still get recent context when no keyword matched; explicitly bounded.
 if jsonb_array_length(messages)=0 and selected_contact is null then
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into messages from (
 select m.id,m.contact_id,c.full_name,m.direction,left(m.body,1800) body,m.sent_at
 from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id
 where m.user_id=auth.uid() and c.user_id=auth.uid() and c.workspace_id=ws
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

-- Explicit grants; no new security-definer function keeps PUBLIC execution.
revoke all on function public.mac_workspace_access(uuid),public.set_mac_crm_preferences(uuid,boolean,boolean),public.mac_owned_identifiers(uuid),public.prepare_mac_crm_sync(uuid,uuid,boolean),public.recheck_mac_crm_history(uuid),public.review_apple_contact(uuid,jsonb,jsonb,text),public.import_apple_contact(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid),public.report_mac_crm_device(uuid,uuid,text),public.reserve_crm_ai_request(uuid,text),public.crm_ai_context(uuid,text,uuid,timestamptz,timestamptz) from public;
grant execute on function public.mac_workspace_access(uuid),public.set_mac_crm_preferences(uuid,boolean,boolean),public.mac_owned_identifiers(uuid),public.prepare_mac_crm_sync(uuid,uuid,boolean),public.recheck_mac_crm_history(uuid),public.review_apple_contact(uuid,jsonb,jsonb,text),public.import_apple_contact(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid),public.report_mac_crm_device(uuid,uuid,text),public.reserve_crm_ai_request(uuid,text),public.crm_ai_context(uuid,text,uuid,timestamptz,timestamptz) to authenticated;
