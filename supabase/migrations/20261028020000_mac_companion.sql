-- Personal Mac imports are deliberately private, even when a contact is shared.
create or replace function public.mac_contact_identifier(raw text) returns text
language plpgsql immutable set search_path = public as $$
declare clean text := lower(btrim(raw)); digits text;
begin
  if clean ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then return clean; end if;
  if clean !~ '^\+?[0-9() .-]+$' then return null; end if;
  digits := regexp_replace(clean, '[^0-9]', '', 'g');
  if length(digits)=10 then return '+1'||digits; end if;
  if length(digits)=11 and left(digits,1)='1' then return '+'||digits; end if;
  if left(clean,1)='+' and length(digits) between 8 and 15 then return '+'||digits; end if;
  return null;
end $$;

create table public.mac_contact_sync (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  enabled boolean not null default false,
  cursor bigint not null default 0 check(cursor between 0 and 9007199254740991),
  last_sync_at timestamptz,
  primary key(user_id,device_id,contact_id)
);
create table public.mac_contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  external_id text not null,
  direction text not null check(direction in ('incoming','outgoing')),
  body text,
  body_status text not null check(body_status in ('decoded','unsupported','empty')),
  service text,
  sent_at timestamptz,
  has_attachments boolean not null default false,
  imported_at timestamptz not null default now(),
  unique(user_id,external_id)
);
create index mac_contact_messages_history on public.mac_contact_messages(user_id,contact_id,sent_at desc,id);
alter table public.mac_contact_sync enable row level security;
alter table public.mac_contact_messages enable row level security;
create policy mac_sync_private on public.mac_contact_sync for select to authenticated using(user_id=auth.uid());
create policy mac_messages_private on public.mac_contact_messages for select to authenticated using(user_id=auth.uid());
grant select on public.mac_contact_sync,public.mac_contact_messages to authenticated;
revoke insert,update,delete on public.mac_contact_sync,public.mac_contact_messages from authenticated,anon;

create or replace function public.configure_mac_contact(target_device uuid,target_contact uuid,active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.contacts where id=target_contact and user_id=auth.uid()) then
    raise exception 'Contact unavailable' using errcode='42501';
  end if;
  insert into public.mac_contact_sync(user_id,device_id,contact_id,enabled)
  values(auth.uid(),target_device,target_contact,active)
  on conflict(user_id,device_id,contact_id) do update set enabled=excluded.enabled;
end $$;

create or replace function public.import_mac_contact_messages(target_device uuid,target_contact uuid,expected_cursor bigint,batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved bigint; item jsonb; row_number bigint; previous_row bigint; identifier text;
  matches integer; matched uuid; added integer:=0; affected integer; owner_id uuid:=auth.uid(); scope_id uuid;
begin
  if owner_id is null then raise exception 'Unauthorized' using errcode='42501'; end if;
  select cursor into saved from public.mac_contact_sync where user_id=owner_id and device_id=target_device and contact_id=target_contact and enabled for update;
  if saved is null then raise exception 'Enable this contact before importing' using errcode='42501'; end if;
  if saved is distinct from expected_cursor then raise exception 'Sync changed. Refresh and retry.' using errcode='40001'; end if;
  select workspace_id into scope_id from public.contacts where id=target_contact and user_id=owner_id;
  if not found then raise exception 'Contact unavailable' using errcode='42501'; end if;
  if batch is null or jsonb_typeof(batch)<>'array' or jsonb_array_length(batch)>100 or octet_length(batch::text)>2000000 then raise exception 'Invalid batch'; end if;
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
    identifier:=public.mac_contact_identifier(item->'participants'->>0);
    select count(*),min(id::text)::uuid into matches,matched from public.contacts
      where user_id=owner_id and workspace_id is not distinct from scope_id and identifier is not null
      and (public.mac_contact_identifier(phone)=identifier or public.mac_contact_identifier(email)=identifier);
    if matches<>1 or matched<>target_contact then raise exception 'Participant does not uniquely match this contact'; end if;
    insert into public.mac_contact_messages(user_id,contact_id,external_id,direction,body,body_status,service,sent_at,has_attachments)
    values(owner_id,target_contact,item->>'guid',item->>'direction',item->>'body',item->>'bodyStatus',left(item->>'service',32),nullif(item->>'sentAt','')::timestamptz,coalesce((item->>'hasAttachments')::boolean,false))
    on conflict(user_id,external_id) do nothing;
    get diagnostics affected = row_count; added:=added+affected;
    previous_row:=row_number;
  end loop;
  update public.mac_contact_sync set cursor=previous_row,last_sync_at=now() where user_id=owner_id and device_id=target_device and contact_id=target_contact;
  return jsonb_build_object('inserted',added,'cursor',previous_row);
end $$;
revoke all on function public.configure_mac_contact(uuid,uuid,boolean),public.import_mac_contact_messages(uuid,uuid,bigint,jsonb) from public;
grant execute on function public.configure_mac_contact(uuid,uuid,boolean),public.import_mac_contact_messages(uuid,uuid,bigint,jsonb) to authenticated;
