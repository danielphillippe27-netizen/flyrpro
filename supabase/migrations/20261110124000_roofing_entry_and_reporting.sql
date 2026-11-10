BEGIN;

CREATE FUNCTION public.field_sales_roofing_entry(p_workspace uuid,p_context jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid := auth.uid();
 cfg public.field_sales_settings;
 contact uuid := (p_context->>'contact_id')::uuid;
 deal uuid := (p_context->>'opportunity_id')::uuid;
 booking uuid := (p_context->>'field_appointment_id')::uuid;
 manager boolean;
 options jsonb;
 appointments jsonb;
 deals jsonb;
BEGIN
 PERFORM public.field_sales_role(p_workspace);
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.roofing_sales_enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 manager:=public.field_sales_permission(p_workspace,'team_details');
 options:=public.field_appointment_options(p_workspace,p_context->>'search',(p_context->>'campaign_address_id')::uuid);
 IF deal IS NOT NULL THEN
  SELECT o.contact_id INTO contact FROM public.field_sales_opportunities o
   WHERE o.id=deal AND o.workspace_id=p_workspace AND (manager OR o.user_id=actor);
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF booking IS NOT NULL THEN
  SELECT a.contact_id INTO contact FROM public.field_appointments a
   WHERE a.id=booking AND a.workspace_id=p_workspace AND (manager OR a.assignee_id=actor);
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'contact_id',a.contact_id,'contact_name',a.full_name,'start_at',a.start_at,
  'property_label',a.property_label,'setter_name',a.setter_name,'assignee_name',a.assignee_name
 ) ORDER BY a.start_at DESC,a.id),'[]') INTO appointments
 FROM (
  SELECT a.*,c.full_name,
   coalesce(setter.raw_user_meta_data->>'full_name',setter.raw_user_meta_data->>'name') AS setter_name,
   coalesce(assignee.raw_user_meta_data->>'full_name',assignee.raw_user_meta_data->>'name') AS assignee_name
  FROM public.field_appointments a
  JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=a.workspace_id
  LEFT JOIN auth.users setter ON setter.id=a.setter_id
  LEFT JOIN auth.users assignee ON assignee.id=a.assignee_id
  WHERE a.workspace_id=p_workspace AND a.status='held' AND (manager OR a.assignee_id=actor)
    AND (contact IS NULL OR a.contact_id=contact) AND (booking IS NULL OR a.id=booking)
    AND (p_context->>'campaign_address_id' IS NULL OR a.campaign_address_id=(p_context->>'campaign_address_id')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.field_sales s WHERE s.field_appointment_id=a.id AND s.status IN ('pending','verified'))
    AND strpos(lower(coalesce(c.full_name,'')||' '||coalesce(a.property_label,'')),lower(left(coalesce(p_context->>'search',''),200)))>0
  ORDER BY a.start_at DESC,a.id LIMIT 50
 ) a;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'contact_id',o.contact_id,'label',o.job_label)
                          ORDER BY o.updated_at DESC,o.id),'[]') INTO deals
 FROM (
  SELECT o.* FROM public.field_sales_opportunities o
  JOIN public.field_sales_stages st ON st.workspace_id=o.workspace_id AND st.key=o.stage_key
  WHERE o.workspace_id=p_workspace AND (manager OR o.user_id=actor) AND st.kind='open'
    AND (contact IS NULL OR o.contact_id=contact)
    AND NOT EXISTS (SELECT 1 FROM public.field_sales s WHERE s.opportunity_id=o.id AND s.status IN ('pending','verified'))
  ORDER BY o.updated_at DESC,o.id LIMIT 100
 ) o;
 IF contact IS NOT NULL THEN
  options:=options||jsonb_build_object('contacts',coalesce((
    SELECT jsonb_build_array(jsonb_build_object('id',c.id,'name',c.full_name,'address',to_jsonb(c)->>'address'))
    FROM public.contacts c WHERE c.id=contact AND c.workspace_id=p_workspace AND (manager OR c.user_id=actor OR EXISTS (
      SELECT 1 FROM public.field_sales_opportunities o WHERE o.workspace_id=p_workspace AND o.contact_id=c.id AND o.user_id=actor
    ))
  ),'[]'));
 END IF;
 RETURN options||jsonb_build_object(
  'enabled',true,'can_write',cfg.enabled AND cfg.roofing_sale_writes_enabled AND cfg.roofing_appointments_enabled
    AND cfg.currency IS NOT NULL AND cfg.timezone IS NOT NULL AND public.field_sales_permission(p_workspace,'submit'),
  'today',(now() AT TIME ZONE cfg.timezone)::date,'currency',cfg.currency,
  'required_fields',cfg.roofing_required_sale_fields,'appointments',appointments,'opportunities',deals,
  'contact_id',contact,'opportunity_id',deal,'field_appointment_id',booking,
  'can_assign_closer',public.field_sales_permission(p_workspace,'attribution')
 );
