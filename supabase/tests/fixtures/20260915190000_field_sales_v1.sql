-- Customer field sales. Deliberately independent of the internal salesperson pipeline.
BEGIN;
CREATE TABLE public.field_sales_settings (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
 enabled boolean NOT NULL DEFAULT false,
 currency text CHECK (currency IN ('CAD','USD','EUR','GBP','AUD','NZD','JPY','CHF')),
 timezone text,
 team_revenue_visible boolean NOT NULL DEFAULT false
);
CREATE TABLE public.field_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id),
 rep_id uuid NOT NULL REFERENCES auth.users(id),
 campaign_id uuid REFERENCES public.campaigns(id),
 territory_id uuid,
 appointment_id uuid REFERENCES public.contact_activities(id),
 value_minor bigint NOT NULL CHECK (value_minor > 0 AND value_minor <= 9000000000000000),
 currency text NOT NULL,
 sold_on date NOT NULL,
 notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','cancelled')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 verified_by uuid REFERENCES auth.users(id),
 verified_at timestamptz,
 cancellation_reason text,
 replaces_id uuid REFERENCES public.field_sales(id),
 request_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id, created_by, request_id)
);
CREATE UNIQUE INDEX field_sales_active_lead ON public.field_sales(workspace_id, contact_id) WHERE status <> 'cancelled';
CREATE INDEX field_sales_reporting ON public.field_sales(workspace_id, sold_on, rep_id) WHERE status = 'verified';
CREATE TABLE public.field_sales_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sale_id uuid NOT NULL REFERENCES public.field_sales(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL,
 before_record jsonb,
 after_record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.field_sales_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 rep_id uuid REFERENCES auth.users(id),
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 target integer NOT NULL CHECK (target BETWEEN 1 AND 1000000)
);
CREATE UNIQUE INDEX field_sales_personal_goal ON public.field_sales_goals(workspace_id, rep_id, month) WHERE rep_id IS NOT NULL;
CREATE UNIQUE INDEX field_sales_team_goal ON public.field_sales_goals(workspace_id, month) WHERE rep_id IS NULL;
-- Access is exclusively through permission-filtered RPCs; never grant raw table reads.
ALTER TABLE public.field_sales_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_sales_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_sales_settings, public.field_sales, public.field_sales_events, public.field_sales_goals FROM anon, authenticated;

