-- Durable Apple review details; one transaction saves the contact, label and note.
create function public.crm_valid_contact_labels(labels text[]) returns boolean
language sql immutable set search_path=public,pg_temp as $$
 select labels is not null and cardinality(labels)<=20 and not exists(select 1 from unnest(labels) value where value is null or length(trim(value)) not between 1 and 60)
$$;
alter table public.crm_contact_profiles drop constraint crm_contact_profiles_labels_check;
alter table public.crm_contact_profiles add constraint crm_contact_profiles_labels_check check(public.crm_valid_contact_labels(labels));
alter table public.mac_apple_imports add column review_note text;
create or replace function public.coco_crm_command(ws uuid,command text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 if command='bulk-label' and not public.crm_valid_contact_labels(array[chosen]) then raise exception 'Invalid label';end if;
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

create function public.import_apple_contact_details(ws uuid,device uuid,external text,person_name text,phones jsonb,emails jsonb,primary_phone text,primary_email text,target uuid default null,contact_title text default '',contact_note text default '') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare selected uuid; previous_note text;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 if contact_title is null or length(trim(contact_title))>60 or contact_note is null or length(contact_note)>4000 then raise exception 'Invalid review details'; end if;
 selected:=public.import_apple_contact(ws,device,external,person_name,phones,emails,primary_phone,primary_email,target);
 perform 1 from public.contacts where id=selected and user_id=auth.uid() and workspace_id=ws for update;
 select review_note into previous_note from public.mac_apple_imports where user_id=auth.uid() and workspace_id=ws and device_id=device and external_id=external for update;
 if length(trim(contact_title))>0 then
 insert into public.crm_contact_profiles(user_id,workspace_id,contact_id,labels) values(auth.uid(),ws,selected,array[trim(contact_title)])
 on conflict(user_id,contact_id) do update set labels=array(select distinct unnest(crm_contact_profiles.labels||excluded.labels));
 end if;
 if length(trim(contact_note))>0 and previous_note is distinct from trim(contact_note) then
 update public.contacts set notes=case when nullif(trim(notes),'') is null then trim(contact_note) when notes=trim(contact_note) then notes else notes||E'\n\n'||trim(contact_note) end,updated_at=clock_timestamp()
 where id=selected and user_id=auth.uid() and workspace_id=ws;
 end if;
 update public.mac_apple_imports set review_note=trim(contact_note) where user_id=auth.uid() and workspace_id=ws and device_id=device and external_id=external;
 return selected;
end $$;
revoke all on function public.import_apple_contact_details(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid,text,text) from public,anon;
grant execute on function public.import_apple_contact_details(uuid,uuid,text,text,jsonb,jsonb,text,text,uuid,text,text) to authenticated;
