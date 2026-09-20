-- Period goals use the same verified sales, cash ledger and source activity as reports.
BEGIN;
CREATE TABLE public.field_sales_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 scope text NOT NULL CHECK(scope IN ('rep','team','workspace','campaign')), scope_id uuid,
 metric text NOT NULL CHECK(metric IN ('doors','conversations','leads','appointments','sales','sold_value','collected_revenue','commission','close_rate','appointments_converted')),
 target numeric NOT NULL CHECK(target>0 AND target<=9000000000000000),
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on AND ends_on-starts_on<=3660),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
 archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL, request_payload jsonb NOT NULL,
 CHECK((scope='workspace')=(scope_id IS NULL)),
 CHECK((metric='close_rate' AND target<=100 AND target=round(target,2)) OR (metric<>'close_rate' AND target=trunc(target))),
 UNIQUE(workspace_id,request_id)
);
CREATE UNIQUE INDEX field_sales_target_period ON public.field_sales_targets(workspace_id,scope,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid),metric,starts_on,ends_on) WHERE NOT archived;
CREATE INDEX field_sales_target_lookup ON public.field_sales_targets(workspace_id,scope,scope_id,ends_on) WHERE NOT archived;
CREATE TABLE public.field_sales_target_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 target_id uuid NOT NULL REFERENCES public.field_sales_targets(id),actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('created','updated','archived','restored')),before_record jsonb,after_record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.field_sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_target_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_sales_targets,public.field_sales_target_events FROM anon,authenticated;

