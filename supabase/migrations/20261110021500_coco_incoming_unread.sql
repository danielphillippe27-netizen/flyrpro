create or replace function public.coco_crm_snapshot(ws uuid,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
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
 select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','client_id',c->>'id','channel',coalesce(m.service,'sms'),'last_message_at',m.sent_at,'last_incoming_at',incoming.received_at,'last_read_at',r.last_read_at,'preview',m.body,'message_id',m.id)),'[]') into conversations
 from jsonb_array_elements(clients) c join lateral(select * from public.mac_contact_messages m where m.contact_id=(c->>'id')::uuid and m.user_id=auth.uid() order by m.sent_at desc nulls last,m.id desc limit 1) m on true
 left join lateral (
   select greatest(
     (select i.sent_at from public.mac_contact_messages i
      where i.contact_id=m.contact_id and i.user_id=m.user_id and i.direction='incoming' and i.sent_at is not null
      order by i.sent_at desc limit 1),
     (select max(i.imported_at) from public.mac_contact_messages i
      where i.contact_id=m.contact_id and i.user_id=m.user_id and i.direction='incoming' and i.sent_at is null)
   ) as received_at
 ) incoming on true
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

-- Advance the receipt through a message the client actually loaded.
create function public.coco_read_through_message(ws uuid,target uuid,message_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare seen_at timestamptz; receipt timestamptz;
begin
 if not public.mac_workspace_access(ws) then
   raise exception 'Workspace unavailable' using errcode='42501';
 end if;
 select coalesce(m.sent_at,m.imported_at) into seen_at
 from public.mac_contact_messages m join public.contacts c on c.id=m.contact_id
 where m.id=message_id and m.contact_id=target and m.user_id=auth.uid()
   and m.direction='incoming' and c.user_id=auth.uid() and c.workspace_id=ws;
 if not found then
   raise exception 'Message unavailable' using errcode='42501';
 end if;
 insert into public.crm_conversation_reads as reads(user_id,workspace_id,contact_id,last_read_at)
 values(auth.uid(),ws,target,seen_at)
 on conflict(user_id,contact_id) do update
   set last_read_at=greatest(reads.last_read_at,excluded.last_read_at)
 returning last_read_at into receipt;
 return jsonb_build_object('last_read_at',receipt);
end $$;
revoke all on function public.coco_read_through_message(uuid,uuid,uuid) from public,anon;
grant execute on function public.coco_read_through_message(uuid,uuid,uuid) to authenticated;
