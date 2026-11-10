BEGIN;

ALTER TABLE public.field_sales_settings
  ADD COLUMN roofing_sales_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roofing_sale_writes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN roofing_required_sale_fields jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(roofing_required_sale_fields)='array' AND
           roofing_required_sale_fields <@ '["product","job_identifier","proof_reference"]'::jsonb);

ALTER TABLE public.field_sales_opportunities
  ADD COLUMN legacy_slot boolean NOT NULL DEFAULT true,
  ADD COLUMN job_label text CHECK (length(job_label) BETWEEN 1 AND 150),
  ADD COLUMN campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN campaign_address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  ADD COLUMN field_appointment_id uuid REFERENCES public.field_appointments(id),
  ADD COLUMN inspection_completed_at timestamptz,
  ADD COLUMN estimate_sent_at timestamptz;

CREATE UNIQUE INDEX field_sales_legacy_opportunity
  ON public.field_sales_opportunities(workspace_id,contact_id) WHERE legacy_slot;
ALTER TABLE public.field_sales_opportunities DROP CONSTRAINT field_sales_opportunities_pkey;
ALTER TABLE public.field_sales_opportunities ADD PRIMARY KEY (id);
CREATE INDEX field_sales_opportunities_workspace_contact ON public.field_sales_opportunities(workspace_id,contact_id);
CREATE INDEX field_sales_opportunities_workspace_owner ON public.field_sales_opportunities(workspace_id,user_id,stage_key);

UPDATE public.field_sales_opportunities o SET campaign_id=cp.id,
  campaign_address_id=(
    SELECT ca.id FROM public.campaign_addresses ca WHERE ca.campaign_id=cp.id
      AND ca.id::text=coalesce(to_jsonb(c)->>'address_id',to_jsonb(c)->>'campaign_address_id')
  )
FROM public.contacts c JOIN public.campaigns cp ON cp.id=c.campaign_id AND cp.workspace_id=c.workspace_id
WHERE c.id=o.contact_id AND c.workspace_id=o.workspace_id;

ALTER TABLE public.field_sales
  ADD COLUMN field_appointment_id uuid REFERENCES public.field_appointments(id),
  ADD COLUMN sale_source text NOT NULL DEFAULT 'legacy' CHECK (sale_source IN ('legacy','appointment','door')),
  ADD COLUMN assigned_closer_id uuid REFERENCES auth.users(id),
  ADD COLUMN proof_reference text CHECK (length(proof_reference)<=1000),
  ADD COLUMN duplicate_review boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT field_sales_roofing_source_shape CHECK (
    (sale_source='legacy' AND field_appointment_id IS NULL) OR
    (sale_source='door' AND field_appointment_id IS NULL AND appointment_id IS NULL AND opportunity_id IS NOT NULL) OR
    (sale_source='appointment' AND field_appointment_id IS NOT NULL AND appointment_id IS NULL AND opportunity_id IS NOT NULL)
  );

ALTER TABLE public.field_sales_payments
  ADD COLUMN reverses_payment_id uuid REFERENCES public.field_sales_payments(id);

CREATE UNIQUE INDEX field_sales_one_canonical_conversion ON public.field_sales(field_appointment_id)
  WHERE field_appointment_id IS NOT NULL AND status IN ('pending','verified');
CREATE UNIQUE INDEX field_sales_one_roofing_opportunity_conversion ON public.field_sales(opportunity_id)
  WHERE sale_source<>'legacy' AND status IN ('pending','verified');

-- Keep the installed legacy source rule for historical and non-pilot writes.
ALTER FUNCTION public.field_sales_require_appointment_source() RENAME TO field_sales_legacy_source_guard;
DROP TRIGGER field_sales_require_appointment_source ON public.field_sales;
CREATE TRIGGER field_sales_require_appointment_source
  BEFORE INSERT OR UPDATE OF appointment_id,contact_id,rep_id ON public.field_sales
  FOR EACH ROW WHEN (NEW.sale_source='legacy') EXECUTE FUNCTION public.field_sales_legacy_source_guard();

