BEGIN;

ALTER TABLE public.field_sales_settings
  ADD COLUMN roofing_earnings_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roofing_earnings_writes_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.field_commission_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  representative_id uuid REFERENCES auth.users(id),
  credit_role text NOT NULL CHECK (credit_role IN ('setter','closer','full_cycle','contributor')),
  UNIQUE (workspace_id,id)
);
CREATE UNIQUE INDEX field_commission_plan_default ON public.field_commission_plans(workspace_id,credit_role)
  WHERE representative_id IS NULL;
CREATE UNIQUE INDEX field_commission_plan_rep ON public.field_commission_plans(workspace_id,credit_role,representative_id)
  WHERE representative_id IS NOT NULL;

CREATE TABLE public.field_commission_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  version integer NOT NULL,
  effective_on date NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
  rules jsonb NOT NULL,
  currency text NOT NULL,
  published_by uuid NOT NULL REFERENCES auth.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,plan_id) REFERENCES public.field_commission_plans(workspace_id,id),
  UNIQUE(plan_id,version),
  UNIQUE(plan_id,effective_on)
);

CREATE TABLE public.field_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  representative_id uuid NOT NULL REFERENCES auth.users(id),
  sale_id uuid REFERENCES public.field_sales(id),
  appointment_id uuid REFERENCES public.field_appointments(id),
  plan_version_id uuid REFERENCES public.field_commission_versions(id),
  trigger_id uuid NOT NULL,
  rule_index integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('held_fee','sale_fee','contract_percent','cash_percent','bonus','adjustment','reversal')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0 AND abs(amount_minor::numeric)<=9000000000000000),
  basis_minor bigint,
  calculation jsonb NOT NULL DEFAULT '{}',
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  accrued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  review_reason text,
  paid_at timestamptz,
  paid_by uuid REFERENCES auth.users(id),
  payment_reference text,
  original_earning_id uuid REFERENCES public.field_earnings(id),
  version integer NOT NULL DEFAULT 1,
  CHECK (sale_id IS NOT NULL OR appointment_id IS NOT NULL)
);
CREATE INDEX field_earnings_rep_period ON public.field_earnings(workspace_id,representative_id,accrued_at DESC,id);
CREATE INDEX field_earnings_manager_period ON public.field_earnings(workspace_id,status,accrued_at DESC,id);
CREATE INDEX field_earnings_original ON public.field_earnings(original_earning_id);

CREATE TABLE public.field_earning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id uuid NOT NULL REFERENCES public.field_earnings(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL,
  UNIQUE(earning_id,version)
);
CREATE TABLE public.field_commission_exceptions (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  trigger_id uuid NOT NULL,
  representative_id uuid NOT NULL REFERENCES auth.users(id),
  credit_role text NOT NULL,
  sale_id uuid REFERENCES public.field_sales(id),
  appointment_id uuid REFERENCES public.field_appointments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,trigger_id,representative_id,credit_role)
);
CREATE TABLE public.field_sale_commission_snapshots (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  sale_id uuid NOT NULL REFERENCES public.field_sales(id),
  representative_id uuid NOT NULL REFERENCES auth.users(id),
  credit_role text NOT NULL,
  basis_points integer NOT NULL,
  plan_version_id uuid REFERENCES public.field_commission_versions(id),
  PRIMARY KEY(sale_id,representative_id)
);

DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['field_commission_plans','field_commission_versions','field_earnings','field_earning_events',
   'field_commission_exceptions','field_sale_commission_snapshots'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
 END LOOP;
END
$$;

CREATE FUNCTION public.field_commission_version(w uuid,rep uuid,role_name text,effective_date date) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT v.id FROM public.field_commission_plans p
 JOIN public.field_commission_versions v ON v.workspace_id=p.workspace_id AND v.plan_id=p.id
 WHERE p.workspace_id=w AND p.credit_role=role_name AND (p.representative_id=rep OR p.representative_id IS NULL)
   AND v.effective_on<=effective_date
 ORDER BY (p.representative_id IS NOT NULL) DESC,v.effective_on DESC LIMIT 1
$$;

CREATE FUNCTION public.field_commission_accrue(
 w uuid,rep uuid,role_name text,plan_version uuid,credit integer,trigger_id uuid,sale uuid,appointment uuid,
 trigger_kind text,basis bigint,occurred timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v public.field_commission_versions; rule record; amount bigint; kind text; share integer; raw_pool numeric; prefix integer;
BEGIN
 IF rep IS NULL THEN RETURN; END IF;
 IF plan_version IS NULL THEN
  INSERT INTO public.field_commission_exceptions(workspace_id,trigger_id,representative_id,credit_role,sale_id,appointment_id)
   VALUES(w,trigger_id,rep,role_name,sale,appointment) ON CONFLICT DO NOTHING;
  RETURN;
 END IF;
 SELECT * INTO STRICT v FROM public.field_commission_versions WHERE id=plan_version AND workspace_id=w;
 FOR rule IN SELECT value,ordinality::integer AS position FROM jsonb_array_elements(v.rules) WITH ORDINALITY LOOP
  kind:=rule.value->>'kind';
  IF (trigger_kind='held' AND kind<>'held_fee')
   OR (trigger_kind='verified' AND kind NOT IN ('sale_fee','contract_percent'))
   OR (trigger_kind='collection' AND kind<>'cash_percent') THEN CONTINUE; END IF;
  share:=CASE WHEN rule.value->>'split'='sale_credit' THEN credit ELSE 10000 END;
  raw_pool:=CASE WHEN kind IN ('held_fee','sale_fee') THEN (rule.value->>'amount_minor')::numeric
    ELSE basis::numeric*(rule.value->>'rate_bps')::numeric/10000 END;
  IF rule.value->>'split'='sale_credit' THEN
   SELECT coalesce(sum(s.basis_points),0)::integer INTO prefix
    FROM public.field_sale_commission_snapshots s
    WHERE s.sale_id=sale AND s.workspace_id=w AND s.representative_id<rep;
  ELSE prefix:=0;
  END IF;
  amount:=(round(raw_pool*(prefix+share)/10000)-round(raw_pool*prefix/10000))::bigint;
  IF amount=0 THEN CONTINUE; END IF;
  INSERT INTO public.field_earnings(
   workspace_id,representative_id,sale_id,appointment_id,plan_version_id,trigger_id,rule_index,
   kind,amount_minor,basis_minor,calculation,currency,accrued_at,created_by
  ) VALUES (w,rep,sale,appointment,v.id,trigger_id,rule.position,kind,amount,basis,
    rule.value||jsonb_build_object('credit_role',role_name,'applied_share_bps',share),v.currency,occurred,auth.uid())
   ON CONFLICT DO NOTHING;
 END LOOP;
END
$$;

CREATE FUNCTION public.field_commission_reverse(
 entry public.field_earnings,event_id uuid,occurred timestamptz,target_minor bigint,reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reversed bigint; remaining bigint;
BEGIN
 SELECT coalesce(-sum(amount_minor),0) INTO reversed
 FROM public.field_earnings WHERE original_earning_id=entry.id AND kind='reversal' AND status<>'rejected';
 remaining:=target_minor-reversed;
 IF remaining<=0 OR entry.status='rejected' THEN RETURN; END IF;
 INSERT INTO public.field_earnings(
  workspace_id,representative_id,sale_id,appointment_id,plan_version_id,trigger_id,rule_index,
  kind,amount_minor,basis_minor,calculation,currency,accrued_at,created_by,original_earning_id
 ) VALUES (entry.workspace_id,entry.representative_id,entry.sale_id,entry.appointment_id,entry.plan_version_id,
   event_id,entry.rule_index,'reversal',-remaining,entry.basis_minor,
   jsonb_build_object('reason',reason,'original_kind',entry.kind),entry.currency,occurred,auth.uid(),entry.id);
END
$$;
-- Reversal rows use the original earning as part of their idempotency key. Multiple
-- original earnings can be reversed by the same sale or appointment event.
CREATE UNIQUE INDEX field_earnings_one_accrual ON public.field_earnings(workspace_id,representative_id,trigger_id,kind,rule_index)
 WHERE original_earning_id IS NULL;
CREATE UNIQUE INDEX field_earnings_one_reversal ON public.field_earnings(original_earning_id,trigger_id)
 WHERE original_earning_id IS NOT NULL;

CREATE FUNCTION public.field_appointment_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.field_sales_settings; a public.field_appointments; entry public.field_earnings;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=NEW.workspace_id;
 IF NOT cfg.roofing_earnings_enabled THEN RETURN NEW; END IF;
 IF NEW.after_state->>'status'='held' AND (NEW.before_state->>'status') IS DISTINCT FROM 'held' THEN
  SELECT * INTO STRICT a FROM public.field_appointments WHERE id=NEW.appointment_id;
  PERFORM public.field_commission_accrue(a.workspace_id,a.setter_id,'setter',
   public.field_commission_version(a.workspace_id,a.setter_id,'setter',(a.outcome_at AT TIME ZONE a.timezone)::date),
   10000,NEW.id,NULL,a.id,'held',NULL,a.outcome_at);
 ELSIF NEW.before_state->>'status'='held' AND NEW.after_state->>'status'<>'held' THEN
  FOR entry IN SELECT * FROM public.field_earnings WHERE appointment_id=NEW.appointment_id AND kind='held_fee' FOR UPDATE LOOP
   PERFORM public.field_commission_reverse(entry,NEW.id,NEW.occurred_at,entry.amount_minor,'Held outcome corrected');
  END LOOP;
 END IF;
 RETURN NEW;
END
$$;

CREATE FUNCTION public.field_sale_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.field_sales_settings; credit public.field_sales_credits; snapshot public.field_sale_commission_snapshots; v uuid; entry public.field_earnings;
 event_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=NEW.workspace_id;
 IF NOT cfg.roofing_earnings_enabled OR NEW.sale_source='legacy' OR OLD.status=NEW.status THEN RETURN NEW; END IF;
 IF NEW.status='verified' AND OLD.status='pending' THEN
  FOR credit IN SELECT * FROM public.field_sales_credits WHERE sale_id=NEW.id LOOP
   v:=public.field_commission_version(NEW.workspace_id,credit.user_id,credit.role,NEW.sold_on);
   INSERT INTO public.field_sale_commission_snapshots VALUES
    (NEW.workspace_id,NEW.id,credit.user_id,credit.role,credit.basis_points,v);
  END LOOP;
  FOR snapshot IN SELECT * FROM public.field_sale_commission_snapshots WHERE sale_id=NEW.id LOOP
   IF snapshot.credit_role<>'setter' OR snapshot.plan_version_id IS NOT NULL THEN
    PERFORM public.field_commission_accrue(NEW.workspace_id,snapshot.representative_id,snapshot.credit_role,
      snapshot.plan_version_id,snapshot.basis_points,
      NEW.id,NEW.id,NEW.field_appointment_id,'verified',NEW.value_minor,NEW.verified_at);
   END IF;
  END LOOP;
 ELSIF OLD.status='verified' AND NEW.status IN ('cancelled','refunded','charged_back') THEN
  FOR entry IN SELECT * FROM public.field_earnings WHERE sale_id=NEW.id AND kind IN ('sale_fee','contract_percent') FOR UPDATE LOOP
   PERFORM public.field_commission_reverse(entry,event_id,now(),entry.amount_minor,'Contract reversed');
  END LOOP;
 END IF;
 RETURN NEW;
END
$$;

CREATE FUNCTION public.field_payment_commission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.field_sales; receipt public.field_sales_payments; previously numeric;
BEGIN
 SELECT * INTO STRICT s FROM public.field_sales WHERE id=NEW.sale_id AND workspace_id=NEW.workspace_id;
 IF s.sale_source='legacy' THEN RETURN NEW; END IF;
 IF NEW.kind='collection' THEN
  IF NEW.reverses_payment_id IS NOT NULL THEN RAISE EXCEPTION 'A collection cannot reverse a receipt'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO receipt FROM public.field_sales_payments WHERE id=NEW.reverses_payment_id
   AND workspace_id=NEW.workspace_id AND sale_id=NEW.sale_id AND kind='collection' FOR UPDATE;
 IF NOT FOUND OR NEW.occurred_at<receipt.occurred_at THEN
  RAISE EXCEPTION 'Select the original collection to reverse';
 END IF;
 SELECT coalesce(-sum(amount_minor),0) INTO previously FROM public.field_sales_payments
   WHERE reverses_payment_id=receipt.id;
 IF previously-NEW.amount_minor>receipt.amount_minor THEN RAISE EXCEPTION 'Reversal exceeds the remaining receipt amount'; END IF;
 RETURN NEW;
END
$$;

CREATE FUNCTION public.field_payment_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.field_sales_settings; snapshot public.field_sale_commission_snapshots; entry public.field_earnings;
 refunded numeric; collected bigint;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=NEW.workspace_id;
 IF NOT cfg.roofing_earnings_enabled THEN RETURN NEW; END IF;
 IF NEW.kind='collection' THEN
  FOR snapshot IN SELECT * FROM public.field_sale_commission_snapshots WHERE sale_id=NEW.sale_id LOOP
   IF snapshot.credit_role='setter' AND snapshot.plan_version_id IS NULL THEN CONTINUE; END IF;
   PERFORM public.field_commission_accrue(NEW.workspace_id,snapshot.representative_id,snapshot.credit_role,
    snapshot.plan_version_id,snapshot.basis_points,NEW.id,NEW.sale_id,NULL,'collection',NEW.amount_minor,NEW.occurred_at);
  END LOOP;
 ELSIF NEW.reverses_payment_id IS NOT NULL THEN
  SELECT amount_minor INTO STRICT collected FROM public.field_sales_payments WHERE id=NEW.reverses_payment_id;
  SELECT -sum(amount_minor) INTO refunded FROM public.field_sales_payments WHERE reverses_payment_id=NEW.reverses_payment_id;
  FOR entry IN SELECT * FROM public.field_earnings WHERE trigger_id=NEW.reverses_payment_id AND kind='cash_percent' FOR UPDATE LOOP
   PERFORM public.field_commission_reverse(entry,NEW.id,NEW.occurred_at,
     round(entry.amount_minor::numeric*refunded/collected)::bigint,'Customer receipt reversed');
  END LOOP;
 END IF;
 RETURN NEW;
END
$$;

CREATE TRIGGER field_appointment_commission_event AFTER INSERT ON public.field_appointment_events
 FOR EACH ROW EXECUTE FUNCTION public.field_appointment_commission_event();
CREATE TRIGGER field_sale_commission_event AFTER UPDATE OF status ON public.field_sales
 FOR EACH ROW EXECUTE FUNCTION public.field_sale_commission_event();
CREATE TRIGGER field_payment_commission_guard BEFORE INSERT ON public.field_sales_payments
 FOR EACH ROW EXECUTE FUNCTION public.field_payment_commission_guard();
CREATE TRIGGER field_payment_commission_event AFTER INSERT ON public.field_sales_payments
 FOR EACH ROW EXECUTE FUNCTION public.field_payment_commission_event();

REVOKE ALL ON FUNCTION public.field_commission_version(uuid,uuid,text,date),
 public.field_commission_accrue(uuid,uuid,text,uuid,integer,uuid,uuid,uuid,text,bigint,timestamptz),
 public.field_commission_reverse(public.field_earnings,uuid,timestamptz,bigint,text),
 public.field_appointment_commission_event(),public.field_sale_commission_event(),
 public.field_payment_commission_guard(),public.field_payment_commission_event() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.field_earnings_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid();
 role_name text:=public.field_sales_role(p_workspace);
 cfg public.field_sales_settings;
 req uuid:=(p_data->>'request_id')::uuid;
 prior public.field_sales_requests;
 entry public.field_earnings;
 source public.field_earnings;
 plan public.field_commission_plans;
 plan_version public.field_commission_versions;
 target_rep uuid;
 target_role text;
 plan_rules jsonb;
 item jsonb;
 kind text;
 effective date;
 entry_status text;
 reason text:=nullif(trim(p_data->>'reason'),'');
 reference text:=nullif(trim(p_data->>'payment_reference'),'');
 settlement_date timestamptz:=CASE WHEN coalesce((p_data->>'paid_now')::boolean,false)
   THEN now() ELSE (p_data->>'paid_at')::timestamptz END;
 sale_id uuid;
 appointment_id uuid;
 amount bigint;
 result jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled AND cfg.roofing_earnings_enabled AND cfg.roofing_earnings_writes_enabled,false)
    OR role_name NOT IN ('owner','admin','manager') THEN
  RAISE EXCEPTION 'Earnings administration unavailable' USING ERRCODE='42501';
 END IF;
 IF req IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Request ID is required'; END IF;
 SELECT * INTO prior FROM public.field_sales_requests WHERE workspace_id=p_workspace AND actor_id=actor AND request_id=req;
 IF FOUND THEN
  IF prior.action IS DISTINCT FROM 'earnings.'||p_action OR prior.payload IS DISTINCT FROM p_data THEN
   RAISE EXCEPTION 'Request ID was used for different inputs';
  END IF;
  RETURN prior.result;
 END IF;

 IF p_action='publish_plan' THEN
  IF role_name NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  target_rep:=(p_data->>'representative_id')::uuid;
  target_role:=p_data->>'role';
  effective:=(p_data->>'effective_on')::date;
  plan_rules:=p_data->'rules';
  IF coalesce(target_role,'') NOT IN ('setter','closer','full_cycle','contributor') OR
     coalesce(length(trim(p_data->>'title')),0) NOT BETWEEN 1 AND 150 OR
     effective IS NULL OR effective < (now() AT TIME ZONE cfg.timezone)::date OR
     NOT isfinite(effective) OR cfg.currency IS NULL OR
     jsonb_typeof(plan_rules) IS DISTINCT FROM 'array' OR jsonb_array_length(plan_rules) NOT BETWEEN 1 AND 10
  THEN RAISE EXCEPTION 'Supply a title, role, current or future effective date and valid rules'; END IF;
  IF target_rep IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=target_rep
  ) THEN RAISE EXCEPTION 'Representative unavailable in this workspace'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(plan_rules) LOOP
   kind:=item->>'kind';
   IF coalesce(kind,'') NOT IN ('held_fee','sale_fee','contract_percent','cash_percent') OR
      (kind='held_fee' AND (target_role<>'setter' OR item->>'split'='sale_credit')) OR
      coalesce(item->>'split','none') NOT IN ('none','sale_credit') OR
      (kind IN ('held_fee','sale_fee') AND coalesce((item->>'amount_minor')::bigint,0) NOT BETWEEN 1 AND 9000000000000000) OR
      (kind IN ('contract_percent','cash_percent') AND coalesce((item->>'rate_bps')::integer,0) NOT BETWEEN 1 AND 10000)
   THEN RAISE EXCEPTION 'Invalid commission rule'; END IF;
  END LOOP;
  IF NOT coalesce((p_data->>'allow_multiple_rules')::boolean,false) AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(plan_rules) value
   GROUP BY CASE value->>'kind' WHEN 'held_fee' THEN 'held' WHEN 'cash_percent' THEN 'collection' ELSE 'verified' END
   HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Confirm multiple rules for the same trigger'; END IF;
  SELECT * INTO plan FROM public.field_commission_plans p
   WHERE p.workspace_id=p_workspace AND p.credit_role=target_role AND p.representative_id IS NOT DISTINCT FROM target_rep;
  IF NOT FOUND THEN
   INSERT INTO public.field_commission_plans VALUES(gen_random_uuid(),p_workspace,target_rep,target_role) RETURNING * INTO plan;
  END IF;
  INSERT INTO public.field_commission_versions(workspace_id,plan_id,version,effective_on,title,rules,currency,published_by)
   SELECT p_workspace,plan.id,coalesce(max(v.version),0)+1,effective,trim(p_data->>'title'),plan_rules,cfg.currency,actor
   FROM public.field_commission_versions v WHERE v.plan_id=plan.id
   RETURNING * INTO plan_version;
  result:=jsonb_build_object('id',plan_version.id,'plan_id',plan.id,'version',plan_version.version);

 ELSIF p_action IN ('approve','reject','settle') THEN
  SELECT * INTO entry FROM public.field_earnings e
   WHERE e.id=(p_data->>'id')::uuid AND e.workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND OR entry.version IS DISTINCT FROM (p_data->>'version')::integer THEN
   RAISE EXCEPTION 'Earning unavailable or changed; refresh before reviewing';
  END IF;
  IF entry.representative_id=actor THEN
   RAISE EXCEPTION 'Another authorized reviewer must approve or settle your earnings' USING ERRCODE='42501';
  END IF;
  IF p_action='settle' THEN
   IF entry.status<>'approved' OR coalesce(length(reference),0) NOT BETWEEN 1 AND 250
      OR settlement_date IS NULL OR NOT isfinite(settlement_date) OR settlement_date>now()
      OR settlement_date<entry.accrued_at THEN
    RAISE EXCEPTION 'An approved earning, valid payment date and external reference are required';
   END IF;
   UPDATE public.field_earnings e SET status='paid',paid_at=settlement_date,paid_by=actor,
     payment_reference=reference,version=e.version+1 WHERE e.id=entry.id RETURNING * INTO entry;
  ELSE
   IF entry.status<>'pending' OR (p_action='reject' AND (
      reason IS NULL OR entry.kind='reversal' OR EXISTS (
       SELECT 1 FROM public.field_earnings reversal WHERE reversal.original_earning_id=entry.id
      ))) THEN RAISE EXCEPTION 'This earning needs a correction rather than rejection'; END IF;
   entry_status:=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END;
   UPDATE public.field_earnings e SET status=entry_status,reviewed_at=now(),reviewed_by=actor,
     review_reason=reason,version=e.version+1 WHERE e.id=entry.id RETURNING * INTO entry;
  END IF;
  INSERT INTO public.field_earning_events(earning_id,workspace_id,actor_id,action,reason,version)
   VALUES(entry.id,p_workspace,actor,p_action,coalesce(reason,reference),entry.version);
  result:=jsonb_build_object('id',entry.id,'version',entry.version,'status',entry.status);

 ELSIF p_action IN ('bonus','adjustment') THEN
  amount:=(p_data->>'amount_minor')::bigint;
  IF amount IS NULL OR amount=0 OR (p_action='bonus' AND amount<0) OR
      coalesce(length(reason),0) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'A valid amount and reason are required';
  END IF;
  IF p_data ? 'original_earning_id' THEN
   SELECT * INTO source FROM public.field_earnings e
    WHERE e.id=(p_data->>'original_earning_id')::uuid AND e.workspace_id=p_workspace;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original earning unavailable'; END IF;
   sale_id:=source.sale_id;
   appointment_id:=source.appointment_id;
   target_rep:=source.representative_id;
  ELSE
   target_rep:=(p_data->>'representative_id')::uuid;
   sale_id:=(p_data->>'sale_id')::uuid;
   appointment_id:=(p_data->>'appointment_id')::uuid;
   IF target_rep IS NULL OR num_nonnulls(sale_id,appointment_id)<>1 OR
      NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=target_rep) OR
      (sale_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.field_sales s WHERE s.id=sale_id AND s.workspace_id=p_workspace
      )) OR (appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.field_appointments a WHERE a.id=appointment_id AND a.workspace_id=p_workspace
      )) THEN RAISE EXCEPTION 'Representative or source unavailable'; END IF;
  END IF;
  INSERT INTO public.field_earnings(workspace_id,representative_id,sale_id,appointment_id,plan_version_id,
   trigger_id,kind,amount_minor,calculation,currency,accrued_at,created_by,original_earning_id)
   VALUES(p_workspace,target_rep,sale_id,appointment_id,source.plan_version_id,req,p_action,amount,
    jsonb_build_object('reason',reason),coalesce(source.currency,cfg.currency),now(),actor,source.id)
   RETURNING * INTO entry;
  INSERT INTO public.field_earning_events(earning_id,workspace_id,actor_id,action,reason,version)
   VALUES(entry.id,p_workspace,actor,p_action,reason,entry.version);
  result:=jsonb_build_object('id',entry.id,'version',entry.version,'status',entry.status);
 ELSE RAISE EXCEPTION 'Unknown earnings action'; END IF;
 INSERT INTO public.field_sales_requests(workspace_id,actor_id,request_id,action,payload,result)
  VALUES(p_workspace,actor,req,'earnings.'||p_action,p_data,result);
 RETURN result;