END
$$;
REVOKE ALL ON FUNCTION public.field_sales_roofing_entry(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_roofing_entry(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.field_sales_roofing_contact(p_workspace uuid,p_contact uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 actor uuid:=auth.uid();
 cfg public.field_sales_settings;
 manager boolean;
 contact_owner boolean;
 result jsonb;
BEGIN
 PERFORM public.field_sales_role(p_workspace);
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.roofing_appointments_enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 manager:=public.field_sales_permission(p_workspace,'team_details');
 SELECT c.user_id=actor INTO contact_owner FROM public.contacts c WHERE c.id=p_contact AND c.workspace_id=p_workspace;
 IF NOT FOUND OR NOT (manager OR contact_owner OR EXISTS (
   SELECT 1 FROM public.field_appointments a
   WHERE a.workspace_id=p_workspace AND a.contact_id=p_contact AND actor IN (a.assignee_id,a.setter_id)
 ) OR EXISTS (
   SELECT 1 FROM public.field_sales_opportunities o
   WHERE o.workspace_id=p_workspace AND o.contact_id=p_contact AND o.user_id=actor
 )) THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'enabled',true,'can_book',cfg.roofing_appointment_writes_enabled AND (manager OR contact_owner),
  'can_sell',cfg.roofing_sales_enabled AND cfg.roofing_sale_writes_enabled AND (manager OR contact_owner),
  'appointments',coalesce((
    SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.start_at DESC)
    FROM (SELECT id,start_at,status,appointment_type FROM public.field_appointments a
      WHERE a.workspace_id=p_workspace AND a.contact_id=p_contact AND (manager OR actor IN (a.setter_id,a.assignee_id))
      ORDER BY a.start_at DESC LIMIT 10) rows
  ),'[]'),
  'opportunities',coalesce((
    SELECT jsonb_agg(to_jsonb(rows))
    FROM (SELECT o.id,o.job_label,st.label AS stage_label FROM public.field_sales_opportunities o
      JOIN public.field_sales_stages st ON st.workspace_id=o.workspace_id AND st.key=o.stage_key
      WHERE o.workspace_id=p_workspace AND o.contact_id=p_contact AND (manager OR o.user_id=actor)
      ORDER BY o.updated_at DESC LIMIT 10) rows
  ),'[]'),
  'sales',coalesce((
    SELECT jsonb_agg(to_jsonb(rows) ORDER BY rows.sold_on DESC)
    FROM (SELECT s.id,s.product,s.status,s.sold_on FROM public.field_sales s
      WHERE s.workspace_id=p_workspace AND s.contact_id=p_contact
       AND (manager OR actor IN (s.created_by,s.rep_id,s.setter_id,s.closer_id) OR EXISTS (
        SELECT 1 FROM public.field_sales_credits credit WHERE credit.sale_id=s.id AND credit.user_id=actor
       ))
      ORDER BY s.sold_on DESC,s.id LIMIT 10) rows
  ),'[]')
 ) INTO result;
 RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.field_sales_roofing_contact(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_roofing_contact(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.field_sales_activity_rows(w uuid,f jsonb,first_day date,last_day date,zone text,p_kind text DEFAULT 'all')
RETURNS TABLE(id uuid,contact_id uuid,rep_id uuid,campaign_id uuid,occurred_at timestamptz,kind text,label text,converted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH contacts AS MATERIALIZED (
  SELECT c.* FROM public.contacts c LEFT JOIN public.campaigns cp ON cp.id=c.campaign_id AND cp.workspace_id=w
  WHERE c.workspace_id=w AND (nullif(f->>'rep','') IS NULL OR c.user_id=(f->>'rep')::uuid)
   AND coalesce(to_jsonb(c)->>'lead_kind','field')='field'
   AND (nullif(f->>'campaign','') IS NULL OR c.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
 ), visits AS (
  SELECT DISTINCT ON(e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text))
   e.id,e.session_id,e.building_id,e.address_id,e.created_at,e.event_type,e.metadata,e.outcome,
   sn.user_id,sn.campaign_id
  FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id
  LEFT JOIN public.campaigns cp ON cp.id=sn.campaign_id AND cp.workspace_id=w
  WHERE p_kind IN ('all','doors','conversations') AND sn.workspace_id=w
   AND (nullif(f->>'rep','') IS NULL OR sn.user_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR sn.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND e.created_at>=(first_day::timestamp AT TIME ZONE zone) AND e.created_at<(last_day::timestamp AT TIME ZONE zone) AND e.created_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=sn.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=e.created_at AND (m.ends_at IS NULL OR m.ends_at>e.created_at)))
   AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
  ORDER BY e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text),e.created_at DESC,e.id DESC
 ), records AS (
  SELECT v.id,NULL::uuid contact_id,v.user_id rep_id,v.campaign_id,v.created_at occurred_at,k.kind,
   coalesce(nullif(v.metadata->>'address',''),'Field visit') label,false converted
  FROM visits v CROSS JOIN LATERAL (SELECT 'doors'::text kind UNION ALL SELECT 'conversations' WHERE v.event_type='conversation' AND coalesce(v.metadata->>'address_status',v.outcome,'') NOT IN ('no_answer','noAnswer','do_not_knock','doNotKnock')) k
  WHERE v.event_type<>'completion_undone' AND (p_kind='all' OR k.kind=p_kind)
  UNION ALL
  SELECT c.id,c.id,c.user_id,c.campaign_id,c.created_at,'leads',c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.contact_id=c.id AND s.status='verified')
  FROM contacts c WHERE p_kind IN ('all','leads') AND c.created_at>=(first_day::timestamp AT TIME ZONE zone) AND c.created_at<(last_day::timestamp AT TIME ZONE zone) AND c.created_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=c.created_at AND (m.ends_at IS NULL OR m.ends_at>c.created_at)))
  UNION ALL
  SELECT a.id,c.id,c.user_id,c.campaign_id,a.timestamp,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.appointment_id=a.id AND s.status='verified')
  FROM contacts c JOIN public.contact_activities a ON a.contact_id=c.id
  CROSS JOIN LATERAL (SELECT 'appointments'::text kind UNION ALL SELECT 'appointments_completed' WHERE a.timestamp<=now() AND coalesce(to_jsonb(a)->>'status','') IN ('completed','attended')) k
  WHERE p_kind IN ('all','appointments','appointments_completed') AND (p_kind='all' OR k.kind=p_kind) AND a.type='meeting'
   AND a.timestamp>=(first_day::timestamp AT TIME ZONE zone) AND a.timestamp<(last_day::timestamp AT TIME ZONE zone)
   AND coalesce(to_jsonb(a)->>'status','') NOT IN ('cancelled','canceled')
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=a.timestamp AND (m.ends_at IS NULL OR m.ends_at>a.timestamp)))
  UNION ALL
  SELECT a.id,c.id,k.rep_id,a.campaign_id,k.occurred_at,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.field_appointment_id=a.id AND s.status='verified')
  FROM public.field_appointments a JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=w
  LEFT JOIN public.campaigns cp ON cp.id=a.campaign_id AND cp.workspace_id=w
  CROSS JOIN LATERAL (
    SELECT 'appointments'::text AS kind,a.setter_id AS rep_id,a.created_at AS occurred_at WHERE a.created_by IS NOT NULL
    UNION ALL SELECT 'appointments_scheduled',a.assignee_id,a.start_at WHERE a.status NOT IN ('cancelled','legacy_unknown')
    UNION ALL SELECT 'appointments_completed',a.assignee_id,a.outcome_at WHERE a.status='held'
    UNION ALL SELECT 'appointments_no_show',a.assignee_id,a.outcome_at WHERE a.status='no_show'
  ) k
  WHERE a.workspace_id=w AND (p_kind='all' OR k.kind=p_kind)
   AND k.occurred_at>=(first_day::timestamp AT TIME ZONE zone) AND k.occurred_at<(last_day::timestamp AT TIME ZONE zone)
   AND (nullif(f->>'rep','') IS NULL OR k.rep_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR a.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND (nullif(f->>'team','') IS NULL OR EXISTS(
     SELECT 1 FROM public.field_sales_team_memberships m
     WHERE m.workspace_id=w AND m.user_id=k.rep_id AND m.team_id=(f->>'team')::uuid
       AND m.starts_at<=k.occurred_at AND (m.ends_at IS NULL OR m.ends_at>k.occurred_at)
   ))
  UNION ALL
  SELECT o.id,c.id,CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END,coalesce(o.campaign_id,c.campaign_id),k.occurred_at,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.opportunity_id=o.id AND s.status='verified')
  FROM public.contacts c JOIN public.field_sales_opportunities o ON o.contact_id=c.id AND o.workspace_id=w
  LEFT JOIN public.campaigns cp ON cp.id=coalesce(o.campaign_id,c.campaign_id) AND cp.workspace_id=w
  CROSS JOIN LATERAL (
    SELECT 'opportunities'::text AS kind,o.created_at AS occurred_at
    UNION ALL SELECT 'estimates_sent',o.estimate_sent_at
  ) k
  WHERE c.workspace_id=w AND coalesce(to_jsonb(c)->>'lead_kind','field')='field' AND (p_kind='all' OR k.kind=p_kind)
   AND (nullif(f->>'rep','') IS NULL OR (CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END)=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR coalesce(o.campaign_id,c.campaign_id)=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND k.occurred_at>=(first_day::timestamp AT TIME ZONE zone) AND k.occurred_at<(last_day::timestamp AT TIME ZONE zone) AND k.occurred_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=(CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END) AND m.team_id=(f->>'team')::uuid AND m.starts_at<=k.occurred_at AND (m.ends_at IS NULL OR m.ends_at>k.occurred_at)))
 ) SELECT * FROM records WHERE nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.field_sales_report(p_workspace uuid,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb; f jsonb; rep uuid; money_on boolean; pipeline jsonb; cfg public.field_sales_settings; extras jsonb;
BEGIN
 d:=public.field_sales_report_without_pipeline(p_workspace,p_filter);
 IF NOT coalesce((d->>'enabled')::boolean,false) OR coalesce((d->>'needs_setup')::boolean,false) THEN RETURN d; END IF;
 f:=d->'filter'; rep:=nullif(f->>'rep','')::uuid;
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF cfg.roofing_sales_enabled THEN
  SELECT jsonb_build_object(
    'appointments_scheduled',count(*) FILTER(WHERE kind='appointments_scheduled'),
    'appointments_no_show',count(*) FILTER(WHERE kind='appointments_no_show'),
    'estimates_sent',count(*) FILTER(WHERE kind='estimates_sent')
   ) INTO extras
  FROM (
    SELECT * FROM public.field_sales_activity_rows(p_workspace,f,(d->>'period_start')::date,(d->>'period_end')::date+1,cfg.timezone,'appointments_scheduled')
    UNION ALL
    SELECT * FROM public.field_sales_activity_rows(p_workspace,f,(d->>'period_start')::date,(d->>'period_end')::date+1,cfg.timezone,'appointments_no_show')
    UNION ALL
    SELECT * FROM public.field_sales_activity_rows(p_workspace,f,(d->>'period_start')::date,(d->>'period_end')::date+1,cfg.timezone,'estimates_sent')
  ) events;
  d:=d||jsonb_build_object('metrics',d->'metrics'||extras);
  IF cfg.roofing_earnings_enabled AND f->>'scope'='team'
     AND public.field_sales_role(p_workspace) IN ('owner','admin','manager') THEN
   d:=d||jsonb_build_object('outstanding_commission_minor',(
     SELECT coalesce(sum(e.amount_minor),0)::text FROM public.field_earnings e
     WHERE e.workspace_id=p_workspace AND e.status='approved'
   ));
  END IF;
 END IF;
 -- These attributes exist on signed sales, not reliably on open opportunities.
 IF nullif(f->>'team','') IS NOT NULL OR nullif(f->>'product','') IS NOT NULL OR nullif(f->>'source','') IS NOT NULL OR nullif(f->>'status','') IS NOT NULL THEN
  RETURN d||jsonb_build_object('current_pipeline',jsonb_build_object('available',false,'note','Current pipeline is unavailable with historical sale-team, product, source or sale-status filters. Clear these filters to inspect open opportunities.'));
 END IF;
 money_on:=CASE WHEN rep=auth.uid() THEN public.field_sales_permission(p_workspace,'own_revenue') ELSE public.field_sales_permission(p_workspace,'team_revenue') END;
 WITH scoped AS MATERIALIZED (
  SELECT o.*,s.kind,s.label,s.position,s.probability FROM public.field_sales_opportunities o
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  LEFT JOIN public.campaigns cp ON cp.id=coalesce(o.campaign_id,c.campaign_id) AND cp.workspace_id=c.workspace_id
  JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
  WHERE o.workspace_id=p_workspace AND (rep IS NULL OR (CASE WHEN cfg.roofing_sales_enabled THEN o.user_id ELSE c.user_id END)=rep)
   AND (nullif(f->>'campaign','') IS NULL OR coalesce(o.campaign_id,c.campaign_id)=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
 ), stages AS (
  SELECT stage_key,label,position,count(*) n,coalesce(sum(expected_value_minor),0) value,
   count(*) FILTER(WHERE expected_value_minor IS NULL) missing,
   count(*) FILTER(WHERE updated_at<now()-interval '72 hours') stalled
  FROM scoped WHERE kind='open' GROUP BY stage_key,label,position
 ), losses AS (
  SELECT coalesce(nullif(loss_reason,''),'unspecified') reason,count(*) n FROM scoped WHERE kind='lost' GROUP BY 1
 ) SELECT jsonb_strip_nulls(jsonb_build_object('available',true,'as_of',now(),
  'count',(SELECT count(*) FROM scoped WHERE kind='open'),
  'value_minor',CASE WHEN money_on THEN (SELECT coalesce(sum(expected_value_minor),0)::text FROM scoped WHERE kind='open') END,
  'missing_values',(SELECT count(*) FROM scoped WHERE kind='open' AND expected_value_minor IS NULL),
  'stalled',(SELECT count(*) FROM scoped WHERE kind='open' AND updated_at<now()-interval '72 hours'),
  'stages',(SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',stage_key,'label',label,'count',n,'value_minor',CASE WHEN money_on THEN value::text END,'missing_values',missing,'stalled',stalled)) ORDER BY position,stage_key),'[]') FROM stages),
  'losses',(SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n,'percent',round(100.0*n/nullif((SELECT sum(n) FROM losses),0),2)::text) ORDER BY n DESC,reason),'[]') FROM losses),
  'note','Current open and lost opportunities, across all dates. Representative, campaign and territory follow the current opportunity scope. Unchanged means no opportunity update for 72 hours. Potential value is not sold, collected or a forecast.')) INTO pipeline;
 RETURN d||jsonb_build_object('current_pipeline',pipeline);
END $$;

CREATE OR REPLACE FUNCTION public.field_sales_bootstrap(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:=public.field_sales_bootstrap_v1(p_workspace); cfg public.field_sales_settings; capabilities jsonb;
BEGIN
 IF NOT (result->>'enabled')::boolean THEN RETURN result; END IF;
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 SELECT jsonb_object_agg(cap,public.field_sales_permission(p_workspace,cap)) INTO capabilities
  FROM unnest(ARRAY['submit','verify','cancel','complete','collect','export','team_details','attribution','team_revenue','own_revenue','leaderboard_revenue','commission','margin','edit_verified']) cap;
 RETURN result||jsonb_build_object('pro_sales_version',1,'capabilities',capabilities,'verification_required',cfg.verification_required,
  'roofing_earnings_enabled',cfg.roofing_earnings_enabled,
 'rep_revenue_visible',cfg.rep_revenue_visible,'minimum_close_opportunities',cfg.minimum_close_opportunities,'industry',cfg.industry,'terminology',cfg.terminology,
  'featured_ranking',cfg.featured_ranking,'feed_options',cfg.feed_options,
  'settings',CASE WHEN result->>'role' IN ('owner','admin') THEN to_jsonb(cfg) END);
END $$;

COMMIT;