CREATE FUNCTION public.field_sales_roofing_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND (
     NEW.sale_source IS DISTINCT FROM OLD.sale_source OR
     NEW.field_appointment_id IS DISTINCT FROM OLD.field_appointment_id OR
     NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id OR
     NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  ) THEN RAISE EXCEPTION 'A recorded sale must retain its original source and opportunity'; END IF;
  IF NEW.sale_source<>'legacy' AND NOT EXISTS (
    SELECT 1 FROM public.field_sales_opportunities o
    WHERE o.id=NEW.opportunity_id AND o.workspace_id=NEW.workspace_id AND o.contact_id=NEW.contact_id
  ) THEN RAISE EXCEPTION 'Sale opportunity does not match its contact or workspace'; END IF;
  IF NEW.sale_source='appointment' AND (TG_OP='INSERT' OR
      (NEW.status='verified' AND OLD.status IS DISTINCT FROM 'verified')) AND NOT EXISTS (
    SELECT 1 FROM public.field_appointments a
    WHERE a.id=NEW.field_appointment_id AND a.workspace_id=NEW.workspace_id
      AND a.contact_id=NEW.contact_id AND a.status='held' AND a.outcome_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'A held appointment in the sale workspace is required'; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER field_sales_roofing_source_guard BEFORE INSERT OR UPDATE OF
  sale_source,field_appointment_id,opportunity_id,contact_id,workspace_id,status ON public.field_sales
  FOR EACH ROW WHEN (NEW.sale_source<>'legacy') EXECUTE FUNCTION public.field_sales_roofing_source_guard();
REVOKE ALL ON FUNCTION public.field_sales_roofing_source_guard() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.field_sales_roofing_credit_correction(
  w uuid,s public.field_sales,data jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  allocations jsonb := data->'credits';
  previous jsonb;
  result jsonb;
  next_version integer;
BEGIN
  IF NOT public.field_sales_permission(w,'attribution') OR NOT EXISTS (
    SELECT 1 FROM public.field_sales_settings WHERE workspace_id=w AND roofing_sale_writes_enabled
  ) THEN RAISE EXCEPTION 'Credit correction permission required' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(data) k
       WHERE k NOT IN ('id','version','request_id','reason','credits'))
     OR coalesce(length(trim(data->>'reason')),0) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Supply credit allocations and a correction reason';
  END IF;
  IF jsonb_typeof(allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(allocations) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Supply one to twenty credit allocations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(allocations) x
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=w AND m.user_id=(x->>'user_id')::uuid
    ) OR coalesce((x->>'basis_points')::integer,-1) NOT BETWEEN 0 AND 10000
    OR x->>'role' IS DISTINCT FROM CASE
      WHEN (x->>'user_id')::uuid=s.closer_id AND s.closer_id=s.setter_id THEN 'full_cycle'
      WHEN (x->>'user_id')::uuid=s.closer_id THEN 'closer'
      WHEN (x->>'user_id')::uuid=s.setter_id THEN 'setter'
      ELSE 'contributor' END
  ) OR (SELECT sum((x->>'basis_points')::integer) FROM jsonb_array_elements(allocations) x) <> 10000
    OR (SELECT count(DISTINCT (x->>'user_id')::uuid) FROM jsonb_array_elements(allocations) x) <> jsonb_array_length(allocations)
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(allocations) x WHERE (x->>'user_id')::uuid=s.closer_id)
    OR (s.setter_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(allocations) x WHERE (x->>'user_id')::uuid=s.setter_id
    )) THEN RAISE EXCEPTION 'Credit must total 100 percent and preserve verified roles'; END IF;

  SELECT jsonb_agg(to_jsonb(c)) INTO previous FROM public.field_sales_credits c WHERE sale_id=s.id;
  DELETE FROM public.field_sales_credits WHERE sale_id=s.id;
  INSERT INTO public.field_sales_credits(workspace_id,sale_id,user_id,role,basis_points,rep_name_snapshot,team_id,team_name_snapshot)
    SELECT w,s.id,u.id,x->>'role',(x->>'basis_points')::integer,
      coalesce(old.value->>'rep_name_snapshot',u.raw_user_meta_data->>'full_name',
               u.raw_user_meta_data->>'name','Representative'),
      (old.value->>'team_id')::uuid,old.value->>'team_name_snapshot'
    FROM jsonb_array_elements(allocations) x JOIN auth.users u ON u.id=(x->>'user_id')::uuid
    LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(coalesce(previous,'[]')) WHERE value->>'user_id'=u.id::text
    ) old ON true;
  UPDATE public.field_sales SET version=version+1,updated_at=now() WHERE id=s.id RETURNING version INTO next_version;
  INSERT INTO public.field_sales_events(workspace_id,sale_id,actor_id,action,before_record,after_record)
    VALUES(w,s.id,auth.uid(),'credit',jsonb_build_object('credits',previous),
      jsonb_build_object('credits',allocations,'reason',data->>'reason'));
  result := jsonb_build_object('id',s.id,'version',next_version,'status',s.status);
  INSERT INTO public.field_sales_requests(workspace_id,actor_id,request_id,action,payload,result)
    VALUES(w,auth.uid(),(data->>'request_id')::uuid,'attribution',data,result);
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.field_sales_roofing_credit_correction(uuid,public.field_sales,jsonb)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.field_sales_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; previous_cfg jsonb;
 c public.contacts; cj jsonb; booking public.field_appointments; a public.contact_activities; sale public.field_sales; old public.field_sales;
 op public.field_sales_opportunities; ev jsonb; cp jsonb; prior_request public.field_sales_requests;
 rep uuid; setter uuid; closer uuid; rid uuid; sid uuid; team uuid; tm_name text;
 credits jsonb; cr jsonb; credit_rep uuid; credit_total integer:=0; credit_n integer:=0;
 result jsonb; input_data jsonb:=p_data; old_credits jsonb; req uuid:=nullif(p_data->>'request_id','')::uuid; amount bigint; cash numeric; payment_id uuid;
 mode text; roof boolean; actual_date date; duplicate_review boolean := false;
 local_day date; reason text; duplicate_id uuid; cap text; pair record; source text; property text;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) THEN RAISE EXCEPTION 'Sales is not enabled for this workspace'; END IF;
 IF cfg.roofing_sales_enabled AND p_action IN (
   'submit','edit','attribution','verify','reject','cancel','refund','chargeback','complete','collect','refund_payment','chargeback_payment'
 ) AND p_data->>'client_contract_version' IS DISTINCT FROM '2' THEN
  RAISE EXCEPTION 'Update WolfGrid to manage sales in this workspace' USING ERRCODE='0A000';
 END IF;
 p_data:=p_data-'client_contract_version';
 input_data:=p_data;
 IF p_action='submit' AND cfg.roofing_sales_enabled AND NOT (p_data ? 'sale_source') THEN
  RAISE EXCEPTION 'Update WolfGrid to record sales in this workspace' USING ERRCODE='0A000';
 END IF;
 IF p_action='submit' AND p_data ? 'sale_source' THEN
  mode:=p_data->>'sale_source';
  IF NOT (cfg.roofing_sales_enabled AND cfg.roofing_sale_writes_enabled AND cfg.roofing_appointments_enabled)
     OR coalesce(mode,'') NOT IN ('appointment','door') THEN
   RAISE EXCEPTION 'Roofing sale entry is unavailable' USING ERRCODE='42501';
  END IF;
 END IF;
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
  IF p_data ? 'roofing_required_sale_fields' AND NOT cfg.roofing_sales_enabled THEN
   RAISE EXCEPTION 'Roofing sales are not enabled';
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
   roofing_required_sale_fields=coalesce(p_data->'roofing_required_sale_fields',roofing_required_sale_fields),
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
  actual_date:=coalesce(nullif(p_data->>'sold_on','')::date,local_day);
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
   IF old.sale_source <> 'legacy' THEN
    IF p_action='edit' THEN
     RAISE EXCEPTION 'Use a sale correction to update a roofing sale' USING ERRCODE='22023';
    END IF;
    IF req IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
    RETURN public.field_sales_roofing_credit_correction(p_workspace,old,p_data);
   END IF;
   p_data:=to_jsonb(old)||p_data;
  ELSIF req IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
  roof:=mode IS NOT NULL;
  SELECT * INTO c FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501'; END IF;
  cj:=to_jsonb(c);
  IF roof THEN
   IF p_data ?| ARRAY['appointment_id','rep_id','setter_id','credits','commission_minor','gross_profit_minor','attribution_source','campaign_id'] THEN
    RAISE EXCEPTION 'Source, attribution and commission are determined by the roofing sale command';
   END IF;
   IF p_data ? 'opportunity_id' THEN
    SELECT * INTO op FROM public.field_sales_opportunities
     WHERE id=(p_data->>'opportunity_id')::uuid AND workspace_id=p_workspace AND contact_id=c.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity unavailable for this contact'; END IF;
   END IF;
   IF mode='appointment' THEN
    SELECT * INTO booking FROM public.field_appointments WHERE id=(p_data->>'field_appointment_id')::uuid
     AND workspace_id=p_workspace AND contact_id=c.id AND status='held' FOR SHARE;
    IF NOT FOUND OR (booking.start_at AT TIME ZONE cfg.timezone)::date>actual_date OR
       (booking.outcome_at AT TIME ZONE cfg.timezone)::date>actual_date OR
       NOT (coalesce(booking.assignee_id=auth.uid(),false) OR public.field_sales_permission(p_workspace,'team_details')) THEN
     RAISE EXCEPTION 'Select an accessible held appointment that precedes the sale' USING ERRCODE='42501';
    END IF;
    setter:=booking.setter_id;
    IF op.id IS NOT NULL AND (op.campaign_id IS DISTINCT FROM booking.campaign_id OR
         op.campaign_address_id IS DISTINCT FROM booking.campaign_address_id) THEN
     RAISE EXCEPTION 'Opportunity and appointment property or campaign do not match';
    END IF;
   ELSE
    IF p_data ? 'field_appointment_id' THEN RAISE EXCEPTION 'Door sales do not use appointments'; END IF;
    IF NOT (c.user_id=auth.uid() OR coalesce(op.user_id=auth.uid(),false) OR public.field_sales_permission(p_workspace,'team_details')) THEN
     RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501';
    END IF;
   END IF;
   closer:=coalesce(nullif(p_data->>'closer_id','')::uuid,auth.uid());
   rep:=closer;
   IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(cfg.roofing_required_sale_fields) field
    WHERE nullif(trim(p_data->>field),'') IS NULL
   ) THEN RAISE EXCEPTION 'Fill in the required sale details'; END IF;
   IF length(coalesce(p_data->>'proof_reference',''))>1000 THEN RAISE EXCEPTION 'Proof reference is too long'; END IF;
  ELSE
   IF c.user_id<>auth.uid() AND NOT public.field_sales_permission(p_workspace,'team_details') THEN
    RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501';
   END IF;
   rep:=coalesce(nullif(p_data->>'rep_id','')::uuid,c.user_id);
   setter:=coalesce(nullif(p_data->>'setter_id','')::uuid,c.user_id);
   closer:=coalesce(nullif(p_data->>'closer_id','')::uuid,rep);
   IF (setter IS DISTINCT FROM c.user_id OR closer IS DISTINCT FROM rep) AND NOT public.field_sales_permission(p_workspace,'attribution')
    AND (old.id IS NULL OR setter IS DISTINCT FROM old.setter_id OR closer IS DISTINCT FROM old.closer_id) THEN
    RAISE EXCEPTION 'Setter or closer assignment requires manager permission' USING ERRCODE='42501';
   END IF;
  END IF;
  IF rep<>auth.uid() AND NOT public.field_sales_permission(p_workspace,'attribution') THEN
   RAISE EXCEPTION 'Representative assignment requires manager permission' USING ERRCODE='42501';
  END IF;
  FOREACH rid IN ARRAY ARRAY[rep,setter,closer] LOOP
   IF rid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=rid) THEN RAISE EXCEPTION 'Representative must belong to this workspace'; END IF;
  END LOOP;
  IF NOT roof THEN
   SELECT * INTO op FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=c.id AND legacy_slot;
   IF nullif(p_data->>'opportunity_id','') IS NOT NULL AND (op.id IS NULL OR op.id<>(p_data->>'opportunity_id')::uuid) THEN
    RAISE EXCEPTION 'Opportunity must belong to this lead';
   END IF;
  END IF;
  IF nullif(p_data->>'appointment_id','') IS NOT NULL THEN
   SELECT * INTO a FROM public.contact_activities WHERE id=(p_data->>'appointment_id')::uuid AND contact_id=c.id AND type='meeting';
   IF NOT FOUND OR coalesce(to_jsonb(a)->>'status','') IN ('cancelled','canceled') OR a.timestamp>now() OR (a.timestamp AT TIME ZONE cfg.timezone)::date>coalesce(nullif(p_data->>'sold_on','')::date,local_day) THEN RAISE EXCEPTION 'Appointment must belong to this lead and precede the sale'; END IF;
  END IF;
  IF nullif(p_data->>'campaign_id','') IS NOT NULL AND (p_data->>'campaign_id')::uuid IS DISTINCT FROM c.campaign_id AND NOT public.field_sales_permission(p_workspace,'attribution') THEN RAISE EXCEPTION 'Campaign corrections require manager permission'; END IF;
  SELECT to_jsonb(x) INTO cp FROM public.campaigns x WHERE workspace_id=p_workspace AND id=coalesce(nullif(p_data->>'campaign_id','')::uuid,c.campaign_id);
  IF coalesce(nullif(p_data->>'campaign_id','')::uuid,c.campaign_id) IS NOT NULL AND cp IS NULL THEN RAISE EXCEPTION 'Campaign must belong to this workspace'; END IF;
  IF roof AND coalesce(booking.campaign_id,op.campaign_id) IS NOT NULL THEN
   SELECT to_jsonb(x) INTO cp FROM public.campaigns x
    WHERE workspace_id=p_workspace AND id=coalesce(booking.campaign_id,op.campaign_id);
  END IF;
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
  IF roof THEN
   property:=coalesce(booking.campaign_address_id::text,op.campaign_address_id::text,
     nullif(cj->>'address_id',''),nullif(cj->>'campaign_address_id',''),nullif(lower(trim(booking.property_label)),''),property);
   IF mode='door' AND property IS NULL AND ev IS NULL THEN
    RAISE EXCEPTION 'Link the contact to a property or qualifying door visit';
   END IF;
   IF mode='door' AND ev IS NOT NULL THEN
    SELECT sn.user_id INTO setter FROM public.sessions sn WHERE sn.id=(ev->>'session_id')::uuid
     AND sn.workspace_id=p_workspace AND EXISTS (
      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=sn.user_id
     );
    IF setter IS DISTINCT FROM auth.uid() AND NOT public.field_sales_permission(p_workspace,'attribution') THEN
     RAISE EXCEPTION 'Select one of your own door visits or ask a manager' USING ERRCODE='42501';
    END IF;
   END IF;
  END IF;
  IF op.id IS NULL THEN
   PERFORM public.field_sales_seed_stages(p_workspace);
   INSERT INTO public.field_sales_opportunities(workspace_id,contact_id,user_id,stage_key,legacy_slot,job_label,campaign_id,campaign_address_id)
    VALUES(p_workspace,c.id,CASE WHEN roof THEN rep ELSE c.user_id END,
     CASE WHEN roof THEN 'new' ELSE 'opportunity' END,NOT roof,nullif(trim(p_data->>'product'),''),
     nullif(cp->>'id','')::uuid,coalesce(booking.campaign_address_id,(
       SELECT ca.id FROM public.campaign_addresses ca WHERE ca.campaign_id=nullif(cp->>'id','')::uuid
        AND ca.id::text=coalesce(cj->>'address_id',cj->>'campaign_address_id')
     )))
    RETURNING * INTO op;
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
    AND (contact_id=c.id OR (property IS NOT NULL AND property_key=property) OR (op.id IS NOT NULL AND opportunity_id=op.id)
      OR (roof AND property IS NOT NULL AND property_snapshot->>'address_id'=property)
      OR (roof AND nullif(lower(trim(coalesce(booking.property_label,cj->>'address'))),'') IS NOT NULL AND
        lower(trim(property_snapshot->>'address'))=lower(trim(coalesce(booking.property_label,cj->>'address'))))) LIMIT 1;
   IF roof AND EXISTS (
    SELECT 1 FROM public.field_sales s WHERE s.opportunity_id=op.id AND s.workspace_id=p_workspace
      AND s.status IN ('pending','verified')
   ) THEN RAISE EXCEPTION 'This opportunity already has an active sale' USING ERRCODE='23505'; END IF;
   duplicate_review:=roof AND duplicate_id IS NOT NULL;
   IF NOT roof AND duplicate_id IS NOT NULL AND (NOT public.field_sales_permission(p_workspace,'attribution') OR length(trim(coalesce(p_data->>'duplicate_override_reason','')))=0 OR nullif(p_data->>'job_identifier','') IS NULL) THEN
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
  IF roof AND setter IS NOT NULL AND setter<>rep THEN
   credits:=credits||jsonb_build_array(jsonb_build_object('user_id',setter,'role','setter','basis_points',0));
  END IF;
  IF p_data ? 'credits' AND NOT public.field_sales_permission(p_workspace,'attribution') AND credits<>jsonb_build_array(jsonb_build_object('user_id',rep,'role',CASE WHEN setter=closer THEN 'full_cycle' ELSE 'closer' END,'basis_points',10000)) THEN RAISE EXCEPTION 'Split credit requires manager permission'; END IF;
  source:=CASE WHEN roof AND mode='door' THEN 'door_knock'
    ELSE coalesce(nullif(p_data->>'attribution_source',''),CASE WHEN ev IS NOT NULL THEN 'door_knock' ELSE 'manual' END) END;
  IF p_action='submit' THEN
   INSERT INTO public.field_sales(workspace_id,contact_id,rep_id,campaign_id,territory_id,appointment_id,value_minor,currency,sold_on,notes,created_by,request_id,replaces_id,
    property_key,property_snapshot,original_event_id,opportunity_id,setter_id,closer_id,team_id,team_name_snapshot,rep_name_snapshot,campaign_name_snapshot,
    product,expected_revenue_minor,expected_completion_on,attribution_source,attribution_method,attribution_confidence,attribution_evidence,job_identifier,duplicate_override_reason,commission_minor,gross_profit_minor,
    field_appointment_id,sale_source,assigned_closer_id,proof_reference,duplicate_review)
   VALUES(p_workspace,c.id,rep,nullif(cp->>'id','')::uuid,nullif(cp->>'territory_id','')::uuid,a.id,(p_data->>'value_minor')::bigint,cfg.currency,coalesce(nullif(p_data->>'sold_on','')::date,local_day),coalesce(p_data->>'notes',''),auth.uid(),req,nullif(p_data->>'replaces_id','')::uuid,
    property,jsonb_strip_nulls(jsonb_build_object('address',coalesce(booking.property_label,cj->>'address'),
      'building_id',cj->>'building_id','address_id',coalesce(booking.campaign_address_id::text,cj->>'address_id'),'latitude',cj->'latitude','longitude',cj->'longitude')),
    nullif(ev->>'id','')::uuid,op.id,setter,closer,team,tm_name,(SELECT coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','Representative') FROM auth.users WHERE id=rep),cp->>'name',
    coalesce(p_data->>'product',''),coalesce(nullif(p_data->>'expected_revenue_minor','')::bigint,(p_data->>'value_minor')::bigint),nullif(p_data->>'expected_completion_on','')::date,
    source,CASE WHEN booking.id IS NOT NULL THEN 'linked_appointment' WHEN ev IS NOT NULL THEN 'linked_activity' WHEN property IS NOT NULL THEN 'linked_property' WHEN a.id IS NOT NULL THEN 'linked_appointment' ELSE 'linked_lead' END,
    CASE WHEN ev IS NOT NULL OR booking.id IS NOT NULL THEN 'confirmed' ELSE 'partial' END,jsonb_strip_nulls(jsonb_build_object('lead_id',c.id,'appointment_id',a.id,'field_appointment_id',booking.id,'event_id',ev->>'id','original_at',ev->>'created_at','campaign_id',cp->>'id')),
    nullif(p_data->>'job_identifier',''),nullif(p_data->>'duplicate_override_reason',''),nullif(p_data->>'commission_minor','')::bigint,nullif(p_data->>'gross_profit_minor','')::bigint,
    booking.id,coalesce(mode,'legacy'),coalesce(booking.assignee_id,CASE WHEN roof THEN op.user_id END),
    nullif(trim(p_data->>'proof_reference'),''),duplicate_review) RETURNING * INTO sale;
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
  IF NOT cfg.verification_required AND sale.status='pending' AND NOT duplicate_review THEN
   UPDATE public.field_sales SET status='verified',verified_by=auth.uid(),verified_at=now(),version=version+1,updated_at=now() WHERE id=sale.id RETURNING * INTO sale;
  END IF;
  IF NOT roof OR sale.status='verified' THEN
   UPDATE public.field_sales_opportunities SET stage_key='won',stage_entered_at=now(),
     version=version+1,updated_at=now(),expected_value_minor=coalesce(expected_value_minor,sale.value_minor)
    WHERE id=op.id AND workspace_id=p_workspace;
   UPDATE public.contacts SET sales_status='sold' WHERE id=c.id AND workspace_id=p_workspace;
  END IF;
 ELSIF p_action IN ('verify','reject','cancel','refund','chargeback','complete','collect','refund_payment','chargeback_payment') THEN
  cap:=CASE p_action WHEN 'verify' THEN 'verify' WHEN 'reject' THEN 'verify' WHEN 'complete' THEN 'complete' WHEN 'collect' THEN 'collect' WHEN 'refund_payment' THEN 'collect' WHEN 'chargeback_payment' THEN 'collect' ELSE 'cancel' END;
  IF NOT public.field_sales_permission(p_workspace,cap) THEN RAISE EXCEPTION 'Sale permission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO old FROM public.field_sales WHERE workspace_id=p_workspace AND id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF old.sale_source<>'legacy' AND req IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
  IF old.sale_source<>'legacy' AND NOT cfg.roofing_sale_writes_enabled THEN
   RAISE EXCEPTION 'Roofing sale writes are paused' USING ERRCODE='42501';
  END IF;
  IF p_action='verify' AND old.status='verified' THEN RETURN jsonb_build_object('id',old.id,'status',old.status,'version',old.version); END IF;
  IF p_action='cancel' AND old.status='cancelled' THEN RETURN jsonb_build_object('id',old.id,'status',old.status,'version',old.version); END IF;
  IF p_data ? 'version' AND old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Sale changed; refresh before updating'; END IF;
  IF p_action='verify' THEN
   IF old.status<>'pending' THEN RAISE EXCEPTION 'Only pending sales can be verified'; END IF;
   IF r<>'owner' AND (old.rep_id=auth.uid() OR old.created_by=auth.uid() OR old.setter_id=auth.uid() OR old.closer_id=auth.uid()
     OR EXISTS(SELECT 1 FROM public.field_sales_credits WHERE sale_id=old.id AND user_id=auth.uid())) THEN RAISE EXCEPTION 'Only owners can verify their own sales'; END IF;
   IF p_data->>'version' IS NULL THEN RAISE EXCEPTION 'Reviewed version required'; END IF;
   IF old.duplicate_review AND nullif(trim(p_data->>'reason'),'') IS NULL THEN
    RAISE EXCEPTION 'Record why this is a separate job before verifying';
   END IF;
   IF old.field_appointment_id IS NOT NULL THEN
    PERFORM 1 FROM public.field_appointments fa WHERE fa.id=old.field_appointment_id AND fa.status='held' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The linked appointment is no longer held'; END IF;
   END IF;
   UPDATE public.field_sales SET status='verified',verified_by=auth.uid(),verified_at=now(),updated_at=now(),version=version+1,
     duplicate_override_reason=coalesce(nullif(trim(p_data->>'reason'),''),old.duplicate_override_reason)
     WHERE id=old.id RETURNING * INTO sale;
   IF old.sale_source<>'legacy' THEN
    UPDATE public.field_sales_opportunities SET stage_key='won',stage_entered_at=now(),version=version+1,updated_at=now()
      WHERE id=old.opportunity_id AND workspace_id=p_workspace;
    UPDATE public.contacts SET sales_status='sold' WHERE id=old.contact_id AND workspace_id=p_workspace;
   END IF;
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
   END IF;
   IF NOT EXISTS (SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace AND opportunity_id=old.opportunity_id
       AND status IN ('pending','verified')) THEN
    UPDATE public.field_sales_opportunities SET stage_key='cancelled',stage_entered_at=now(),version=version+1,updated_at=now()
      WHERE workspace_id=p_workspace AND id=old.opportunity_id;
   END IF;
  ELSIF p_action='complete' THEN
   IF old.status<>'verified' THEN RAISE EXCEPTION 'Verify the sale before recording completion'; END IF;
   IF nullif(p_data->>'completed_on','')::date IS NULL OR (p_data->>'completed_on')::date<old.sold_on OR (p_data->>'completed_on')::date>local_day THEN RAISE EXCEPTION 'Completion date must be between sale date and today'; END IF;
   UPDATE public.field_sales SET fulfillment_status='completed',completed_on=(p_data->>'completed_on')::date,
    completed_value_minor=coalesce(nullif(p_data->>'completed_value_minor','')::bigint,value_minor),version=version+1,updated_at=now() WHERE id=old.id RETURNING * INTO sale;
   UPDATE public.field_sales_opportunities SET stage_key='completed',stage_entered_at=now(),version=version+1,updated_at=now() WHERE workspace_id=p_workspace AND id=old.opportunity_id;
  ELSE
   IF req IS NULL THEN RAISE EXCEPTION 'Payment request ID required'; END IF;
   IF p_action='collect' AND old.status<>'verified' THEN RAISE EXCEPTION 'Verify the sale before recording collection'; END IF;
   amount:=(p_data->>'amount_minor')::bigint;
   IF amount IS NULL OR amount<=0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
   IF (p_data->>'occurred_at')::timestamptz IS NULL OR (p_data->>'occurred_at')::timestamptz>now() OR ((p_data->>'occurred_at')::timestamptz AT TIME ZONE cfg.timezone)::date<old.sold_on THEN RAISE EXCEPTION 'Payment date must be between sale date and now'; END IF;
   SELECT coalesce(sum(amount_minor),0) INTO cash FROM public.field_sales_payments WHERE workspace_id=p_workspace AND sale_id=old.id;
   IF p_action<>'collect' AND amount>cash THEN RAISE EXCEPTION 'Refund cannot exceed recorded collected revenue'; END IF;
   INSERT INTO public.field_sales_payments(workspace_id,sale_id,request_id,amount_minor,kind,occurred_at,actor_id,reference,note,reverses_payment_id)
    VALUES(p_workspace,old.id,req,CASE WHEN p_action='collect' THEN amount ELSE -amount END,CASE p_action WHEN 'collect' THEN 'collection' WHEN 'refund_payment' THEN 'refund' ELSE 'chargeback' END,
    (p_data->>'occurred_at')::timestamptz,auth.uid(),p_data->>'reference',coalesce(p_data->>'note',''),nullif(p_data->>'reverses_payment_id','')::uuid) RETURNING id INTO payment_id;
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

CREATE OR REPLACE FUNCTION public.field_sales_seed_stages(w uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=w AND roofing_sales_enabled)
    AND NOT EXISTS(SELECT 1 FROM public.field_sales_stages WHERE workspace_id=w) THEN
  INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
   (w,'new','New Lead',0,0,'open'),(w,'qualified','Qualified',10,15,'open'),
   (w,'appointment','Appointment Set',20,25,'open'),(w,'appointment_completed','Inspection Completed',30,45,'open'),
   (w,'proposal','Estimate Sent',40,65,'open'),(w,'follow_up','Follow-Up',50,75,'open'),
   (w,'won','Won',60,100,'won'),(w,'lost','Lost',70,0,'lost') ON CONFLICT DO NOTHING;
 END IF;
 IF EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=w AND roofing_sales_enabled) THEN
  INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
   (w,'new','New Lead',0,0,'open'),(w,'won','Won',60,100,'won'),
   (w,'completed','Completed job',80,100,'won'),(w,'cancelled','Cancelled',92,0,'lost') ON CONFLICT DO NOTHING;
 ELSE
  INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
   (w,'new','New lead',0,0,'open'),(w,'contacted','Contacted',10,10,'open'),
   (w,'appointment','Appointment set',20,25,'open'),(w,'appointment_completed','Appointment completed',30,40,'open'),
   (w,'opportunity','Opportunity',40,50,'open'),(w,'proposal','Proposal / estimate',50,70,'open'),
   (w,'won','Sold',60,100,'won'),(w,'fulfillment','Install / fulfillment',70,100,'won'),
   (w,'completed','Completed',80,100,'won'),(w,'collected','Collected',90,100,'won'),
   (w,'lost','Lost',91,0,'lost'),(w,'cancelled','Cancelled',92,0,'lost'),
   (w,'no_show','No show',93,0,'open'),(w,'follow_up','Follow-up',94,20,'open') ON CONFLICT DO NOTHING;
 END IF;
