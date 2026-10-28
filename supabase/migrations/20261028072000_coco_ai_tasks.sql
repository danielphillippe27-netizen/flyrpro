-- Keep the existing private/consented message context and include tasks created in the new contact page.
alter function public.crm_ai_context(uuid,text,uuid,timestamptz,timestamptz) rename to crm_ai_context_before_coco_tasks;
revoke all on function public.crm_ai_context_before_coco_tasks(uuid,text,uuid,timestamptz,timestamptz) from public,anon,authenticated;
create function public.crm_ai_context(ws uuid,question text,selected_contact uuid default null,after_date timestamptz default null,before_date timestamptz default null) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;personal_tasks jsonb;
begin
 result:=public.crm_ai_context_before_coco_tasks(ws,question,selected_contact,after_date,before_date);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into personal_tasks from(
 select t.id,t.contact_id,left(t.title,200) title,t.due_at,case when t.completed_at is null then 'pending' else 'done' end status
 from public.crm_person_tasks t join public.contacts c on c.id=t.contact_id and c.user_id=auth.uid() and c.workspace_id=ws
 where t.user_id=auth.uid() and t.workspace_id=ws and t.completed_at is null and (selected_contact is null or t.contact_id=selected_contact)
 and (after_date is null or t.due_at>=after_date) and (before_date is null or t.due_at<=before_date)
 order by (to_tsvector('simple',t.title)@@plainto_tsquery('simple',left(question,500))) desc,t.due_at nulls last,t.id limit 20) t;
 return jsonb_set(result,'{tasks}',coalesce(result->'tasks','[]')||personal_tasks);
end $$;
revoke all on function public.crm_ai_context(uuid,text,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.crm_ai_context(uuid,text,uuid,timestamptz,timestamptz) to authenticated;
