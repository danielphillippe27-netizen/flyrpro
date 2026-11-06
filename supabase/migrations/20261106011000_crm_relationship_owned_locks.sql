-- Limit outreach row locks to the current owner and workspace.
create or replace function public.coco_relationship_command(ws uuid,command text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; ids uuid[]; item jsonb; data jsonb; revision integer; event_id uuid; inserted integer:=0; req uuid; v_kind text; v_title text; v_body text; at_time timestamptz;
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if command in('read','fields') then
 target:=(payload->>'contactId')::uuid;
 perform 1 from public.contacts where id=target and user_id=auth.uid() and workspace_id=ws for update;
 if not found then raise exception 'Contact unavailable' using errcode='42501';end if;
 if command='read' then
 return jsonb_build_object('fields',coalesce((select fields from public.crm_relationship_fields where user_id=auth.uid() and workspace_id=ws and contact_id=target),'[]'),
 'version',coalesce((select version from public.crm_relationship_fields where user_id=auth.uid() and workspace_id=ws and contact_id=target),0),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id) from (select id,kind,title,body,occurred_at from public.crm_relationship_events where user_id=auth.uid() and workspace_id=ws and contact_id=target) e),'[]'));
 end if;
 data:=payload->'fields';
 if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data)>40 then raise exception 'Invalid fields';end if;
 for item in select value from jsonb_array_elements(data) loop
 if coalesce(length(trim(item->>'name')),0) not between 1 and 80 or (item->>'type') is null or item->>'type' not in('text','date') or jsonb_typeof(item->'value') is distinct from 'string' or length(item->>'value')>1000 then raise exception 'Invalid field';end if;
 if item->>'type'='date' and item->>'value'<>'' then
 if item->>'value' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date';end if;
 perform (item->>'value')::date;
 end if;
 end loop;
 if (select count(*)<>count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(data)) then raise exception 'Duplicate fields';end if;
 select version into revision from public.crm_relationship_fields where user_id=auth.uid() and workspace_id=ws and contact_id=target;
 if (payload->>'version')::integer is distinct from coalesce(revision,0) then raise exception 'Stale fields' using errcode='40001';end if;
 insert into public.crm_relationship_fields(user_id,workspace_id,contact_id,fields) values(auth.uid(),ws,target,data)
 on conflict(user_id,workspace_id,contact_id) do update set fields=excluded.fields,version=crm_relationship_fields.version+1 returning version into revision;
 return jsonb_build_object('version',revision);
 elsif command='outreach' then
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(payload->'ids');
 if coalesce(cardinality(ids),0) not between 1 and 500 then raise exception 'Select 1 to 500 contacts';end if;
 perform 1 from public.contacts where id=any(ids) and user_id=auth.uid() and workspace_id=ws order by id for update;
 if exists(select 1 from unnest(ids) requested(id) where not exists(select 1 from public.contacts c where c.id=requested.id and c.user_id=auth.uid() and c.workspace_id=ws)) then raise exception 'Contact unavailable' using errcode='42501';end if;
 req:=(payload->>'requestId')::uuid;v_kind:=payload->>'kind';v_title:=trim(payload->>'title');v_body:=payload->>'body';at_time:=(payload->>'at')::timestamptz;
 if req is null or v_kind is null or v_kind not in('follow-up','letter-prepared','letter-mailed','call','email','text','visit','note') or coalesce(length(v_title),0) not between 1 and 200 or v_body is null or length(v_body)>10000 or at_time is null then raise exception 'Invalid outreach';end if;
 if v_kind<>'follow-up' and at_time>now()+interval '5 minutes' then raise exception 'Completed touch points cannot be in the future';end if;
 if v_kind in('letter-prepared','letter-mailed') and exists(select 1 from public.contacts where id=any(ids) and nullif(trim(address),'') is null) then raise exception 'Mailing address required';end if;
 foreach target in array ids loop
 -- Reject a reused request key with changed contents instead of silently discarding edits.
 if exists(select 1 from public.crm_relationship_events where user_id=auth.uid() and workspace_id=ws and contact_id=target and request_id=req and (crm_relationship_events.kind<>v_kind or crm_relationship_events.title<>v_title or crm_relationship_events.body<>v_body or occurred_at<>at_time)) then raise exception 'Request changed' using errcode='40001';end if;
 insert into public.crm_relationship_events(user_id,workspace_id,contact_id,request_id,kind,title,body,occurred_at) values(auth.uid(),ws,target,req,v_kind,v_title,v_body,at_time) on conflict do nothing returning id into event_id;
 if event_id is not null then
 inserted:=inserted+1;
 if v_kind='follow-up' then
 insert into public.crm_person_tasks(user_id,workspace_id,contact_id,title,notes,due_at) values(auth.uid(),ws,target,v_title,v_body,at_time);
 else
 if v_kind not in('letter-prepared','note') then
 update public.contacts set last_contacted=greatest(last_contacted,at_time),updated_at=clock_timestamp() where id=target and user_id=auth.uid() and workspace_id=ws;
 end if;
 end if;
 end if;
 end loop;
 return jsonb_build_object('count',cardinality(ids),'created',inserted);
 end if;
 raise exception 'Unknown relationship command';
end $$;
revoke all on function public.coco_relationship_command(uuid,text,jsonb) from public,anon;
grant execute on function public.coco_relationship_command(uuid,text,jsonb) to authenticated;