CREATE FUNCTION public.field_sales_target_access(w uuid,s text,sid uuid,m text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF s IS DISTINCT FROM 'rep' OR sid IS DISTINCT FROM auth.uid() THEN
  IF NOT public.field_sales_permission(w,'team_details') THEN RETURN false; END IF;
 END IF;
 IF m='commission' THEN RETURN public.field_sales_permission(w,'commission'); END IF;
 IF m IN ('sold_value','collected_revenue') THEN
  RETURN public.field_sales_permission(w,CASE WHEN s='rep' AND sid=auth.uid() THEN 'own_revenue' ELSE 'team_revenue' END);
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.field_sales_target_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_name text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings;
 old public.field_sales_targets; g public.field_sales_targets; s text; sid uuid; m text; req uuid;
BEGIN
 -- Serialize creation retries against the workspace row, including requests with identical IDs.
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) OR cfg.timezone IS NULL OR cfg.currency IS NULL THEN RAISE EXCEPTION 'Set up Sales before creating goals'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','update','archive','restore') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid goal command'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('id','version','request_id','scope','scope_id','metric','target','starts_on','ends_on','title')) THEN RAISE EXCEPTION 'Unknown goal field'; END IF;
 IF p_action='create' THEN
  req:=(p_data->>'request_id')::uuid;
  IF req IS NULL THEN RAISE EXCEPTION 'Goal request ID required'; END IF;
  SELECT * INTO old FROM public.field_sales_targets WHERE workspace_id=p_workspace AND request_id=req;
  IF FOUND THEN
   IF old.created_by<>auth.uid() OR NOT public.field_sales_target_access(p_workspace,old.scope,old.scope_id,old.metric) THEN RAISE EXCEPTION 'Goal access required' USING ERRCODE='42501'; END IF;
   IF old.request_payload<>p_data THEN RAISE EXCEPTION 'Goal request ID already used for different data'; END IF;
   RETURN jsonb_build_object('id',old.id,'version',old.version);
  END IF;
  s:=p_data->>'scope';sid:=nullif(p_data->>'scope_id','')::uuid;m:=p_data->>'metric';
 ELSE
  SELECT * INTO old FROM public.field_sales_targets WHERE workspace_id=p_workspace AND id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT public.field_sales_target_access(p_workspace,old.scope,old.scope_id,old.metric) THEN RAISE EXCEPTION 'Goal access required' USING ERRCODE='42501'; END IF;
  IF old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Goal changed; refresh before editing'; END IF;
  s:=old.scope;sid:=old.scope_id;m:=old.metric;
  IF p_data ? 'scope' OR p_data ? 'scope_id' OR p_data ? 'metric' OR p_data ? 'request_id' THEN RAISE EXCEPTION 'Create a new goal to change scope or metric'; END IF;
 END IF;
 IF s IS NULL OR s NOT IN ('rep','team','workspace','campaign') OR m IS NULL OR m NOT IN ('doors','conversations','leads','appointments','sales','sold_value','collected_revenue','commission','close_rate','appointments_converted') THEN RAISE EXCEPTION 'Invalid goal scope or metric'; END IF;
 IF (s='workspace') IS DISTINCT FROM (sid IS NULL) THEN RAISE EXCEPTION 'Invalid goal scope ID'; END IF;
 IF s='rep' AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=sid) THEN RAISE EXCEPTION 'Representative unavailable'; END IF;
 IF s='team' AND NOT EXISTS(SELECT 1 FROM public.field_sales_teams WHERE workspace_id=p_workspace AND id=sid) THEN RAISE EXCEPTION 'Team unavailable'; END IF;
 IF s='campaign' AND NOT EXISTS(SELECT 1 FROM public.campaigns WHERE workspace_id=p_workspace AND id=sid) THEN RAISE EXCEPTION 'Campaign unavailable'; END IF;
 IF NOT public.field_sales_target_access(p_workspace,s,sid,m) THEN RAISE EXCEPTION 'Goal permission required' USING ERRCODE='42501'; END IF;
 IF p_action='create' THEN
  INSERT INTO public.field_sales_targets(workspace_id,scope,scope_id,metric,target,starts_on,ends_on,title,created_by,request_id,request_payload)
  VALUES(p_workspace,s,sid,m,(p_data->>'target')::numeric,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,trim(p_data->>'title'),auth.uid(),req,p_data) RETURNING * INTO g;
 ELSIF p_action='update' THEN
  UPDATE public.field_sales_targets SET target=coalesce((p_data->>'target')::numeric,target),starts_on=coalesce((p_data->>'starts_on')::date,starts_on),
   ends_on=coalesce((p_data->>'ends_on')::date,ends_on),title=coalesce(trim(p_data->>'title'),title),version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO g;
 ELSE
  UPDATE public.field_sales_targets SET archived=(p_action='archive'),version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO g;
 END IF;
 INSERT INTO public.field_sales_target_events(workspace_id,target_id,actor_id,action,before_record,after_record)
 VALUES(p_workspace,g.id,auth.uid(),CASE p_action WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' WHEN 'archive' THEN 'archived' ELSE 'restored' END,
  CASE WHEN old.id IS NOT NULL THEN to_jsonb(old)-'request_payload' END,to_jsonb(g)-'request_payload');
 RETURN jsonb_build_object('id',g.id,'version',g.version);
END $$;