CREATE FUNCTION public.field_sales_role(w uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT role INTO r FROM public.workspace_members WHERE workspace_id=w AND user_id=auth.uid();
 IF r IS NULL THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE='42501'; END IF;
 RETURN r;
END $$;

CREATE FUNCTION public.field_sales_bootstrap(p_workspace uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := public.field_sales_role(p_workspace); cfg public.field_sales_settings;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 RETURN jsonb_build_object('enabled',coalesce(cfg.enabled,false),'role',r,'user_id',auth.uid(),
 'currency',cfg.currency,'timezone',cfg.timezone,'team_revenue_visible',coalesce(cfg.team_revenue_visible,false));
END $$;

CREATE FUNCTION public.field_sales_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := public.field_sales_role(p_workspace); cfg public.field_sales_settings;
 old public.field_sales; sale public.field_sales; c public.contacts; a public.contact_activities;
 sid uuid; rep uuid; m date; event_action text; campaign_data jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) THEN RAISE EXCEPTION 'Sales is not enabled for this workspace'; END IF;
 IF p_action='settings' THEN
  IF r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
  IF (cfg.currency IS NULL OR cfg.timezone IS NULL) AND r<>'owner' THEN RAISE EXCEPTION 'An owner must configure Sales'; END IF;
  IF p_data->>'currency' IS NULL OR p_data->>'timezone' IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_data->>'timezone') THEN RAISE EXCEPTION 'Select a valid currency and timezone'; END IF;
  IF EXISTS(SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace) AND
    (cfg.currency IS DISTINCT FROM p_data->>'currency' OR cfg.timezone IS DISTINCT FROM p_data->>'timezone') THEN RAISE EXCEPTION 'Reporting currency and timezone are locked after the first sale'; END IF;
  UPDATE public.field_sales_settings SET currency=p_data->>'currency',timezone=p_data->>'timezone',
   team_revenue_visible=coalesce((p_data->>'team_revenue_visible')::boolean,false) WHERE workspace_id=p_workspace;
  RETURN public.field_sales_bootstrap(p_workspace);
 END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RAISE EXCEPTION 'An owner must select the reporting currency and timezone'; END IF;
 IF p_action='goal' THEN
  rep := nullif(p_data->>'rep_id','')::uuid;
  IF (rep IS NOT NULL AND rep<>auth.uid()) OR (rep IS NULL AND r NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Only the goal owner can edit personal targets; managers can edit team targets' USING ERRCODE='42501'; END IF;
  IF rep IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=rep) THEN RAISE EXCEPTION 'Invalid representative'; END IF;
  m := (p_data->>'month')::date;
  IF m IS NULL THEN RAISE EXCEPTION 'Month required'; END IF;
  DELETE FROM public.field_sales_goals WHERE workspace_id=p_workspace AND rep_id IS NOT DISTINCT FROM rep AND month=m;
  IF p_data->>'target' IS NOT NULL THEN INSERT INTO public.field_sales_goals(workspace_id,rep_id,month,target) VALUES(p_workspace,rep,m,(p_data->>'target')::integer); END IF;
  RETURN jsonb_build_object('saved',true);
 END IF;
 IF p_action IN ('submit','edit') THEN
  IF p_action='submit' THEN
   IF p_data->>'request_id' IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
   SELECT * INTO sale FROM public.field_sales WHERE workspace_id=p_workspace AND created_by=auth.uid() AND request_id=(p_data->>'request_id')::uuid;
   IF FOUND THEN RETURN jsonb_build_object('id',sale.id,'status',sale.status); END IF;
  ELSE
   SELECT * INTO old FROM public.field_sales WHERE id=(p_data->>'id')::uuid AND workspace_id=p_workspace FOR UPDATE;
   IF NOT FOUND OR old.created_by<>auth.uid() OR old.status<>'pending' THEN RAISE EXCEPTION 'Only your pending submissions can be edited' USING ERRCODE='42501'; END IF;
   IF old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Sale changed; refresh before editing'; END IF;
  END IF;
  SELECT * INTO c FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible lead in this workspace' USING ERRCODE='42501'; END IF;
  IF old.replaces_id IS NOT NULL AND old.contact_id<>c.id THEN RAISE EXCEPTION 'Replacement must retain its original lead'; END IF;
  rep := coalesce(nullif(p_data->>'rep_id','')::uuid,c.user_id);
  IF rep<>auth.uid() AND r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Cannot assign another representative' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=rep) THEN RAISE EXCEPTION 'Invalid representative'; END IF;
  IF c.campaign_id IS NOT NULL THEN
   SELECT to_jsonb(cp) INTO campaign_data FROM public.campaigns cp WHERE cp.id=c.campaign_id AND cp.workspace_id=p_workspace;
   IF NOT FOUND THEN RAISE EXCEPTION 'Lead campaign is outside this workspace'; END IF;
  END IF;
  IF nullif(p_data->>'appointment_id','') IS NOT NULL THEN
   SELECT * INTO a FROM public.contact_activities WHERE id=(p_data->>'appointment_id')::uuid AND contact_id=c.id AND type='meeting';
   IF NOT FOUND OR coalesce(to_jsonb(a)->>'status','') IN ('cancelled','canceled') THEN RAISE EXCEPTION 'Select an active appointment belonging to this lead'; END IF;
   IF a.timestamp > now() OR (a.timestamp AT TIME ZONE cfg.timezone)::date > (p_data->>'sold_on')::date THEN RAISE EXCEPTION 'Appointment must occur before the sale'; END IF;
  END IF;
  IF (p_data->>'sold_on')::date > (now() AT TIME ZONE cfg.timezone)::date OR (p_data->>'sold_on')::date < (c.created_at AT TIME ZONE cfg.timezone)::date THEN RAISE EXCEPTION 'Sale date must be between lead creation and today'; END IF;
  IF nullif(p_data->>'replaces_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.field_sales WHERE id=(p_data->>'replaces_id')::uuid AND workspace_id=p_workspace AND contact_id=c.id AND status='cancelled') THEN RAISE EXCEPTION 'Replacement must reference a cancelled sale for this lead'; END IF;
  IF p_action='submit' THEN
   INSERT INTO public.field_sales(workspace_id,contact_id,rep_id,campaign_id,territory_id,appointment_id,value_minor,currency,sold_on,notes,created_by,request_id,replaces_id)
   VALUES(p_workspace,c.id,rep,c.campaign_id,nullif(campaign_data->>'territory_id','')::uuid,a.id,(p_data->>'value_minor')::bigint,cfg.currency,(p_data->>'sold_on')::date,coalesce(p_data->>'notes',''),auth.uid(),(p_data->>'request_id')::uuid,nullif(p_data->>'replaces_id','')::uuid) RETURNING * INTO sale;
  ELSE
   UPDATE public.field_sales SET contact_id=c.id,rep_id=rep,campaign_id=c.campaign_id,territory_id=nullif(campaign_data->>'territory_id','')::uuid,
    appointment_id=a.id,value_minor=(p_data->>'value_minor')::bigint,sold_on=(p_data->>'sold_on')::date,notes=coalesce(p_data->>'notes',''),version=version+1,updated_at=now()
    WHERE id=old.id RETURNING * INTO sale;
  END IF;
  event_action := p_action;
 ELSIF p_action IN ('verify','cancel') THEN
  IF r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO old FROM public.field_sales WHERE id=(p_data->>'id')::uuid AND workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF p_action='verify' THEN
   IF r<>'owner' AND (old.rep_id=auth.uid() OR old.created_by=auth.uid()) THEN RAISE EXCEPTION 'Only owners can verify their own sales' USING ERRCODE='42501'; END IF;
   IF old.status='verified' THEN RETURN jsonb_build_object('id',old.id,'status',old.status); END IF;
   IF old.status<>'pending' THEN RAISE EXCEPTION 'Cancelled sales cannot be verified'; END IF;
   IF old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Sale changed; refresh before verification'; END IF;
   UPDATE public.field_sales SET status='verified',verified_by=auth.uid(),verified_at=now(),updated_at=now(),version=version+1 WHERE id=old.id RETURNING * INTO sale;
  ELSE
   IF old.status='cancelled' THEN RETURN jsonb_build_object('id',old.id,'status',old.status); END IF;
   IF length(trim(coalesce(p_data->>'reason',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required (maximum 1000 characters)'; END IF;
   UPDATE public.field_sales SET status='cancelled',cancellation_reason=trim(p_data->>'reason'),updated_at=now(),version=version+1 WHERE id=old.id RETURNING * INTO sale;
  END IF;
  event_action := p_action;
 ELSE RAISE EXCEPTION 'Unknown sales operation';
 END IF;
 INSERT INTO public.field_sales_events(workspace_id,sale_id,actor_id,action,before_record,after_record)
 VALUES(p_workspace,sale.id,auth.uid(),event_action,CASE WHEN old.id IS NULL THEN NULL ELSE to_jsonb(old) END,to_jsonb(sale));
 RETURN jsonb_build_object('id',sale.id,'status',sale.status);
END $$;

CREATE FUNCTION public.field_sales_dashboard(p_workspace uuid,p_period text DEFAULT 'month',p_team boolean DEFAULT false,p_rep uuid DEFAULT NULL,p_campaign uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := public.field_sales_role(p_workspace); cfg public.field_sales_settings; who uuid;
 local_now timestamp; end_day date; end_at timestamptz; start_day date; month_day date; week_day date; start_at timestamptz;
 totals jsonb; rows jsonb; ranking jsonb; feed jsonb; options jsonb; result jsonb;
 lc integer; ls integer; ac integer; aps integer; doors integer; conv integer; missing integer;
 target integer; month_sales integer; remaining integer; days integer; coach text; show_money boolean;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF p_period NOT IN ('week','month','previous_week','previous_month','quarter','year') OR (p_status IS NOT NULL AND p_status NOT IN ('pending','verified','cancelled')) THEN RAISE EXCEPTION 'Invalid filter'; END IF;
 IF p_rep IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_rep) THEN RAISE EXCEPTION 'Invalid representative'; END IF;
 who := CASE WHEN p_team THEN p_rep ELSE auth.uid() END;
 show_money := who=auth.uid() OR r IN ('owner','admin') OR cfg.team_revenue_visible;
 local_now := now() AT TIME ZONE cfg.timezone;
 month_day := date_trunc('month',local_now)::date; week_day := date_trunc('week',local_now)::date;
 start_day := CASE p_period WHEN 'week' THEN week_day WHEN 'previous_week' THEN week_day-7
 WHEN 'previous_month' THEN (month_day-interval '1 month')::date WHEN 'quarter' THEN date_trunc('quarter',local_now)::date
 WHEN 'year' THEN date_trunc('year',local_now)::date ELSE month_day END;
 end_day := CASE p_period WHEN 'previous_week' THEN week_day WHEN 'previous_month' THEN month_day ELSE local_now::date+1 END;
 end_at := end_day::timestamp AT TIME ZONE cfg.timezone;
 start_at := start_day::timestamp AT TIME ZONE cfg.timezone;
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'sales',count(*) FILTER(WHERE sold_on>=start_day AND sold_on<end_day),
  'revenue_minor',CASE WHEN show_money THEN coalesce(sum(value_minor) FILTER(WHERE sold_on>=start_day AND sold_on<end_day),0)::text END,
  'weekly_sales',count(*) FILTER(WHERE sold_on>=week_day),
  'weekly_revenue_minor',CASE WHEN show_money THEN coalesce(sum(value_minor) FILTER(WHERE sold_on>=week_day),0)::text END,
  'monthly_sales',count(*) FILTER(WHERE sold_on>=month_day),
  'monthly_revenue_minor',CASE WHEN show_money THEN coalesce(sum(value_minor) FILTER(WHERE sold_on>=month_day),0)::text END
 )) INTO totals FROM public.field_sales WHERE workspace_id=p_workspace AND status='verified'
 AND sold_on>=least(start_day,month_day,week_day) AND sold_on<=local_now::date AND (who IS NULL OR rep_id=who) AND (p_campaign IS NULL OR campaign_id=p_campaign);
 SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC),'[]'::jsonb) INTO rows FROM (
 SELECT s.created_at,jsonb_strip_nulls(jsonb_build_object('id',s.id,'rep_id',s.rep_id,'rep_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
 'status',s.status,'sold_on',s.sold_on,'version',s.version,'campaign_id',s.campaign_id,'territory_id',s.territory_id,
 'value_minor',CASE WHEN show_money THEN s.value_minor::text END,'currency',s.currency,
 'contact_id',CASE WHEN s.created_by=auth.uid() THEN s.contact_id END,'appointment_id',CASE WHEN s.created_by=auth.uid() THEN s.appointment_id END,
 'notes',CASE WHEN s.created_by=auth.uid() OR r IN ('owner','admin') THEN s.notes END,
 'cancellation_reason',CASE WHEN s.created_by=auth.uid() OR r IN ('owner','admin') THEN s.cancellation_reason END,
 'can_edit',s.status='pending' AND s.created_by=auth.uid(),
 'can_verify',s.status='pending' AND (r='owner' OR (r='admin' AND s.rep_id<>auth.uid() AND s.created_by<>auth.uid())),
 'can_cancel',s.status<>'cancelled' AND r IN ('owner','admin'))) AS item
 FROM public.field_sales s JOIN auth.users u ON u.id=s.rep_id WHERE s.workspace_id=p_workspace
 AND (who IS NULL OR s.rep_id=who) AND (p_campaign IS NULL OR s.campaign_id=p_campaign)
 AND (p_status IS NULL OR s.status=p_status) AND ((s.sold_on>=start_day AND s.sold_on<end_day) OR (p_status='pending'))
 AND (s.status='verified' OR s.created_by=auth.uid() OR r IN ('owner','admin')) ORDER BY s.created_at DESC LIMIT 200) q;
 SELECT coalesce(jsonb_agg(item ORDER BY n DESC,rep_id),'[]'::jsonb) INTO ranking FROM (
 SELECT wm.user_id rep_id,count(s.id) n,jsonb_strip_nulls(jsonb_build_object('rep_id',wm.user_id,'rep_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
 'sales',count(s.id),'revenue_minor',CASE WHEN r IN ('owner','admin') OR cfg.team_revenue_visible THEN coalesce(sum(s.value_minor),0)::text END)) item
 FROM public.workspace_members wm JOIN auth.users u ON u.id=wm.user_id LEFT JOIN public.field_sales s ON s.rep_id=wm.user_id AND s.workspace_id=wm.workspace_id
 AND s.status='verified' AND s.sold_on>=start_day AND s.sold_on<end_day AND s.sold_on<=local_now::date AND (p_campaign IS NULL OR s.campaign_id=p_campaign)
 WHERE wm.workspace_id=p_workspace GROUP BY wm.user_id,u.raw_user_meta_data) q;
 SELECT coalesce(jsonb_agg(item ORDER BY verified_at DESC),'[]'::jsonb) INTO feed FROM (
 SELECT s.verified_at,jsonb_strip_nulls(jsonb_build_object('id',s.id,'rep_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
 'sold_on',s.sold_on,'value_minor',CASE WHEN cfg.team_revenue_visible OR r IN ('owner','admin') THEN s.value_minor::text END)) item
 FROM public.field_sales s JOIN auth.users u ON u.id=s.rep_id WHERE s.workspace_id=p_workspace AND s.status='verified' AND s.sold_on>=start_day AND s.sold_on<end_day AND (p_campaign IS NULL OR s.campaign_id=p_campaign) ORDER BY s.verified_at DESC LIMIT 20) q;
 -- Cohorts use distinct source records, not unrelated period totals.
 SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.field_sales s WHERE s.contact_id=c.id AND s.workspace_id=p_workspace AND s.status='verified' AND (who IS NULL OR s.rep_id=who)))
 INTO lc,ls FROM public.contacts c WHERE c.workspace_id=p_workspace AND (who IS NULL OR c.user_id=who)
 AND coalesce(to_jsonb(c)->>'lead_kind','field')='field' AND c.created_at>=start_at AND c.created_at<end_at AND c.created_at<=now() AND (p_campaign IS NULL OR c.campaign_id=p_campaign);
 SELECT count(*),count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.field_sales s WHERE s.appointment_id=a.id AND s.workspace_id=p_workspace AND s.status='verified' AND (who IS NULL OR s.rep_id=who)))
 INTO ac,aps FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id WHERE c.workspace_id=p_workspace AND (who IS NULL OR c.user_id=who)
 AND a.type='meeting' AND a.timestamp>=start_at AND a.timestamp<end_at AND a.timestamp<=now() AND coalesce(to_jsonb(a)->>'status','') NOT IN ('cancelled','canceled') AND (p_campaign IS NULL OR c.campaign_id=p_campaign);
 SELECT count(*) INTO missing FROM public.field_sales WHERE workspace_id=p_workspace AND status='verified' AND appointment_id IS NULL AND sold_on>=start_day AND sold_on<end_day AND (who IS NULL OR rep_id=who) AND (p_campaign IS NULL OR campaign_id=p_campaign);
 WITH visits AS (
 SELECT DISTINCT ON (e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text)) e.*
 FROM public.session_events e JOIN public.sessions s ON s.id=e.session_id WHERE s.workspace_id=p_workspace AND (who IS NULL OR s.user_id=who)
 AND (p_campaign IS NULL OR s.campaign_id=p_campaign) AND e.created_at>=start_at AND e.created_at<end_at AND e.created_at<=now()
 AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
 ORDER BY e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text),e.created_at DESC,e.id DESC)
 SELECT count(*),count(*) FILTER(WHERE event_type='conversation' AND coalesce(metadata->>'address_status',outcome,'') NOT IN ('no_answer','noAnswer','do_not_knock','doNotKnock')) INTO doors,conv FROM visits WHERE event_type<>'completion_undone';
 SELECT g.target INTO target FROM public.field_sales_goals g WHERE workspace_id=p_workspace AND rep_id IS NOT DISTINCT FROM who AND month=month_day;
 -- Goals are workspace-wide, even when a campaign filter is selected.
 SELECT count(*) INTO month_sales FROM public.field_sales WHERE workspace_id=p_workspace AND status='verified' AND sold_on>=month_day AND sold_on<=local_now::date AND (who IS NULL OR rep_id=who);
 remaining := greatest(0,coalesce(target,0)-month_sales); days := ((month_day+interval '1 month')::date-local_now::date);
 coach := CASE WHEN target IS NOT NULL AND remaining=0 THEN 'Your monthly sales target is reached. Review your follow-ups for the next opportunity.'
 WHEN target IS NOT NULL THEN format('%s verified sales remain to reach your monthly target. Aim for %s per day, including today.',remaining,ceil(remaining::numeric/greatest(1,days)))
 ELSE 'Set a monthly sales target and review your open leads.' END;
 IF ac>=10 AND missing=0 AND aps::numeric/ac<0.3 THEN coach := format('%s of %s appointments in this cohort have a verified sale. Review appointment follow-ups. ',aps,ac)||coach;
 ELSIF lc>=10 AND ls::numeric/lc<0.1 THEN coach := format('%s of %s leads in this cohort have a verified sale. Review open leads and their next steps. ',ls,lc)||coach; END IF;
 SELECT jsonb_build_object(
 'leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name,'campaign_id',c.campaign_id)) FROM public.contacts c WHERE c.workspace_id=p_workspace AND c.user_id=auth.uid()),'[]'::jsonb),
 'appointments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'contact_id',a.contact_id,'scheduled_at',a.timestamp)) FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id WHERE c.workspace_id=p_workspace AND c.user_id=auth.uid() AND a.type='meeting' AND a.timestamp<=now() AND coalesce(to_jsonb(a)->>'status','') NOT IN ('cancelled','canceled')),'[]'::jsonb),
 'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',cp.id,'name',cp.name)) FROM public.campaigns cp WHERE cp.workspace_id=p_workspace),'[]'::jsonb)) INTO options;
 result := public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',false,'period',p_period,'period_start',start_day,'period_end',end_day-1,'as_of',now(),'today',local_now::date,'month',month_day,
 'totals',totals,'sales',rows,'list_limit',200,'ranking',ranking,'feed',feed,'options',options,
 'goal',jsonb_build_object('target',target,'completed',month_sales,'remaining',CASE WHEN target IS NOT NULL THEN remaining END),
 'metrics',jsonb_build_object('doors',doors,'conversations',conv,'leads',lc,'appointments',ac,'lead_converted',ls,'appointment_converted',CASE WHEN missing=0 THEN aps END,
 'unlinked_sales',missing,'sales_per_100_doors',CASE WHEN doors>0 THEN round((totals->>'sales')::numeric*100/doors,2) END),'coaching',coach);
 RETURN result;
