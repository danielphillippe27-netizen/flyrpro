-- Public customer opportunity pipeline. Financial credit remains exclusive to verified field_sales.
BEGIN;
CREATE TABLE public.field_sales_stages (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_]{0,39}$'),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 60), position integer NOT NULL CHECK(position BETWEEN 0 AND 100),
 probability integer NOT NULL DEFAULT 0 CHECK(probability BETWEEN 0 AND 100), kind text NOT NULL DEFAULT 'open' CHECK(kind IN ('open','won','lost')),
 PRIMARY KEY(workspace_id,key)
);
CREATE TABLE public.field_sales_opportunities (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), contact_id uuid NOT NULL REFERENCES public.contacts(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), stage_key text NOT NULL, expected_value_minor bigint CHECK(expected_value_minor BETWEEN 0 AND 9000000000000000),
 expected_close date, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,contact_id),
 FOREIGN KEY(workspace_id,stage_key) REFERENCES public.field_sales_stages(workspace_id,key)
);
CREATE TABLE public.field_sales_tasks (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id), contact_id uuid NOT NULL REFERENCES public.contacts(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('call','email','text','visit','task')), due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')), completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX field_sales_tasks_due ON public.field_sales_tasks(workspace_id,user_id,status,due_at);
CREATE TABLE public.field_sales_pipeline_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id), actor_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL,
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.field_sales_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_pipeline_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_sales_stages,public.field_sales_opportunities,public.field_sales_tasks,public.field_sales_pipeline_events FROM anon,authenticated;

CREATE FUNCTION public.field_sales_pipeline_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; c public.contacts;
 o public.field_sales_opportunities; t public.field_sales_tasks; st public.field_sales_stages; result jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) OR cfg.currency IS NULL OR cfg.timezone IS NULL THEN RAISE EXCEPTION 'Set up Sales before using the pipeline'; END IF;
 IF p_action='stage' THEN
  IF r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind)
  VALUES(p_workspace,p_data->>'key',trim(p_data->>'label'),(p_data->>'position')::integer,(p_data->>'probability')::integer,p_data->>'kind')
  ON CONFLICT(workspace_id,key) DO UPDATE SET label=excluded.label,position=excluded.position,probability=excluded.probability,kind=excluded.kind RETURNING * INTO st;
  RETURN to_jsonb(st);
 END IF;
 IF p_action='task_status' THEN
  SELECT * INTO t FROM public.field_sales_tasks WHERE id=(p_data->>'id')::uuid AND workspace_id=p_workspace AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=t.contact_id AND workspace_id=p_workspace AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Task access required' USING ERRCODE='42501'; END IF;
  IF p_data->>'status' NOT IN ('pending','done','cancelled') OR p_data->>'status' IS NULL THEN RAISE EXCEPTION 'Invalid task status'; END IF;
  IF t.status=p_data->>'status' THEN RETURN to_jsonb(t); END IF;
  IF t.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Task changed; refresh before updating'; END IF;
  UPDATE public.field_sales_tasks SET status=p_data->>'status',completed_at=CASE WHEN p_data->>'status'='done' THEN now() END,version=version+1 WHERE id=t.id RETURNING * INTO t;
  INSERT INTO public.field_sales_pipeline_events(workspace_id,contact_id,actor_id,action,detail) VALUES(p_workspace,t.contact_id,auth.uid(),p_action,to_jsonb(t));
  RETURN to_jsonb(t);
 END IF;
 SELECT * INTO c FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Select your own workspace lead' USING ERRCODE='42501'; END IF;
 IF coalesce(to_jsonb(c)->>'lead_kind','field')<>'field' THEN RAISE EXCEPTION 'Select a field lead'; END IF;
 IF p_action='opportunity' THEN
  SELECT * INTO o FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=c.id FOR UPDATE;
  IF o.contact_id IS NOT NULL AND (o.user_id<>auth.uid() OR o.version IS DISTINCT FROM (p_data->>'version')::integer) THEN RAISE EXCEPTION 'Opportunity changed or unavailable; refresh before editing'; END IF;
  INSERT INTO public.field_sales_opportunities(workspace_id,contact_id,user_id,stage_key,expected_value_minor,expected_close,notes)
  VALUES(p_workspace,c.id,auth.uid(),p_data->>'stage_key',nullif(p_data->>'expected_value_minor','')::bigint,nullif(p_data->>'expected_close','')::date,coalesce(p_data->>'notes',''))
  ON CONFLICT(workspace_id,contact_id) DO UPDATE SET stage_key=excluded.stage_key,expected_value_minor=excluded.expected_value_minor,expected_close=excluded.expected_close,notes=excluded.notes,version=field_sales_opportunities.version+1,updated_at=now() RETURNING to_jsonb(field_sales_opportunities.*) INTO result;
 ELSIF p_action='task' THEN
  SELECT * INTO t FROM public.field_sales_tasks WHERE id=(p_data->>'id')::uuid;
  IF FOUND THEN
   IF t.workspace_id<>p_workspace OR t.user_id<>auth.uid() OR t.contact_id<>c.id THEN RAISE EXCEPTION 'Task request unavailable' USING ERRCODE='42501'; END IF;
   RETURN to_jsonb(t);
  END IF;
  INSERT INTO public.field_sales_tasks(id,workspace_id,contact_id,user_id,title,kind,due_at)
  VALUES((p_data->>'id')::uuid,p_workspace,c.id,auth.uid(),trim(p_data->>'title'),p_data->>'kind',(p_data->>'due_at')::timestamptz) RETURNING to_jsonb(field_sales_tasks.*) INTO result;
 ELSE RAISE EXCEPTION 'Unknown pipeline operation'; END IF;
 INSERT INTO public.field_sales_pipeline_events(workspace_id,contact_id,actor_id,action,detail) VALUES(p_workspace,c.id,auth.uid(),p_action,result);
 RETURN result;
