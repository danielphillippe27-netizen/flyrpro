-- Public Pro Sales foundation. Additive upgrade; do not change internal WolfGridSales.
BEGIN;

ALTER TABLE public.field_sales_settings
 ADD COLUMN verification_required boolean NOT NULL DEFAULT true,
 ADD COLUMN rep_revenue_visible boolean NOT NULL DEFAULT true,
 ADD COLUMN minimum_close_opportunities integer NOT NULL DEFAULT 10 CHECK (minimum_close_opportunities BETWEEN 1 AND 1000),
 ADD COLUMN industry text NOT NULL DEFAULT 'home_services' CHECK (industry IN ('home_services','solar','real_estate','other')),
 ADD COLUMN terminology jsonb NOT NULL DEFAULT '{"sale":"Sale","sold_value":"Sold value","average_ticket":"Average ticket"}',
 ADD COLUMN permissions jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN feed_options jsonb NOT NULL DEFAULT '{"enabled":true,"rep_names":true,"contract_values":false,"campaign_names":true,"territory_names":true}',
 ADD COLUMN notification_options jsonb NOT NULL DEFAULT '{"sale.created":true,"sale.cancelled":true,"goal.reached":true,"opportunity.stale":true}',
 ADD COLUMN featured_ranking text NOT NULL DEFAULT 'sold_value' CHECK (featured_ranking IN ('sales','sold_value','collected_revenue'));

CREATE TABLE public.field_sales_teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100), archived_at timestamptz,
 UNIQUE(workspace_id,id)
);
CREATE TABLE public.field_sales_team_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 team_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id),
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
 FOREIGN KEY(workspace_id,team_id) REFERENCES public.field_sales_teams(workspace_id,id),
 CHECK (ends_at IS NULL OR ends_at>starts_at)
);
CREATE UNIQUE INDEX field_sales_one_current_team ON public.field_sales_team_memberships(workspace_id,user_id) WHERE ends_at IS NULL;
ALTER TABLE public.field_sales_opportunities
 ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 ADD COLUMN loss_reason text CHECK (loss_reason IN ('price','competitor','no_decision','unable_to_contact','financing','timing','not_qualified','cancelled','other')),
 ADD COLUMN loss_note text NOT NULL DEFAULT '' CHECK (length(loss_note)<=4000),
 ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN created_at timestamptz;
-- Preserve known creation evidence for existing opportunities; do not invent migration-time production.
UPDATE public.field_sales_opportunities o SET created_at=(SELECT min(e.created_at) FROM public.field_sales_pipeline_events e
 WHERE e.workspace_id=o.workspace_id AND e.contact_id=o.contact_id AND e.action='opportunity');
ALTER TABLE public.field_sales_opportunities ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS sales_status text;

ALTER TABLE public.field_sales DROP CONSTRAINT field_sales_status_check;
ALTER TABLE public.field_sales ADD CONSTRAINT field_sales_status_check CHECK (status IN ('pending','verified','cancelled','rejected','refunded','charged_back'));
ALTER TABLE public.field_sales
 ADD COLUMN property_key text,
 ADD COLUMN property_snapshot jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN original_event_id uuid,
 ADD COLUMN opportunity_id uuid REFERENCES public.field_sales_opportunities(id),
 ADD COLUMN setter_id uuid REFERENCES auth.users(id),
 ADD COLUMN closer_id uuid REFERENCES auth.users(id),
 ADD COLUMN team_id uuid REFERENCES public.field_sales_teams(id),
 ADD COLUMN team_name_snapshot text,
 ADD COLUMN rep_name_snapshot text,
 ADD COLUMN campaign_name_snapshot text,
 ADD COLUMN product text NOT NULL DEFAULT '' CHECK (length(product)<=200),
 ADD COLUMN expected_revenue_minor bigint CHECK (expected_revenue_minor BETWEEN 0 AND 9000000000000000),
 ADD COLUMN expected_completion_on date,
 ADD COLUMN fulfillment_status text NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending','scheduled','in_progress','completed','cancelled')),
 ADD COLUMN completed_on date,
 ADD COLUMN completed_value_minor bigint NOT NULL DEFAULT 0 CHECK (completed_value_minor BETWEEN 0 AND 9000000000000000),
 ADD COLUMN attribution_source text NOT NULL DEFAULT 'manual' CHECK (attribution_source IN ('door_knock','qr','manual','referral','inbound','crm','other')),
 ADD COLUMN attribution_method text NOT NULL DEFAULT 'legacy_lead',
 ADD COLUMN attribution_confidence text NOT NULL DEFAULT 'unknown' CHECK (attribution_confidence IN ('confirmed','partial','unknown')),
 ADD COLUMN attribution_evidence jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN cancelled_at timestamptz,
 ADD COLUMN job_identifier text CHECK (length(job_identifier) BETWEEN 1 AND 200),
 ADD COLUMN external_provider text,
 ADD COLUMN external_crm_id text,
 ADD COLUMN duplicate_override_reason text,
 ADD COLUMN commission_minor bigint CHECK (commission_minor BETWEEN 0 AND 9000000000000000),
 ADD COLUMN gross_profit_minor bigint CHECK (gross_profit_minor BETWEEN -9000000000000000 AND 9000000000000000),
 ADD COLUMN industry_values jsonb NOT NULL DEFAULT '{}';