END
$$;

CREATE FUNCTION public.field_sales_roofing_deal(w uuid,data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid := auth.uid();
 manager boolean := public.field_sales_permission(w,'team_details');
 cfg public.field_sales_settings;
 target uuid := (data->>'id')::uuid;
 req uuid := (data->>'request_id')::uuid;
 receipt public.field_sales_requests;
 lead public.contacts;
 before_row public.field_sales_opportunities;
 next_row public.field_sales_opportunities;
 booking public.field_appointments;
 stage public.field_sales_stages;
 deal_owner uuid;
 deal_campaign uuid;
 deal_address uuid;
 label text;
 loss text;
 result jsonb;
 money_on boolean;
BEGIN
 PERFORM public.field_sales_role(w);
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=w FOR UPDATE;
 IF NOT coalesce(cfg.enabled AND cfg.roofing_sales_enabled AND cfg.roofing_sale_writes_enabled,false) THEN
  RAISE EXCEPTION 'Roofing opportunity writes are unavailable' USING ERRCODE='42501';
 END IF;
 IF req IS NULL OR target IS NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(data) k
   WHERE k NOT IN ('id','request_id','contact_id','version','stage_key','job_label','owner_id','field_appointment_id',
    'expected_value_minor','expected_close','notes','loss_reason','loss_note')) THEN
  RAISE EXCEPTION 'Invalid opportunity command';
 END IF;
 SELECT * INTO receipt FROM public.field_sales_requests WHERE workspace_id=w AND actor_id=actor AND request_id=req;
 IF FOUND THEN
  IF receipt.action<>'roofing.deal' OR receipt.payload<>data THEN RAISE EXCEPTION 'Request ID was used for different inputs'; END IF;
  IF NOT (manager OR EXISTS (
    SELECT 1 FROM public.field_sales_opportunities o WHERE o.id=target AND o.workspace_id=w AND o.user_id=actor
  )) THEN RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE='42501'; END IF;
  RETURN receipt.result;
 END IF;

 SELECT * INTO before_row FROM public.field_sales_opportunities WHERE id=target AND workspace_id=w FOR UPDATE;
 IF before_row.id IS NOT NULL AND (NOT (manager OR before_row.user_id=actor) OR
    before_row.version IS DISTINCT FROM (data->>'version')::integer) THEN
  RAISE EXCEPTION 'Opportunity unavailable or changed; refresh before editing';
 END IF;
 SELECT * INTO lead FROM public.contacts
   WHERE id=coalesce(before_row.contact_id,(data->>'contact_id')::uuid) AND workspace_id=w
     AND (manager OR before_row.user_id=actor OR user_id=actor);
 IF NOT FOUND THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='42501'; END IF;
 IF data ? 'contact_id' AND (data->>'contact_id')::uuid IS DISTINCT FROM lead.id THEN
  RAISE EXCEPTION 'An opportunity must retain its contact';
 END IF;

 deal_owner:=coalesce((data->>'owner_id')::uuid,before_row.user_id,actor);
 IF (deal_owner<>coalesce(before_row.user_id,actor) AND NOT manager) OR NOT EXISTS (
  SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=deal_owner
 ) THEN RAISE EXCEPTION 'Assignment permission required or assignee unavailable' USING ERRCODE='42501'; END IF;
 deal_campaign:=coalesce(before_row.campaign_id,lead.campaign_id);
 SELECT ca.id INTO deal_address FROM public.campaign_addresses ca JOIN public.campaigns cp ON cp.id=ca.campaign_id
  WHERE ca.campaign_id=deal_campaign AND cp.workspace_id=w
    AND ca.id::text=coalesce(before_row.campaign_address_id::text,to_jsonb(lead)->>'address_id',
      to_jsonb(lead)->>'campaign_address_id');
 IF data ? 'field_appointment_id' THEN
  SELECT * INTO booking FROM public.field_appointments
    WHERE id=(data->>'field_appointment_id')::uuid AND workspace_id=w AND contact_id=lead.id
      AND (manager OR actor IN (setter_id,assignee_id,created_by));
  IF NOT FOUND OR booking.campaign_id IS DISTINCT FROM deal_campaign OR booking.campaign_address_id IS DISTINCT FROM deal_address THEN
   RAISE EXCEPTION 'Appointment unavailable for this opportunity';
  END IF;
 END IF;

 PERFORM public.field_sales_seed_stages(w);
 SELECT * INTO stage FROM public.field_sales_stages WHERE workspace_id=w
   AND key=coalesce(data->>'stage_key',before_row.stage_key,'new');
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose a workspace stage'; END IF;
 IF stage.key IS DISTINCT FROM before_row.stage_key AND (
    stage.kind='won' OR EXISTS (
      SELECT 1 FROM public.field_sales s WHERE s.opportunity_id=target AND s.status IN ('pending','verified')
    )
 ) THEN RAISE EXCEPTION 'Change this stage through the linked sale'; END IF;
 label:=coalesce(nullif(trim(data->>'job_label'),''),before_row.job_label,'Roofing opportunity');
 loss:=CASE WHEN stage.kind='lost' THEN coalesce(nullif(data->>'loss_reason',''),before_row.loss_reason) END;
 IF stage.kind='lost' AND loss IS NULL THEN RAISE EXCEPTION 'A loss reason is required'; END IF;
 money_on:=public.field_sales_permission(w,CASE WHEN deal_owner=actor THEN 'own_revenue' ELSE 'team_revenue' END);
 IF NOT money_on AND data ? 'expected_value_minor' THEN
  RAISE EXCEPTION 'Revenue permission required to change pipeline value' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.field_sales_opportunities(
  id,workspace_id,contact_id,user_id,legacy_slot,job_label,campaign_id,campaign_address_id,field_appointment_id,
  stage_key,expected_value_minor,expected_close,notes,loss_reason,loss_note,lost_at,stage_entered_at,
  inspection_completed_at,estimate_sent_at
 ) VALUES (
  target,w,lead.id,deal_owner,coalesce(before_row.legacy_slot,false),label,deal_campaign,deal_address,
  coalesce(booking.id,before_row.field_appointment_id),stage.key,
  CASE WHEN data ? 'expected_value_minor' THEN nullif(data->>'expected_value_minor','')::bigint ELSE before_row.expected_value_minor END,
  CASE WHEN data ? 'expected_close' THEN nullif(data->>'expected_close','')::date ELSE before_row.expected_close END,
  coalesce(data->>'notes',before_row.notes,''),loss,
  CASE WHEN stage.kind='lost' THEN coalesce(data->>'loss_note',before_row.loss_note,'') ELSE '' END,
  CASE WHEN stage.kind='lost' THEN coalesce(before_row.lost_at,now()) END,
  CASE WHEN before_row.stage_key=stage.key THEN before_row.stage_entered_at ELSE now() END,
  coalesce(before_row.inspection_completed_at,CASE WHEN stage.key='appointment_completed' THEN now() END),
  coalesce(before_row.estimate_sent_at,CASE WHEN stage.key='proposal' THEN now() END)
 ) ON CONFLICT (id) DO UPDATE SET
  user_id=excluded.user_id,job_label=excluded.job_label,field_appointment_id=excluded.field_appointment_id,
  stage_key=excluded.stage_key,expected_value_minor=excluded.expected_value_minor,expected_close=excluded.expected_close,
  notes=excluded.notes,loss_reason=excluded.loss_reason,loss_note=excluded.loss_note,lost_at=excluded.lost_at,
  stage_entered_at=excluded.stage_entered_at,inspection_completed_at=excluded.inspection_completed_at,
  estimate_sent_at=excluded.estimate_sent_at,version=field_sales_opportunities.version+1,updated_at=now()
 WHERE field_sales_opportunities.workspace_id=w
 RETURNING * INTO next_row;
 IF next_row.id IS NULL THEN RAISE EXCEPTION 'Opportunity unavailable'; END IF;
 INSERT INTO public.field_sales_pipeline_events(workspace_id,contact_id,actor_id,action,detail)
  VALUES(w,lead.id,actor,'opportunity',jsonb_build_object('opportunity_id',target,
    'before',CASE WHEN before_row.id IS NOT NULL THEN to_jsonb(before_row) END,'after',to_jsonb(next_row),
    'from_stage',before_row.stage_key,'to_stage',next_row.stage_key));
 result:=jsonb_build_object('id',target,'version',next_row.version,'stage_key',next_row.stage_key);
 INSERT INTO public.field_sales_requests(workspace_id,actor_id,request_id,action,payload,result)
 VALUES(w,actor,req,'roofing.deal',data,result);
 RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.field_sales_roofing_deal(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.field_sales_pipeline_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_name text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; lead_record public.contacts;
 old public.field_sales_opportunities; next public.field_sales_opportunities; stage public.field_sales_stages; previous_kind text; money_on boolean; result jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(cfg.enabled,false) OR cfg.currency IS NULL OR cfg.timezone IS NULL THEN RAISE EXCEPTION 'Set up Sales before using the pipeline'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid pipeline command'; END IF;
 PERFORM public.field_sales_seed_stages(p_workspace);
 IF p_action='stage' THEN
  IF EXISTS(SELECT 1 FROM public.field_sales_stages s WHERE s.workspace_id=p_workspace AND s.key=p_data->>'key' AND s.kind IS DISTINCT FROM p_data->>'kind')
   AND EXISTS(SELECT 1 FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND stage_key=p_data->>'key') THEN RAISE EXCEPTION 'The outcome type of a stage with existing opportunities cannot change'; END IF;
  RETURN public.field_sales_pipeline_command_v1(p_workspace,p_action,p_data);
 END IF;
 IF p_action='deal' THEN RETURN public.field_sales_roofing_deal(p_workspace,p_data); END IF;
 IF p_action='opportunity' AND cfg.roofing_sales_enabled THEN
   RAISE EXCEPTION 'Update WolfGrid to edit opportunities in this workspace' USING ERRCODE='0A000';
 END IF;
 IF p_action<>'opportunity' THEN RETURN public.field_sales_pipeline_command_v1(p_workspace,p_action,p_data); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('contact_id','stage_key','expected_value_minor','expected_close','notes','version','loss_reason','loss_note')) THEN RAISE EXCEPTION 'Unknown opportunity field'; END IF;
 SELECT * INTO lead_record FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace
  AND (user_id=auth.uid() OR public.field_sales_permission(p_workspace,'team_details'));
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=lead_record.id AND legacy_slot FOR UPDATE;
 IF old.id IS NOT NULL AND old.version IS DISTINCT FROM (p_data->>'version')::integer THEN RAISE EXCEPTION 'Opportunity changed; refresh before editing'; END IF;
 SELECT * INTO stage FROM public.field_sales_stages WHERE workspace_id=p_workspace AND key=p_data->>'stage_key';
 IF NOT FOUND THEN RAISE EXCEPTION 'Select a workspace pipeline stage'; END IF;
 SELECT kind INTO previous_kind FROM public.field_sales_stages WHERE workspace_id=p_workspace AND key=old.stage_key;
 IF stage.kind='won' AND NOT EXISTS(SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace AND contact_id=lead_record.id AND status IN ('pending','verified')) THEN
  RAISE EXCEPTION 'Use Mark as sold to create the connected sale'; END IF;
 IF stage.kind<>'won' AND EXISTS(SELECT 1 FROM public.field_sales WHERE workspace_id=p_workspace AND contact_id=lead_record.id AND status IN ('pending','verified')) THEN
  RAISE EXCEPTION 'Update or cancel the connected sale before reopening or losing this opportunity'; END IF;
 IF stage.key IN ('completed','collected') AND stage.key IS DISTINCT FROM old.stage_key THEN RAISE EXCEPTION 'Record completion or collection on the connected sale'; END IF;
 IF nullif(p_data->>'loss_reason','') IS NOT NULL AND p_data->>'loss_reason' NOT IN ('price','competitor','no_decision','unable_to_contact','financing','timing','not_qualified','cancelled','other') THEN RAISE EXCEPTION 'Invalid loss reason'; END IF;
 money_on:=public.field_sales_permission(p_workspace,CASE WHEN lead_record.user_id=auth.uid() THEN 'own_revenue' ELSE 'team_revenue' END);
 IF NOT money_on AND nullif(p_data->>'expected_value_minor','') IS NOT NULL THEN RAISE EXCEPTION 'Revenue permission required to change pipeline value' USING ERRCODE='42501'; END IF;
 INSERT INTO public.field_sales_opportunities(workspace_id,contact_id,user_id,stage_key,expected_value_minor,expected_close,notes,loss_reason,loss_note,lost_at,stage_entered_at)
 VALUES(p_workspace,lead_record.id,lead_record.user_id,stage.key,
  CASE WHEN money_on AND p_data ? 'expected_value_minor' THEN nullif(p_data->>'expected_value_minor','')::bigint ELSE old.expected_value_minor END,
  CASE WHEN p_data ? 'expected_close' THEN nullif(p_data->>'expected_close','')::date ELSE old.expected_close END,
  coalesce(p_data->>'notes',old.notes,''),CASE WHEN stage.kind='lost' THEN coalesce(nullif(p_data->>'loss_reason',''),CASE WHEN previous_kind='lost' THEN old.loss_reason END) END,
  CASE WHEN stage.kind='lost' THEN coalesce(p_data->>'loss_note',CASE WHEN previous_kind='lost' THEN old.loss_note END,'') ELSE '' END,
  CASE WHEN stage.kind='lost' THEN CASE WHEN previous_kind='lost' THEN old.lost_at ELSE now() END END,
  CASE WHEN old.stage_key=stage.key THEN old.stage_entered_at ELSE now() END)
 ON CONFLICT(workspace_id,contact_id) WHERE legacy_slot DO UPDATE SET user_id=excluded.user_id,stage_key=excluded.stage_key,expected_value_minor=excluded.expected_value_minor,
  expected_close=excluded.expected_close,notes=excluded.notes,loss_reason=excluded.loss_reason,loss_note=excluded.loss_note,lost_at=excluded.lost_at,
  stage_entered_at=excluded.stage_entered_at,version=field_sales_opportunities.version+1,updated_at=now() RETURNING * INTO next;
 INSERT INTO public.field_sales_pipeline_events(workspace_id,contact_id,actor_id,action,detail)
 VALUES(p_workspace,lead_record.id,auth.uid(),'opportunity',jsonb_build_object('before',CASE WHEN old.id IS NOT NULL THEN to_jsonb(old) END,'after',to_jsonb(next),'from_stage',old.stage_key,'to_stage',next.stage_key));
 result:=to_jsonb(next); IF NOT money_on THEN result:=result-'expected_value_minor'; ELSE result:=result||jsonb_build_object('expected_value_minor',next.expected_value_minor::text); END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.field_sales_workbench(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; stages jsonb; opportunities jsonb; tasks jsonb; summary jsonb; leads jsonb; team_scope boolean; money_on boolean; losses jsonb; open_pipeline jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 team_scope:=public.field_sales_permission(p_workspace,'team_details');
 money_on:=public.field_sales_permission(p_workspace,CASE WHEN team_scope THEN 'team_revenue' ELSE 'own_revenue' END);
 PERFORM public.field_sales_seed_stages(p_workspace);
 SELECT jsonb_agg(to_jsonb(s) ORDER BY position,key) INTO stages FROM public.field_sales_stages s WHERE workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg((to_jsonb(o)-'expected_value_minor')||jsonb_strip_nulls(jsonb_build_object('contact_name',c.full_name,'expected_value_minor',CASE WHEN money_on THEN o.expected_value_minor::text END,'stalled',o.updated_at<now()-interval '72 hours' AND EXISTS(SELECT 1 FROM public.field_sales_stages s WHERE s.workspace_id=p_workspace AND s.key=o.stage_key AND s.kind='open'))) ORDER BY o.updated_at DESC),'[]'::jsonb)
 INTO opportunities FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND (team_scope OR (CASE WHEN cfg.roofing_sales_enabled THEN o.user_id ELSE c.user_id END)=auth.uid())
 WHERE o.workspace_id=p_workspace AND (team_scope OR (cfg.roofing_sales_enabled AND o.user_id=auth.uid()) OR (NOT cfg.roofing_sales_enabled AND EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid())));
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('contact_name',c.full_name) ORDER BY t.due_at),'[]'::jsonb) INTO tasks
 FROM public.field_sales_tasks t JOIN public.contacts c ON c.id=t.contact_id AND c.workspace_id=t.workspace_id AND c.user_id=auth.uid()
 WHERE t.workspace_id=p_workspace AND t.user_id=auth.uid() AND (t.status='pending' OR t.completed_at>now()-interval '30 days');
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',s.key,'label',s.label,'kind',s.kind,'count',q.n,'missing_values',q.missing,
 'value_minor',CASE WHEN money_on THEN q.value::text END,
 'weighted_minor',CASE WHEN money_on THEN q.weighted::text END)) ORDER BY s.position,s.key) INTO summary
 FROM public.field_sales_stages s CROSS JOIN LATERAL (SELECT count(*) n,count(*) FILTER(WHERE expected_value_minor IS NULL) missing,coalesce(sum(expected_value_minor),0) value,
 round(coalesce(sum(expected_value_minor::numeric*s.probability/100),0)) weighted FROM public.field_sales_opportunities o WHERE o.workspace_id=p_workspace AND o.stage_key=s.key AND (team_scope OR (cfg.roofing_sales_enabled AND o.user_id=auth.uid()) OR (NOT cfg.roofing_sales_enabled AND EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid())))) q WHERE s.workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name),'[]'::jsonb) INTO leads FROM public.contacts c WHERE workspace_id=p_workspace AND (team_scope OR user_id=auth.uid()) AND coalesce(to_jsonb(c)->>'lead_kind','field')='field';
 SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n,'percent',percent) ORDER BY n DESC,reason),'[]') INTO losses FROM (
  SELECT reason,n,round(n*100.0/sum(n) OVER(),2)::text percent FROM (
   SELECT coalesce(o.loss_reason,'unspecified') reason,count(*) n FROM public.field_sales_opportunities o JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
   WHERE o.workspace_id=p_workspace AND (team_scope OR (cfg.roofing_sales_enabled AND o.user_id=auth.uid()) OR (NOT cfg.roofing_sales_enabled AND EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid()))) AND s.kind='lost' GROUP BY coalesce(o.loss_reason,'unspecified')
  ) reasons
 ) ranked;
 SELECT jsonb_strip_nulls(jsonb_build_object('count',count(*),'missing_values',count(*) FILTER(WHERE o.expected_value_minor IS NULL),
  'value_minor',CASE WHEN money_on THEN coalesce(sum(o.expected_value_minor),0)::text END,
  'stalled',count(*) FILTER(WHERE o.updated_at<now()-interval '72 hours'))) INTO open_pipeline
 FROM public.field_sales_opportunities o JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
 WHERE o.workspace_id=p_workspace AND (team_scope OR (cfg.roofing_sales_enabled AND o.user_id=auth.uid()) OR (NOT cfg.roofing_sales_enabled AND EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid()))) AND s.kind='open';
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('pipeline_version',CASE WHEN cfg.roofing_sales_enabled THEN 3 ELSE 2 END,'roofing_can_write',cfg.roofing_sale_writes_enabled,'scope',CASE WHEN team_scope THEN 'workspace' ELSE 'self' END,'money_visible',money_on,'losses',losses,'open_pipeline',open_pipeline,'needs_setup',false,'stages',stages,'opportunities',opportunities,'tasks',tasks,'task_leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name)) FROM public.contacts WHERE workspace_id=p_workspace AND user_id=auth.uid()),'[]'),'summary',summary,'leads',leads,'as_of',now());
END $$;


COMMIT;