END $$;

CREATE FUNCTION public.field_sales_history(p_workspace uuid,p_sale uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text := public.field_sales_role(p_workspace); s public.field_sales; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=p_workspace AND enabled) THEN RAISE EXCEPTION 'Sales is not enabled' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.field_sales WHERE id=p_sale AND workspace_id=p_workspace;
 IF s.id IS NULL OR (s.created_by<>auth.uid() AND r NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Sale history access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'created_at',e.created_at,
 'actor',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
 'status',e.after_record->>'status','value_minor',e.after_record->>'value_minor','currency',e.after_record->>'currency',
 'sold_on',e.after_record->>'sold_on','version',e.after_record->'version','reason',e.after_record->>'cancellation_reason') ORDER BY e.created_at,e.id),'[]'::jsonb)
 INTO result FROM public.field_sales_events e JOIN auth.users u ON u.id=e.actor_id WHERE e.workspace_id=p_workspace AND e.sale_id=p_sale;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_history(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_history(uuid,uuid) TO authenticated;

-- Private helpers cannot be invoked directly by clients.
REVOKE ALL ON FUNCTION public.field_sales_role(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.field_sales_bootstrap(uuid),public.field_sales_command(uuid,text,jsonb),public.field_sales_dashboard(uuid,text,boolean,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_bootstrap(uuid),public.field_sales_command(uuid,text,jsonb),public.field_sales_dashboard(uuid,text,boolean,uuid,uuid,text) TO authenticated;
COMMIT;