DROP INDEX public.field_sales_active_lead;
CREATE INDEX field_sales_contact_jobs ON public.field_sales(workspace_id,contact_id,status);
CREATE INDEX field_sales_property_jobs ON public.field_sales(workspace_id,property_key,status) WHERE property_key IS NOT NULL;
CREATE INDEX field_sales_opportunity_jobs ON public.field_sales(workspace_id,opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE UNIQUE INDEX field_sales_external_identity ON public.field_sales(workspace_id,external_provider,external_crm_id) WHERE external_crm_id IS NOT NULL;
CREATE UNIQUE INDEX field_sales_job_identity ON public.field_sales(workspace_id,job_identifier) WHERE job_identifier IS NOT NULL AND status NOT IN ('cancelled','rejected','refunded','charged_back');
CREATE INDEX field_sales_campaign_period ON public.field_sales(workspace_id,campaign_id,sold_on);
CREATE INDEX field_sales_territory_period ON public.field_sales(workspace_id,territory_id,sold_on);
CREATE INDEX field_sales_team_period ON public.field_sales(workspace_id,team_id,sold_on);

-- A rep's split is a share of one sale, never an additional company sale.
CREATE TABLE public.field_sales_credits (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), sale_id uuid NOT NULL REFERENCES public.field_sales(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), role text NOT NULL CHECK (role IN ('setter','closer','full_cycle','contributor')),
 basis_points integer NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
 rep_name_snapshot text NOT NULL, team_id uuid REFERENCES public.field_sales_teams(id), team_name_snapshot text,
 PRIMARY KEY(sale_id,user_id)
);
CREATE INDEX field_sales_credit_rep ON public.field_sales_credits(workspace_id,user_id,sale_id);
-- Actual cash movements are append-only and independent of contract/completion values.
CREATE TABLE public.field_sales_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sale_id uuid NOT NULL REFERENCES public.field_sales(id), request_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK (amount_minor<>0 AND amount_minor BETWEEN -9000000000000000 AND 9000000000000000),
 kind text NOT NULL CHECK (kind IN ('collection','refund','chargeback')),
 occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid NOT NULL REFERENCES auth.users(id), reference text, note text NOT NULL DEFAULT '' CHECK (length(note)<=4000),
 CHECK ((kind='collection' AND amount_minor>0) OR (kind<>'collection' AND amount_minor<0)),
 UNIQUE(workspace_id,request_id)
);
CREATE INDEX field_sales_payment_period ON public.field_sales_payments(workspace_id,occurred_at,sale_id);
CREATE TABLE public.field_sales_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sale_id uuid REFERENCES public.field_sales(id), event_type text NOT NULL, entity_version integer,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sale_id,event_type,entity_version)
);
CREATE INDEX field_sales_outbox_cursor ON public.field_sales_outbox(workspace_id,created_at,id);
CREATE TABLE public.field_sales_requests (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), actor_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL, action text NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_id,request_id)
);
CREATE TABLE public.field_sales_settings_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL, before_record jsonb, after_record jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy data is identified as legacy evidence; do not fabricate a past team assignment.
UPDATE public.field_sales s SET setter_id=s.rep_id,closer_id=s.rep_id,
 rep_name_snapshot=coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
 campaign_name_snapshot=(SELECT c.name FROM public.campaigns c WHERE c.id=s.campaign_id AND c.workspace_id=s.workspace_id),
 expected_revenue_minor=s.value_minor, cancelled_at=CASE WHEN s.status='cancelled' THEN s.updated_at END
 FROM auth.users u WHERE u.id=s.rep_id;