-- Pure pacing helper allows precise boundary testing without changing the server clock.
CREATE FUNCTION public.field_sales_target_pace(actual numeric,target numeric,first_day date,last_day date,zone text,as_of timestamptz,is_rate boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH d AS (SELECT (last_day-first_day+1)::numeric total,
  greatest(0,least((last_day-first_day+1)::numeric,((as_of AT TIME ZONE zone)::date-first_day)::numeric+
   extract(epoch FROM (as_of AT TIME ZONE zone)::time)/86400)) elapsed,
  greatest(0,last_day-greatest(first_day,(as_of AT TIME ZONE zone)::date)+1)::numeric remaining_days),
 n AS (SELECT *,greatest(0,target-actual) remaining FROM d)
 SELECT jsonb_strip_nulls(jsonb_build_object('actual',actual::text,'target',target::text,'remaining',remaining::text,
  'progress_percent',round(actual*100/target,2)::text,'days_remaining',remaining_days,
  'expected_to_date',CASE WHEN NOT is_rate THEN round(target*elapsed/total,2)::text END,
  'pace',CASE WHEN actual>=target THEN 'reached' WHEN elapsed=0 THEN 'not_started' WHEN elapsed=total THEN 'ended' WHEN is_rate THEN 'below_target' WHEN actual>=target*elapsed/total THEN 'ahead' ELSE 'behind' END,
  'required_daily',CASE WHEN NOT is_rate AND remaining_days>0 THEN ceil(remaining/remaining_days)::text END,
  'required_weekly',CASE WHEN NOT is_rate AND remaining_days>0 THEN ceil(remaining*least(7,remaining_days)/remaining_days)::text END,
  'projected',CASE WHEN NOT is_rate AND elapsed>=7 AND actual>=0 THEN round(actual*total/elapsed)::text END,
  'projection_note',CASE WHEN NOT is_rate THEN 'Linear pace estimate after seven elapsed days; not a promise or pipeline prediction.' ELSE 'Rate targets use percentage points; daily unit pacing is not applicable.' END)) FROM n;
$$;

CREATE FUNCTION public.field_sales_target_progress(g public.field_sales_targets,zone text,min_sample integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f jsonb:='{}'; actual numeric:=0; n bigint; wins bigint; summary jsonb; payload jsonb;
BEGIN
 IF g.scope<>'workspace' THEN f:=jsonb_build_object(CASE g.scope WHEN 'rep' THEN 'rep' WHEN 'team' THEN 'team' ELSE 'campaign' END,g.scope_id); END IF;
 IF g.metric IN ('sales','sold_value','collected_revenue') THEN
  summary:=public.field_sales_financial_summary(g.workspace_id,f,g.starts_on,g.ends_on+1,zone,true);
  actual:=(summary->>CASE g.metric WHEN 'sales' THEN 'sales' WHEN 'sold_value' THEN 'sold_value_minor' ELSE 'collected_revenue_minor' END)::numeric;
 ELSIF g.metric='commission' THEN
  SELECT coalesce(sum(public.field_sales_credit_amount(id,CASE WHEN g.scope='rep' THEN g.scope_id END,commission_minor)),0) INTO actual
  FROM public.field_sales_report_scope(g.workspace_id,f) WHERE status='verified' AND sold_on BETWEEN g.starts_on AND g.ends_on AND sold_on<=(now() AT TIME ZONE zone)::date;
 ELSE
  SELECT count(*),count(*) FILTER(WHERE converted) INTO n,wins FROM public.field_sales_activity_rows(g.workspace_id,f,g.starts_on,g.ends_on+1,zone,
   CASE WHEN g.metric IN ('close_rate','appointments_converted') THEN 'appointments_completed' ELSE g.metric END);
  actual:=CASE WHEN g.metric='close_rate' THEN CASE WHEN n>=min_sample THEN round(wins::numeric*100/n,2) END WHEN g.metric='appointments_converted' THEN wins ELSE n END;
 END IF;
 payload:=jsonb_build_object('id',g.id,'version',g.version,'title',g.title,'scope',g.scope,'scope_id',g.scope_id,'metric',g.metric,
  'starts_on',g.starts_on,'ends_on',g.ends_on,'archived',g.archived,'unit',CASE WHEN g.metric IN ('sold_value','collected_revenue','commission') THEN 'money' WHEN g.metric='close_rate' THEN 'percent' ELSE 'count' END,
  'target',g.target::text,'evidence_count',n,'minimum_evidence',CASE WHEN g.metric='close_rate' THEN min_sample END);
 IF actual IS NULL THEN RETURN payload||jsonb_build_object('actual',null,'pace','insufficient_evidence'); END IF;
 RETURN payload||public.field_sales_target_pace(actual,g.target,g.starts_on,g.ends_on,zone,now(),g.metric='close_rate');
END $$;

CREATE FUNCTION public.field_sales_target_list(p_workspace uuid,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace);cfg public.field_sales_settings;f jsonb:=coalesce(p_filter,'{}');rows jsonb;total bigint;
 lim integer:=coalesce((f->>'limit')::integer,50);off integer:=coalesce((f->>'offset')::integer,0);
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.timezone IS NULL OR cfg.currency IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR lim NOT BETWEEN 1 AND 100 OR off NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid goal filter'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('scope','scope_id','archived','limit','offset')) THEN RAISE EXCEPTION 'Unknown goal filter'; END IF;
 IF f ? 'scope' AND f->>'scope' NOT IN ('rep','team','workspace','campaign') THEN RAISE EXCEPTION 'Invalid goal scope'; END IF;
 SELECT count(*) INTO total FROM public.field_sales_targets g WHERE workspace_id=p_workspace
  AND archived=coalesce((f->>'archived')::boolean,false) AND (nullif(f->>'scope','') IS NULL OR scope=f->>'scope')
  AND (nullif(f->>'scope_id','') IS NULL OR scope_id=(f->>'scope_id')::uuid) AND public.field_sales_target_access(p_workspace,scope,scope_id,metric);
 SELECT coalesce(jsonb_agg(public.field_sales_target_progress(g,cfg.timezone,cfg.minimum_close_opportunities) ORDER BY g.ends_on,g.id),'[]') INTO rows
 FROM (SELECT * FROM public.field_sales_targets WHERE workspace_id=p_workspace
  AND archived=coalesce((f->>'archived')::boolean,false) AND (nullif(f->>'scope','') IS NULL OR scope=f->>'scope')
  AND (nullif(f->>'scope_id','') IS NULL OR scope_id=(f->>'scope_id')::uuid) AND public.field_sales_target_access(p_workspace,scope,scope_id,metric)
  ORDER BY ends_on,id LIMIT lim OFFSET off) g;
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('goals',rows,'total_records',total,'has_more',off+lim<total,
  'goal_permissions',jsonb_build_object('manage_team',public.field_sales_permission(p_workspace,'team_details'),'own_revenue',public.field_sales_permission(p_workspace,'own_revenue'),'team_revenue',public.field_sales_permission(p_workspace,'team_revenue'),'commission',public.field_sales_permission(p_workspace,'commission')),
  'goal_options',jsonb_build_object(
   'representatives',coalesce((SELECT jsonb_agg(jsonb_build_object('id',wm.user_id,'name',coalesce(u.raw_user_meta_data->>'full_name','Representative'))) FROM public.workspace_members wm JOIN auth.users u ON u.id=wm.user_id WHERE wm.workspace_id=p_workspace AND (wm.user_id=auth.uid() OR public.field_sales_permission(p_workspace,'team_details'))),'[]'),
   'teams',CASE WHEN public.field_sales_permission(p_workspace,'team_details') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.field_sales_teams WHERE workspace_id=p_workspace),'[]') ELSE '[]'::jsonb END,
   'campaigns',CASE WHEN public.field_sales_permission(p_workspace,'team_details') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.campaigns WHERE workspace_id=p_workspace),'[]') ELSE '[]'::jsonb END),
  'goal_periods',(SELECT jsonb_agg(jsonb_build_object('key',x,'start',date_trunc(x,now() AT TIME ZONE cfg.timezone)::date,'end',(date_trunc(x,now() AT TIME ZONE cfg.timezone)+CASE x WHEN 'week' THEN interval '1 week' WHEN 'month' THEN interval '1 month' ELSE interval '3 months' END-interval '1 day')::date)) FROM unnest(ARRAY['week','month','quarter']) x),
  'definitions','Sales and sold value use eligible verified contracts. Rep money uses allocated credit; company money counts once. Collections use payment timestamps. Activity uses source owners. Converted appointment goals follow completed appointment cohorts through today.');
END $$;
REVOKE ALL ON FUNCTION public.field_sales_target_access(uuid,text,uuid,text),public.field_sales_target_pace(numeric,numeric,date,date,text,timestamptz,boolean),public.field_sales_target_progress(public.field_sales_targets,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.field_sales_target_command(uuid,text,jsonb),public.field_sales_target_list(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_target_command(uuid,text,jsonb),public.field_sales_target_list(uuid,jsonb) TO authenticated;
COMMIT;