END $$;

CREATE FUNCTION public.field_sales_workbench(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; stages jsonb; opportunities jsonb; tasks jsonb; summary jsonb; leads jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
 (p_workspace,'new','New',0,0,'open'),(p_workspace,'qualified','Qualified',1,25,'open'),(p_workspace,'appointment','Appointment',2,50,'open'),
 (p_workspace,'proposal','Proposal',3,75,'open'),(p_workspace,'won','Won',4,100,'won'),(p_workspace,'lost','Lost',5,0,'lost') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY position,key) INTO stages FROM public.field_sales_stages s WHERE workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('contact_name',c.full_name,'expected_value_minor',o.expected_value_minor::text) ORDER BY o.updated_at DESC),'[]'::jsonb)
 INTO opportunities FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND c.user_id=auth.uid()
 WHERE o.workspace_id=p_workspace AND o.user_id=auth.uid();
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('contact_name',c.full_name) ORDER BY t.due_at),'[]'::jsonb) INTO tasks
 FROM public.field_sales_tasks t JOIN public.contacts c ON c.id=t.contact_id AND c.workspace_id=t.workspace_id AND c.user_id=auth.uid()
 WHERE t.workspace_id=p_workspace AND t.user_id=auth.uid() AND (t.status='pending' OR t.completed_at>now()-interval '30 days');
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',s.key,'label',s.label,'kind',s.kind,'count',q.n,'missing_values',q.missing,
 'value_minor',CASE WHEN r IN ('owner','admin') OR cfg.team_revenue_visible THEN q.value::text END,
 'weighted_minor',CASE WHEN r IN ('owner','admin') OR cfg.team_revenue_visible THEN q.weighted::text END)) ORDER BY s.position,s.key) INTO summary
 FROM public.field_sales_stages s CROSS JOIN LATERAL (SELECT count(*) n,count(*) FILTER(WHERE expected_value_minor IS NULL) missing,coalesce(sum(expected_value_minor),0) value,
 coalesce(sum(expected_value_minor::numeric*s.probability/100),0)::bigint weighted FROM public.field_sales_opportunities o WHERE o.workspace_id=p_workspace AND o.stage_key=s.key) q WHERE s.workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name),'[]'::jsonb) INTO leads FROM public.contacts c WHERE workspace_id=p_workspace AND user_id=auth.uid() AND coalesce(to_jsonb(c)->>'lead_kind','field')='field';
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',false,'stages',stages,'opportunities',opportunities,'tasks',tasks,'summary',summary,'leads',leads,'as_of',now());
END $$;
REVOKE ALL ON FUNCTION public.field_sales_workbench(uuid),public.field_sales_pipeline_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_workbench(uuid),public.field_sales_pipeline_command(uuid,text,jsonb) TO authenticated;
COMMIT;