INSERT INTO public.field_sales_credits(workspace_id,sale_id,user_id,role,basis_points,rep_name_snapshot)
 SELECT workspace_id,id,rep_id,'full_cycle',10000,rep_name_snapshot FROM public.field_sales;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['field_sales_teams','field_sales_team_memberships','field_sales_credits','field_sales_payments','field_sales_outbox','field_sales_requests','field_sales_settings_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 END LOOP;
END $$;

CREATE FUNCTION public.field_sales_permission(w uuid,capability text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(w); cfg public.field_sales_settings; custom jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=w;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN false; END IF;
 IF r IN ('owner','admin') THEN RETURN true; END IF;
 custom:=cfg.permissions->capability;
 IF custom IS NOT NULL THEN RETURN jsonb_typeof(custom)='array' AND custom ? r; END IF;
 IF capability='submit' THEN RETURN true; END IF;
 IF capability IN ('verify','cancel','complete','collect','export','team_details','attribution','team_revenue') THEN RETURN r='manager'; END IF;
 IF capability='own_revenue' THEN RETURN cfg.rep_revenue_visible OR r='manager'; END IF;
 IF capability='leaderboard_revenue' THEN RETURN cfg.team_revenue_visible OR r='manager'; END IF;
 RETURN false;
END $$;

CREATE FUNCTION public.field_sales_seed_stages(w uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
 (w,'new','New lead',0,0,'open'),(w,'contacted','Contacted',10,10,'open'),
 (w,'appointment','Appointment set',20,25,'open'),(w,'appointment_completed','Appointment completed',30,40,'open'),
 (w,'opportunity','Opportunity',40,50,'open'),(w,'proposal','Proposal / estimate',50,70,'open'),
 (w,'won','Sold',60,100,'won'),(w,'fulfillment','Install / fulfillment',70,100,'won'),
 (w,'completed','Completed',80,100,'won'),(w,'collected','Collected',90,100,'won'),
 (w,'lost','Lost',91,0,'lost'),(w,'cancelled','Cancelled',92,0,'lost'),
 (w,'no_show','No show',93,0,'open'),(w,'follow_up','Follow-up',94,20,'open') ON CONFLICT DO NOTHING;
END $$;
SELECT public.field_sales_seed_stages(workspace_id) FROM public.field_sales_settings;

-- Every sale mutation, including trusted future integrations, has an immutable audit event.
CREATE FUNCTION public.field_sales_audit_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE action text; event_name text; actor uuid;
BEGIN
 actor:=coalesce(auth.uid(),NEW.created_by);
 action:=CASE WHEN TG_OP='INSERT' THEN 'submit'
 WHEN NEW.status IS DISTINCT FROM OLD.status THEN CASE NEW.status WHEN 'verified' THEN 'verify' WHEN 'cancelled' THEN 'cancel' ELSE NEW.status END
 WHEN NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status AND NEW.fulfillment_status='completed' THEN 'complete'
 ELSE 'update' END;
 event_name:=CASE action WHEN 'submit' THEN 'sale.created' WHEN 'verify' THEN 'sale.verified' WHEN 'cancel' THEN 'sale.cancelled'
 WHEN 'complete' THEN 'job.completed' ELSE 'sale.'||CASE action WHEN 'update' THEN 'updated' ELSE action END END;
 INSERT INTO public.field_sales_events(workspace_id,sale_id,actor_id,action,before_record,after_record)
 VALUES(NEW.workspace_id,NEW.id,actor,action,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 INSERT INTO public.field_sales_outbox(workspace_id,sale_id,event_type,entity_version,payload)
 VALUES(NEW.workspace_id,NEW.id,event_name,NEW.version,jsonb_build_object('sale_id',NEW.id,'status',NEW.status,'version',NEW.version)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER field_sales_audit_change AFTER INSERT OR UPDATE ON public.field_sales FOR EACH ROW EXECUTE FUNCTION public.field_sales_audit_change();

-- Calendar bounds shared by dashboards, goals, exports and comparison queries. End is exclusive.
CREATE FUNCTION public.field_sales_period_bounds(p_timezone text,p_period text,p_start date DEFAULT NULL,p_end date DEFAULT NULL,p_now timestamptz DEFAULT now())
RETURNS TABLE(start_day date,end_day date,start_at timestamptz,end_at timestamptz,previous_start date,previous_end date)
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE d date:=(p_now AT TIME ZONE p_timezone)::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid reporting timezone'; END IF;
 start_day:=CASE p_period WHEN 'today' THEN d WHEN 'yesterday' THEN d-1
 WHEN 'week' THEN date_trunc('week',d)::date WHEN 'previous_week' THEN date_trunc('week',d)::date-7
 WHEN 'month' THEN date_trunc('month',d)::date WHEN 'previous_month' THEN (date_trunc('month',d)-interval '1 month')::date
 WHEN 'quarter' THEN date_trunc('quarter',d)::date WHEN 'year' THEN date_trunc('year',d)::date
 WHEN 'custom' THEN p_start WHEN 'all' THEN date '2000-01-01' END;
 end_day:=CASE p_period WHEN 'yesterday' THEN d WHEN 'previous_week' THEN date_trunc('week',d)::date
 WHEN 'previous_month' THEN date_trunc('month',d)::date WHEN 'custom' THEN p_end+1 ELSE d+1 END;
 IF start_day IS NULL OR end_day IS NULL OR start_day>=end_day THEN RAISE EXCEPTION 'Select a valid reporting period'; END IF;
 start_at:=start_day::timestamp AT TIME ZONE p_timezone; end_at:=end_day::timestamp AT TIME ZONE p_timezone;
 previous_end:=start_day; previous_start:=start_day-(end_day-start_day);
 RETURN NEXT;
END $$;

-- Replace V1 writes; preserve its monthly-goal API for existing clients during migration.
ALTER FUNCTION public.field_sales_command(uuid,text,jsonb) RENAME TO field_sales_command_v1;
REVOKE ALL ON FUNCTION public.field_sales_command_v1(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.field_sales_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; previous_cfg jsonb;
 c public.contacts; cj jsonb; a public.contact_activities; sale public.field_sales; old public.field_sales;
 op public.field_sales_opportunities; ev jsonb; cp jsonb; prior_request public.field_sales_requests;
 rep uuid; setter uuid; closer uuid; rid uuid; sid uuid; team uuid; tm_name text;
 credits jsonb; cr jsonb; credit_rep uuid; credit_total integer:=0; credit_n integer:=0;
 result jsonb; input_data jsonb:=p_data; old_credits jsonb; req uuid:=nullif(p_data->>'request_id','')::uuid; amount bigint; cash numeric; payment_id uuid;
 local_day date; reason text; duplicate_id uuid; cap text; pair record; source text; property text;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) THEN RAISE EXCEPTION 'Sales is not enabled for this workspace'; END IF;
 IF req IS NOT NULL THEN
  SELECT * INTO prior_request FROM public.field_sales_requests WHERE workspace_id=p_workspace AND actor_id=auth.uid() AND request_id=req;
  IF FOUND THEN
   IF prior_request.action<>p_action OR prior_request.payload<>p_data THEN RAISE EXCEPTION 'Request ID was already used for a different operation'; END IF;
   RETURN prior_request.result;
  END IF;
 END IF;
 IF p_action='goal' THEN RETURN public.field_sales_command_v1(p_workspace,p_action,p_data); END IF;
 IF p_action='settings' THEN
  IF r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  previous_cfg:=to_jsonb(cfg);
  PERFORM public.field_sales_command_v1(p_workspace,p_action,to_jsonb(cfg)||p_data);
  IF p_data ? 'permissions' THEN
   IF jsonb_typeof(p_data->'permissions')<>'object' THEN RAISE EXCEPTION 'Permissions must be an object'; END IF;
   FOR pair IN SELECT * FROM jsonb_each(p_data->'permissions') LOOP
    IF pair.key NOT IN ('submit','verify','cancel','complete','collect','export','team_details','attribution','team_revenue','own_revenue','leaderboard_revenue','commission','margin','edit_verified')
     OR jsonb_typeof(pair.value)<>'array' THEN RAISE EXCEPTION 'Invalid permission'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(pair.value) q(value) WHERE value NOT IN ('owner','admin','manager','member','rep')) THEN RAISE EXCEPTION 'Invalid permission role'; END IF;
   END LOOP;
  END IF;
  IF p_data ? 'feed_options' THEN
   IF jsonb_typeof(p_data->'feed_options')<>'object' THEN RAISE EXCEPTION 'Feed settings must be an object'; END IF;
   FOR pair IN SELECT * FROM jsonb_each(p_data->'feed_options') LOOP
    IF pair.key NOT IN ('enabled','rep_names','contract_values','campaign_names','territory_names') OR jsonb_typeof(pair.value)<>'boolean' THEN RAISE EXCEPTION 'Invalid feed setting'; END IF;
   END LOOP;
  END IF;
  IF p_data ? 'notification_options' THEN
   IF jsonb_typeof(p_data->'notification_options')<>'object' THEN RAISE EXCEPTION 'Notification settings must be an object'; END IF;
   FOR pair IN SELECT * FROM jsonb_each(p_data->'notification_options') LOOP
    IF pair.key NOT IN ('sale.created','sale.verified','sale.cancelled','goal.reached','opportunity.stale','appointment.created','appointment.starting','follow_up.due') OR jsonb_typeof(pair.value)<>'boolean' THEN RAISE EXCEPTION 'Invalid notification setting'; END IF;
   END LOOP;
  END IF;
  IF p_data ? 'terminology' THEN
   IF jsonb_typeof(p_data->'terminology')<>'object' THEN RAISE EXCEPTION 'Terminology must be an object'; END IF;
   FOR pair IN SELECT * FROM jsonb_each(p_data->'terminology') LOOP
    IF jsonb_typeof(pair.value)<>'string' OR length(pair.value#>>'{}') NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Terminology labels must contain one to sixty characters'; END IF;
   END LOOP;
  END IF;
  UPDATE public.field_sales_settings SET
   verification_required=coalesce((p_data->>'verification_required')::boolean,verification_required),
   rep_revenue_visible=coalesce((p_data->>'rep_revenue_visible')::boolean,rep_revenue_visible),
   minimum_close_opportunities=coalesce((p_data->>'minimum_close_opportunities')::integer,minimum_close_opportunities),
   industry=coalesce(p_data->>'industry',industry), terminology=coalesce(p_data->'terminology',terminology),
   permissions=coalesce(p_data->'permissions',permissions), feed_options=coalesce(p_data->'feed_options',feed_options),
   notification_options=coalesce(p_data->'notification_options',notification_options),featured_ranking=coalesce(p_data->>'featured_ranking',featured_ranking)
  WHERE workspace_id=p_workspace RETURNING * INTO cfg;
  IF jsonb_typeof(cfg.terminology)<>'object' OR jsonb_typeof(cfg.feed_options)<>'object' OR jsonb_typeof(cfg.notification_options)<>'object' THEN RAISE EXCEPTION 'Settings must be objects'; END IF;
  INSERT INTO public.field_sales_settings_events(workspace_id,actor_id,action,before_record,after_record)
  VALUES(p_workspace,auth.uid(),'settings',previous_cfg,to_jsonb(cfg));
  PERFORM public.field_sales_seed_stages(p_workspace);
  RETURN public.field_sales_bootstrap(p_workspace);
 END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RAISE EXCEPTION 'An owner must select reporting currency and timezone'; END IF;
 local_day:=(now() AT TIME ZONE cfg.timezone)::date;
 IF p_action IN ('submit','edit','attribution') THEN
  cap:=CASE p_action WHEN 'submit' THEN 'submit' WHEN 'attribution' THEN 'attribution' ELSE 'submit' END;
  IF NOT public.field_sales_permission(p_workspace,cap) THEN RAISE EXCEPTION 'Sale permission required' USING ERRCODE='42501'; END IF;
  IF p_action<>'submit' THEN
   SELECT * INTO old FROM public.field_sales WHERE workspace_id=p_workspace AND id=(p_data->>'id')::uuid FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Sale unavailable' USING ERRCODE='42501'; END IF;
   IF old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Sale changed; refresh before editing'; END IF;
   IF old.status NOT IN ('pending','verified') THEN RAISE EXCEPTION 'Reversed sales cannot be edited'; END IF;
   IF p_action='edit' AND (old.created_by<>auth.uid() OR old.status='verified') AND NOT public.field_sales_permission(p_workspace,'edit_verified') THEN RAISE EXCEPTION 'Sale edit permission required' USING ERRCODE='42501'; END IF;
   -- An attribution correction cannot silently change the financial contract or lead.
   IF p_action='attribution' AND EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('id','version','request_id','reason','rep_id','setter_id','closer_id','credits','campaign_id','original_event_id','attribution_source')) THEN RAISE EXCEPTION 'Use the sale editor for non-attribution fields'; END IF;
   IF p_action='attribution' AND length(trim(coalesce(p_data->>'reason','')))=0 THEN RAISE EXCEPTION 'Attribution correction reason required'; END IF;
   p_data:=to_jsonb(old)||p_data;
  ELSIF req IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
  SELECT * INTO c FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace;
  IF NOT FOUND OR (c.user_id<>auth.uid() AND NOT public.field_sales_permission(p_workspace,'team_details')) THEN RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501'; END IF;
  cj:=to_jsonb(c);
  rep:=coalesce(nullif(p_data->>'rep_id','')::uuid,c.user_id);
  setter:=coalesce(nullif(p_data->>'setter_id','')::uuid,c.user_id); closer:=coalesce(nullif(p_data->>'closer_id','')::uuid,rep);
  IF rep<>auth.uid() AND NOT public.field_sales_permission(p_workspace,'attribution') THEN RAISE EXCEPTION 'Representative assignment requires manager permission' USING ERRCODE='42501'; END IF;
  IF (setter IS DISTINCT FROM c.user_id OR closer IS DISTINCT FROM rep) AND NOT public.field_sales_permission(p_workspace,'attribution')
   AND (old.id IS NULL OR setter IS DISTINCT FROM old.setter_id OR closer IS DISTINCT FROM old.closer_id) THEN RAISE EXCEPTION 'Setter or closer assignment requires manager permission' USING ERRCODE='42501'; END IF;
  FOREACH rid IN ARRAY ARRAY[rep,setter,closer] LOOP
   IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=rid) THEN RAISE EXCEPTION 'Representative must belong to this workspace'; END IF;
  END LOOP;
  SELECT * INTO op FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=c.id;
  IF nullif(p_data->>'opportunity_id','') IS NOT NULL AND (op.id IS NULL OR op.id<>(p_data->>'opportunity_id')::uuid) THEN RAISE EXCEPTION 'Opportunity must belong to this lead'; END IF;
  IF op.id IS NULL THEN
   PERFORM public.field_sales_seed_stages(p_workspace);
   INSERT INTO public.field_sales_opportunities(workspace_id,contact_id,user_id,stage_key)
    VALUES(p_workspace,c.id,c.user_id,'opportunity') RETURNING * INTO op;
  END IF;
  IF nullif(p_data->>'appointment_id','') IS NOT NULL THEN
   SELECT * INTO a FROM public.contact_activities WHERE id=(p_data->>'appointment_id')::uuid AND contact_id=c.id AND type='meeting';
   IF NOT FOUND OR coalesce(to_jsonb(a)->>'status','') IN ('cancelled','canceled') OR a.timestamp>now() OR (a.timestamp AT TIME ZONE cfg.timezone)::date>coalesce(nullif(p_data->>'sold_on','')::date,local_day) THEN RAISE EXCEPTION 'Appointment must belong to this lead and precede the sale'; END IF;
  END IF;
  IF nullif(p_data->>'campaign_id','') IS NOT NULL AND (p_data->>'campaign_id')::uuid IS DISTINCT FROM c.campaign_id AND NOT public.field_sales_permission(p_workspace,'attribution') THEN RAISE EXCEPTION 'Campaign corrections require manager permission'; END IF;
  SELECT to_jsonb(x) INTO cp FROM public.campaigns x WHERE workspace_id=p_workspace AND id=coalesce(nullif(p_data->>'campaign_id','')::uuid,c.campaign_id);
  IF coalesce(nullif(p_data->>'campaign_id','')::uuid,c.campaign_id) IS NOT NULL AND cp IS NULL THEN RAISE EXCEPTION 'Campaign must belong to this workspace'; END IF;
  -- Resolve property only from the accessible source record; arbitrary property IDs are never accepted.
  property:=coalesce(nullif(cj->>'building_id',''),nullif(cj->>'address_id',''),nullif(lower(trim(cj->>'address')),''));
  IF nullif(p_data->>'original_event_id','') IS NOT NULL THEN
   SELECT to_jsonb(e) INTO ev FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id
   WHERE e.id=(p_data->>'original_event_id')::uuid AND sn.workspace_id=p_workspace AND e.created_at<=now()
   AND (e.created_at AT TIME ZONE cfg.timezone)::date<=coalesce(nullif(p_data->>'sold_on','')::date,local_day)
   AND e.event_type IN ('conversation','flyer_left','completed_manual','completed_auto')
   AND (e.building_id::text=nullif(cj->>'building_id','') OR e.address_id::text=nullif(cj->>'address_id','') OR nullif(cj->>'source_event_id','')=e.id::text);
   IF ev IS NULL THEN RAISE EXCEPTION 'Original activity must be linked to this property or lead'; END IF;
  END IF;
  SELECT m.team_id,t.name INTO team,tm_name FROM public.field_sales_team_memberships m JOIN public.field_sales_teams t ON t.id=m.team_id
   WHERE m.workspace_id=p_workspace AND m.user_id=rep AND m.starts_at<=((coalesce(nullif(p_data->>'sold_on','')::date,local_day)+1)::timestamp AT TIME ZONE cfg.timezone)
   AND (m.ends_at IS NULL OR m.ends_at>((coalesce(nullif(p_data->>'sold_on','')::date,local_day))::timestamp AT TIME ZONE cfg.timezone)) ORDER BY m.starts_at DESC LIMIT 1;
  IF old.id IS NOT NULL THEN team:=old.team_id; tm_name:=old.team_name_snapshot; END IF;
  IF coalesce(nullif(p_data->>'sold_on','')::date,local_day)>local_day OR coalesce(nullif(p_data->>'sold_on','')::date,local_day)<(c.created_at AT TIME ZONE cfg.timezone)::date THEN RAISE EXCEPTION 'Sale date must be between lead creation and today'; END IF;
  IF nullif(p_data->>'expected_completion_on','')::date<coalesce(nullif(p_data->>'sold_on','')::date,local_day) THEN RAISE EXCEPTION 'Expected completion cannot precede the sale'; END IF;
  IF nullif(p_data->>'replaces_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace AND contact_id=c.id AND id=(p_data->>'replaces_id')::uuid AND status IN ('cancelled','refunded','charged_back')) THEN RAISE EXCEPTION 'Replacement must reference a reversed sale for this lead'; END IF;
  IF p_action='submit' THEN
   SELECT id INTO duplicate_id FROM public.field_sales WHERE workspace_id=p_workspace AND status IN ('pending','verified')
    AND (contact_id=c.id OR (property IS NOT NULL AND property_key=property) OR (op.id IS NOT NULL AND opportunity_id=op.id)) LIMIT 1;
   IF duplicate_id IS NOT NULL AND (NOT public.field_sales_permission(p_workspace,'attribution') OR length(trim(coalesce(p_data->>'duplicate_override_reason','')))=0 OR nullif(p_data->>'job_identifier','') IS NULL) THEN
    RAISE EXCEPTION 'An existing sale may already be associated with this customer.' USING ERRCODE='23505',DETAIL=duplicate_id::text,HINT='A manager can confirm a separate job with a unique job identifier and a reason.';
   END IF;
  END IF;
  IF (p_data ? 'commission_minor') AND p_data->>'commission_minor' IS NOT NULL AND NOT public.field_sales_permission(p_workspace,'commission') THEN RAISE EXCEPTION 'Commission permission required'; END IF;
  IF (p_data ? 'gross_profit_minor') AND p_data->>'gross_profit_minor' IS NOT NULL AND NOT public.field_sales_permission(p_workspace,'margin') THEN RAISE EXCEPTION 'Margin permission required'; END IF;
  credits:=p_data->'credits';
  IF credits IS NULL THEN
   IF old.id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'role',role,'basis_points',basis_points)) INTO credits FROM public.field_sales_credits WHERE sale_id=old.id;
   ELSE credits:=jsonb_build_array(jsonb_build_object('user_id',rep,'role',CASE WHEN setter=closer THEN 'full_cycle' ELSE 'closer' END,'basis_points',10000)); END IF;
  END IF;
  IF jsonb_typeof(credits)<>'array' OR jsonb_array_length(credits) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Provide between one and twenty credit assignments'; END IF;
  FOR cr IN SELECT * FROM jsonb_array_elements(credits) LOOP
   credit_rep:=(cr->>'user_id')::uuid;
   IF credit_rep IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=credit_rep)
    OR cr->>'role' IS NULL OR cr->>'role' NOT IN ('setter','closer','full_cycle','contributor')
    OR (cr->>'basis_points') IS NULL OR (cr->>'basis_points')::integer NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Invalid credit assignment'; END IF;
   credit_total:=credit_total+(cr->>'basis_points')::integer; credit_n:=credit_n+1;
  END LOOP;
  IF credit_total<>10000 OR (SELECT count(DISTINCT x->>'user_id') FROM jsonb_array_elements(credits) x)<>credit_n THEN RAISE EXCEPTION 'Credit must total 100 percent with one row per representative'; END IF;
  IF p_data ? 'credits' AND NOT public.field_sales_permission(p_workspace,'attribution') AND credits<>jsonb_build_array(jsonb_build_object('user_id',rep,'role',CASE WHEN setter=closer THEN 'full_cycle' ELSE 'closer' END,'basis_points',10000)) THEN RAISE EXCEPTION 'Split credit requires manager permission'; END IF;
  source:=coalesce(nullif(p_data->>'attribution_source',''),CASE WHEN ev IS NOT NULL THEN 'door_knock' ELSE 'manual' END);
  IF p_action='submit' THEN
   INSERT INTO public.field_sales(workspace_id,contact_id,rep_id,campaign_id,territory_id,appointment_id,value_minor,currency,sold_on,notes,created_by,request_id,replaces_id,
    property_key,property_snapshot,original_event_id,opportunity_id,setter_id,closer_id,team_id,team_name_snapshot,rep_name_snapshot,campaign_name_snapshot,
    product,expected_revenue_minor,expected_completion_on,attribution_source,attribution_method,attribution_confidence,attribution_evidence,job_identifier,duplicate_override_reason,commission_minor,gross_profit_minor)
   VALUES(p_workspace,c.id,rep,nullif(cp->>'id','')::uuid,nullif(cp->>'territory_id','')::uuid,a.id,(p_data->>'value_minor')::bigint,cfg.currency,coalesce(nullif(p_data->>'sold_on','')::date,local_day),coalesce(p_data->>'notes',''),auth.uid(),req,nullif(p_data->>'replaces_id','')::uuid,
    property,jsonb_strip_nulls(jsonb_build_object('address',cj->>'address','building_id',cj->>'building_id','address_id',cj->>'address_id','latitude',cj->'latitude','longitude',cj->'longitude')),
    nullif(ev->>'id','')::uuid,op.id,setter,closer,team,tm_name,(SELECT coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','Representative') FROM auth.users WHERE id=rep),cp->>'name',
    coalesce(p_data->>'product',''),coalesce(nullif(p_data->>'expected_revenue_minor','')::bigint,(p_data->>'value_minor')::bigint),nullif(p_data->>'expected_completion_on','')::date,
    source,CASE WHEN ev IS NOT NULL THEN 'linked_activity' WHEN property IS NOT NULL THEN 'linked_property' WHEN a.id IS NOT NULL THEN 'linked_appointment' ELSE 'linked_lead' END,
    CASE WHEN ev IS NOT NULL THEN 'confirmed' ELSE 'partial' END,jsonb_strip_nulls(jsonb_build_object('lead_id',c.id,'appointment_id',a.id,'event_id',ev->>'id','original_at',ev->>'created_at','campaign_id',cp->>'id')),
    nullif(p_data->>'job_identifier',''),nullif(p_data->>'duplicate_override_reason',''),nullif(p_data->>'commission_minor','')::bigint,nullif(p_data->>'gross_profit_minor','')::bigint) RETURNING * INTO sale;
  ELSE
   IF c.id<>old.contact_id THEN RAISE EXCEPTION 'A sale must retain its original lead'; END IF;
   UPDATE public.field_sales SET rep_id=rep,setter_id=setter,closer_id=closer,campaign_id=nullif(cp->>'id','')::uuid,territory_id=nullif(cp->>'territory_id','')::uuid,
    campaign_name_snapshot=cp->>'name',rep_name_snapshot=(SELECT coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','Representative') FROM auth.users WHERE id=rep),
    appointment_id=a.id,value_minor=(p_data->>'value_minor')::bigint,sold_on=(p_data->>'sold_on')::date,notes=coalesce(p_data->>'notes',''),product=coalesce(p_data->>'product',''),
    expected_revenue_minor=nullif(p_data->>'expected_revenue_minor','')::bigint,expected_completion_on=nullif(p_data->>'expected_completion_on','')::date,
    original_event_id=nullif(ev->>'id','')::uuid,attribution_source=source,
    attribution_evidence=old.attribution_evidence||jsonb_build_object('correction_reason',p_data->>'reason','event_id',ev->>'id','campaign_id',cp->>'id'),
    commission_minor=nullif(p_data->>'commission_minor','')::bigint,gross_profit_minor=nullif(p_data->>'gross_profit_minor','')::bigint,
    version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO sale;
  END IF;
  SELECT jsonb_agg(to_jsonb(x)) INTO old_credits FROM public.field_sales_credits x WHERE sale_id=sale.id;
  DELETE FROM public.field_sales_credits WHERE sale_id=sale.id;
  INSERT INTO public.field_sales_credits(workspace_id,sale_id,user_id,role,basis_points,rep_name_snapshot,team_id,team_name_snapshot)
   SELECT p_workspace,sale.id,(x->>'user_id')::uuid,x->>'role',(x->>'basis_points')::integer,
   coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
   coalesce((previous.value->>'team_id')::uuid,m.team_id),coalesce(previous.value->>'team_name_snapshot',t.name)
   FROM jsonb_array_elements(credits) x JOIN auth.users u ON u.id=(x->>'user_id')::uuid
   LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(coalesce(old_credits,'[]')) WHERE value->>'user_id'=u.id::text) previous ON true
   LEFT JOIN LATERAL (SELECT tm.team_id FROM public.field_sales_team_memberships tm WHERE tm.workspace_id=p_workspace AND tm.user_id=u.id
     AND tm.starts_at<=((sale.sold_on+1)::timestamp AT TIME ZONE cfg.timezone) AND (tm.ends_at IS NULL OR tm.ends_at>(sale.sold_on::timestamp AT TIME ZONE cfg.timezone))
     ORDER BY tm.starts_at DESC LIMIT 1) m ON previous.value IS NULL
   LEFT JOIN public.field_sales_teams t ON t.id=m.team_id;
  INSERT INTO public.field_sales_events(workspace_id,sale_id,actor_id,action,before_record,after_record)
   VALUES(p_workspace,sale.id,auth.uid(),'credit',jsonb_build_object('credits',old_credits),jsonb_build_object('credits',credits,'reason',p_data->>'reason'));
  PERFORM public.field_sales_seed_stages(p_workspace);
  INSERT INTO public.field_sales_opportunities(workspace_id,contact_id,user_id,stage_key,expected_value_minor)
   VALUES(p_workspace,c.id,rep,'won',sale.value_minor)
   ON CONFLICT(workspace_id,contact_id) DO UPDATE SET stage_key='won',stage_entered_at=now(),version=field_sales_opportunities.version+1,updated_at=now();
  UPDATE public.contacts SET sales_status='sold' WHERE id=c.id AND workspace_id=p_workspace;
  IF NOT cfg.verification_required AND sale.status='pending' THEN
   UPDATE public.field_sales SET status='verified',verified_by=auth.uid(),verified_at=now(),version=version+1,updated_at=now() WHERE id=sale.id RETURNING * INTO sale;
  END IF;
 ELSIF p_action IN ('verify','reject','cancel','refund','chargeback','complete','collect','refund_payment','chargeback_payment') THEN
  cap:=CASE p_action WHEN 'verify' THEN 'verify' WHEN 'reject' THEN 'verify' WHEN 'complete' THEN 'complete' WHEN 'collect' THEN 'collect' WHEN 'refund_payment' THEN 'collect' WHEN 'chargeback_payment' THEN 'collect' ELSE 'cancel' END;
  IF NOT public.field_sales_permission(p_workspace,cap) THEN RAISE EXCEPTION 'Sale permission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO old FROM public.field_sales WHERE workspace_id=p_workspace AND id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF p_action='verify' AND old.status='verified' THEN RETURN jsonb_build_object('id',old.id,'status',old.status,'version',old.version); END IF;
  IF p_action='cancel' AND old.status='cancelled' THEN RETURN jsonb_build_object('id',old.id,'status',old.status,'version',old.version); END IF;
  IF p_data ? 'version' AND old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Sale changed; refresh before updating'; END IF;
  IF p_action='verify' THEN
   IF old.status<>'pending' THEN RAISE EXCEPTION 'Only pending sales can be verified'; END IF;
   IF r<>'owner' AND (old.rep_id=auth.uid() OR old.created_by=auth.uid() OR old.setter_id=auth.uid() OR old.closer_id=auth.uid()
     OR EXISTS(SELECT 1 FROM public.field_sales_credits WHERE sale_id=old.id AND user_id=auth.uid())) THEN RAISE EXCEPTION 'Only owners can verify their own sales'; END IF;
   IF p_data->>'version' IS NULL THEN RAISE EXCEPTION 'Reviewed version required'; END IF;
   UPDATE public.field_sales SET status='verified',verified_by=auth.uid(),verified_at=now(),updated_at=now(),version=version+1 WHERE id=old.id RETURNING * INTO sale;
  ELSIF p_action IN ('cancel','reject','refund','chargeback') THEN
   reason:=trim(coalesce(p_data->>'reason',''));
   IF length(reason) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'A reason is required (maximum 1000 characters)'; END IF;
   IF p_action='reject' AND old.status<>'pending' THEN RAISE EXCEPTION 'Only pending sales can be rejected'; END IF;
   IF p_action IN ('refund','chargeback') AND old.status<>'verified' THEN RAISE EXCEPTION 'Only verified sales can be reversed'; END IF;
   UPDATE public.field_sales SET status=CASE p_action WHEN 'reject' THEN 'rejected' WHEN 'refund' THEN 'refunded' WHEN 'chargeback' THEN 'charged_back' ELSE 'cancelled' END,
    cancelled_at=now(),cancellation_reason=reason,fulfillment_status=CASE WHEN fulfillment_status='completed' THEN 'completed' ELSE 'cancelled' END,updated_at=now(),version=version+1
    WHERE id=old.id RETURNING * INTO sale;
   IF NOT EXISTS(SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace AND contact_id=old.contact_id AND status IN ('pending','verified')) THEN
    UPDATE public.contacts SET sales_status=CASE p_action WHEN 'reject' THEN 'open' ELSE 'cancelled' END WHERE id=old.contact_id AND workspace_id=p_workspace;
    UPDATE public.field_sales_opportunities SET stage_key='cancelled',stage_entered_at=now(),version=version+1,updated_at=now() WHERE workspace_id=p_workspace AND contact_id=old.contact_id;
   END IF;
  ELSIF p_action='complete' THEN
   IF old.status<>'verified' THEN RAISE EXCEPTION 'Verify the sale before recording completion'; END IF;
   IF nullif(p_data->>'completed_on','')::date IS NULL OR (p_data->>'completed_on')::date<old.sold_on OR (p_data->>'completed_on')::date>local_day THEN RAISE EXCEPTION 'Completion date must be between sale date and today'; END IF;
   UPDATE public.field_sales SET fulfillment_status='completed',completed_on=(p_data->>'completed_on')::date,
    completed_value_minor=coalesce(nullif(p_data->>'completed_value_minor','')::bigint,value_minor),version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO sale;
   UPDATE public.field_sales_opportunities SET stage_key='completed',stage_entered_at=now(),version=version+1,updated_at=now() WHERE workspace_id=p_workspace AND contact_id=old.contact_id;
  ELSE
   IF req IS NULL THEN RAISE EXCEPTION 'Payment request ID required'; END IF;
   IF p_action='collect' AND old.status<>'verified' THEN RAISE EXCEPTION 'Verify the sale before recording collection'; END IF;
   amount:=(p_data->>'amount_minor')::bigint;
   IF amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
   IF (p_data->>'occurred_at')::timestamptz IS NULL OR (p_data->>'occurred_at')::timestamptz>now() OR ((p_data->>'occurred_at')::timestamptz AT TIME ZONE cfg.timezone)::date<old.sold_on THEN RAISE EXCEPTION 'Payment date must be between sale date and now'; END IF;
   SELECT coalesce(sum(amount_minor),0) INTO cash FROM public.field_sales_payments WHERE workspace_id=p_workspace AND sale_id=old.id;
   IF p_action<>'collect' AND amount>cash THEN RAISE EXCEPTION 'Refund cannot exceed recorded collected revenue'; END IF;
   INSERT INTO public.field_sales_payments(workspace_id,sale_id,request_id,amount_minor,kind,occurred_at,actor_id,reference,note)
    VALUES(p_workspace,old.id,req,CASE WHEN p_action='collect' THEN amount ELSE -amount END,CASE p_action WHEN 'collect' THEN 'collection' WHEN 'refund_payment' THEN 'refund' ELSE 'chargeback' END,
    (p_data->>'occurred_at')::timestamptz,auth.uid(),p_data->>'reference',coalesce(p_data->>'note','')) RETURNING id INTO payment_id;
   UPDATE public.field_sales SET version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO sale;
   INSERT INTO public.field_sales_events(workspace_id,sale_id,actor_id,action,after_record)
    VALUES(p_workspace,old.id,auth.uid(),p_action,jsonb_build_object('payment_id',payment_id,'amount_minor',CASE WHEN p_action='collect' THEN amount::text ELSE (-amount)::text END,'occurred_at',p_data->>'occurred_at'));
   INSERT INTO public.field_sales_outbox(workspace_id,sale_id,event_type,entity_version,payload)
    VALUES(p_workspace,old.id,CASE WHEN p_action='collect' THEN 'payment.collected' ELSE 'payment.reversed' END,sale.version,jsonb_build_object('payment_id',payment_id));
  END IF;
 ELSE RAISE EXCEPTION 'Unknown sales operation'; END IF;
 result:=jsonb_build_object('id',sale.id,'status',sale.status,'version',sale.version);
 IF req IS NOT NULL THEN
  INSERT INTO public.field_sales_requests(workspace_id,actor_id,request_id,action,payload,result) VALUES(p_workspace,auth.uid(),req,p_action,input_data,result);
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.field_sales_permission(uuid,text),public.field_sales_seed_stages(uuid),public.field_sales_audit_change(),public.field_sales_period_bounds(text,text,date,date,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.field_sales_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_command(uuid,text,jsonb) TO authenticated;
COMMIT;