END
$$;

CREATE FUNCTION public.field_earnings_list(
 p_workspace uuid,p_filter jsonb DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid();
 role_name text:=public.field_sales_role(p_workspace);
 cfg public.field_sales_settings;
 team boolean:=coalesce((p_filter->>'team')::boolean,false);
 sales_filter uuid:=(p_filter->>'sale_id')::uuid;
 from_date date:=(p_filter->>'start_on')::date;
 until_date date:=(p_filter->>'end_on')::date;
 starts timestamptz;
 ends timestamptz;
 date_mode text:=coalesce(p_filter->>'date_mode','accrued');
 status_filter text:=p_filter->>'status';
 page_offset integer:=greatest(0,coalesce((p_filter->>'offset')::integer,0));
 result jsonb;
BEGIN
 IF team AND role_name NOT IN ('owner','admin','manager') THEN
  RAISE EXCEPTION 'Team earnings access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.roofing_earnings_enabled,false) AND NOT EXISTS (
   SELECT 1 FROM public.field_earnings e WHERE e.workspace_id=p_workspace AND (team OR e.representative_id=actor)
 ) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF date_mode NOT IN ('accrued','paid') OR (status_filter IS NOT NULL AND status_filter NOT IN ('pending','approved','paid','rejected')) THEN
  RAISE EXCEPTION 'Invalid earnings filter';
 END IF;
 starts:=from_date::timestamp AT TIME ZONE cfg.timezone;
 ends:=(until_date+1)::timestamp AT TIME ZONE cfg.timezone;
 IF starts>ends THEN RAISE EXCEPTION 'Invalid earnings period'; END IF;
 WITH scoped AS (
  SELECT e.*, CASE WHEN date_mode='paid' THEN e.paid_at ELSE e.accrued_at END AS report_at
  FROM public.field_earnings e
  WHERE e.workspace_id=p_workspace AND (team OR e.representative_id=actor)
    AND (sales_filter IS NULL OR e.sale_id=sales_filter)
 ), filtered AS (
  SELECT * FROM scoped e WHERE e.report_at IS NOT NULL AND (starts IS NULL OR e.report_at>=starts)
    AND (ends IS NULL OR e.report_at<ends)
 ), page AS (
  SELECT e.* FROM filtered e WHERE status_filter IS NULL OR e.status=status_filter
   ORDER BY e.report_at DESC,e.id LIMIT 100 OFFSET page_offset
 )
 SELECT jsonb_build_object(
  'enabled',true,'can_manage',team AND cfg.roofing_earnings_writes_enabled,
  'can_publish',team AND role_name IN ('owner','admin') AND cfg.roofing_earnings_writes_enabled,
  'currency',cfg.currency,'timezone',cfg.timezone,'actor_id',actor,
  'count',(SELECT count(*) FROM filtered e WHERE status_filter IS NULL OR e.status=status_filter),
  'summary',(SELECT jsonb_build_object(
    'total_minor',coalesce(sum(e.amount_minor) FILTER (WHERE e.status<>'rejected'),0)::text,
    'pending_minor',coalesce(sum(e.amount_minor) FILTER (WHERE e.status='pending'),0)::text,
    'approved_minor',coalesce(sum(e.amount_minor) FILTER (WHERE e.status='approved'),0)::text,
    'paid_minor',coalesce(sum(e.amount_minor) FILTER (WHERE e.status='paid'),0)::text,
    'adjustments_minor',coalesce(sum(e.amount_minor) FILTER (WHERE e.status<>'rejected' AND e.kind IN ('adjustment','reversal','bonus')),0)::text,
    'sales',count(DISTINCT e.sale_id) FILTER(WHERE e.status<>'rejected'),
    'appointments',count(DISTINCT e.appointment_id) FILTER(WHERE e.status<>'rejected' AND e.kind='held_fee')
   ) FROM filtered e),
  'entries',coalesce((SELECT jsonb_agg((to_jsonb(e)-'amount_minor'-'basis_minor')||jsonb_build_object(
    'amount_minor',e.amount_minor::text,'basis_minor',e.basis_minor::text,
    'representative',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
    'source_label',CASE WHEN team OR c.user_id=actor OR a.assignee_id=actor OR a.setter_id=actor THEN c.full_name END,
    'plan_title',v.title,'plan_version',v.version
   ) ORDER BY e.report_at DESC,e.id)
   FROM page e JOIN auth.users u ON u.id=e.representative_id
   LEFT JOIN public.field_commission_versions v ON v.id=e.plan_version_id
   LEFT JOIN public.field_appointments a ON a.id=e.appointment_id
   LEFT JOIN public.field_sales s ON s.id=e.sale_id
   LEFT JOIN public.contacts c ON c.id=coalesce(a.contact_id,s.contact_id) AND c.workspace_id=p_workspace),'[]')
 ) INTO result;
 IF team THEN
  result:=result||jsonb_build_object(
   'unresolved_plan_count',(SELECT count(*) FROM public.field_commission_exceptions x WHERE x.workspace_id=p_workspace),
   'plans',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object(
     'role',p.credit_role,'representative_id',p.representative_id
   ) ORDER BY v.effective_on DESC,v.version DESC)
   FROM public.field_commission_versions v JOIN public.field_commission_plans p ON p.id=v.plan_id
   WHERE v.workspace_id=p_workspace),'[]')
  );
 END IF;
 RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.field_earnings_command(uuid,text,jsonb),public.field_earnings_list(uuid,jsonb)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_earnings_command(uuid,text,jsonb),public.field_earnings_list(uuid,jsonb)
 TO authenticated;
COMMIT;
