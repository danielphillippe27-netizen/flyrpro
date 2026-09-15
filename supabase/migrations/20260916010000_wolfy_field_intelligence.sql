-- Read-only KPI projection. Managers receive aggregate performance, never team contact content.
BEGIN;
CREATE OR REPLACE FUNCTION public.wolfy_field_context(p_workspace uuid, p_timezone text, p_scope text DEFAULT 'self', p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET statement_timeout='12s' AS $$
DECLARE actor uuid:=auth.uid(); role_name text; reps uuid[]; t timestamptz:=now(); first_day date; local_day date;
 rows jsonb:='[]'; part jsonb; available text[]:=ARRAY['visits','sessions','leads','activities','contacts','goals'];
 missing text[]:='{}'; people jsonb; campaigns_json jsonb; goals_json jsonb; lifetime jsonb:=null; priority jsonb:='[]';
 stage_defs jsonb:='[]'; cfg jsonb:='{}'; sales_on boolean:=false; money_on boolean:=false; sales_tz text;
BEGIN
 SELECT role INTO role_name FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=actor;
 IF actor IS NULL OR role_name IS NULL THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE='42501'; END IF;
 IF p_scope NOT IN ('self','team') OR p_scope IS NULL OR p_days NOT IN (30,90,365) OR p_days IS NULL THEN RAISE EXCEPTION 'Invalid analysis scope'; END IF;
 IF p_scope='team' AND role_name NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Manager access required' USING ERRCODE='42501'; END IF;
 IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
 SELECT array_agg(user_id ORDER BY user_id) INTO reps FROM public.workspace_members
 WHERE workspace_id=p_workspace AND (p_scope='team' OR user_id=actor);
 IF cardinality(reps)>200 THEN RAISE EXCEPTION 'Team analysis supports up to 200 members'; END IF;
 local_day:=(t AT TIME ZONE p_timezone)::date; first_day:=local_day-(p_days*2);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(nullif(trim(to_jsonb(p)->>'full_name'),''),nullif(trim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),'Rep')) ORDER BY m.user_id),'[]')
 INTO people FROM public.workspace_members m LEFT JOIN public.user_profiles p ON p.user_id=m.user_id
 WHERE m.workspace_id=p_workspace AND m.user_id=ANY(reps);
 SELECT coalesce(jsonb_agg(jsonb_build_object('rep',p.user_id,'daily',p.daily_door_goal,'weekly',p.weekly_door_goal)),'[]')
 INTO goals_json FROM public.user_profiles p WHERE p.user_id=ANY(reps);
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.contact_activities'::regclass AND attname='status' AND NOT attisdropped) THEN available:=array_append(available,'appointment_outcomes'); ELSE missing:=array_append(missing,'appointment_outcomes'); END IF;
 -- A campaign's label/territory is only attached within the explicitly requested workspace.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',coalesce(to_jsonb(c)->>'name',to_jsonb(c)->>'title','Campaign'),
 'territory',to_jsonb(c)->>'territory_id')),'[]') INTO campaigns_json FROM public.campaigns c WHERE c.workspace_id=p_workspace
 AND (p_scope='team' OR EXISTS(SELECT 1 FROM public.sessions s WHERE s.campaign_id=c.id AND s.user_id=actor AND s.workspace_id=p_workspace)
 OR EXISTS(SELECT 1 FROM public.contacts k WHERE k.campaign_id=c.id AND k.user_id=actor AND k.workspace_id=p_workspace)
 OR coalesce(to_jsonb(c)->>'owner_id',to_jsonb(c)->>'user_id')=actor::text);
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 WITH ranked AS (
 SELECT e.id,e.created_at,e.event_type,e.metadata,e.outcome,s.user_id,s.campaign_id,row_number() OVER(PARTITION BY e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text)
 ORDER BY e.created_at DESC,e.id DESC) n FROM public.session_events e JOIN public.sessions s ON s.id=e.session_id
 WHERE s.workspace_id=p_workspace AND s.user_id=ANY(reps) AND e.created_at>=first_day::timestamp AT TIME ZONE p_timezone AND e.created_at<=t
 AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
 ), visits AS (SELECT *,lower(regexp_replace(coalesce(metadata->>'address_status',outcome,''),'[^a-zA-Z]','','g')) status FROM ranked WHERE n=1 AND event_type<>'completion_undone')
 SELECT user_id rep,campaign_id::text campaign,(created_at AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'doors',count(*)::text,'conversations',(count(*) FILTER(WHERE event_type='conversation' AND status NOT IN ('noanswer','donotknock')))::text,
 'flyers',(count(*) FILTER(WHERE event_type='flyer_left'))::text,
 'no_answer',(count(*) FILTER(WHERE status='noanswer'))::text,'do_not_knock',(count(*) FILTER(WHERE status='donotknock'))::text,
 'not_interested',(count(*) FILTER(WHERE status IN ('notinterested','rejected')))::text) AS "values"
 FROM visits GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT user_id rep,campaign_id::text campaign,(start_time AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'sessions',count(*)::text,'ended_sessions',(count(*) FILTER(WHERE end_time IS NOT NULL))::text,
 'active_seconds',sum(CASE WHEN end_time IS NOT NULL THEN greatest(0,coalesce(nullif(to_jsonb(s)->>'active_seconds','')::numeric,extract(epoch FROM end_time-start_time))) ELSE 0 END)::text,
 'distance_meters',sum(CASE WHEN end_time IS NOT NULL THEN greatest(0,coalesce(distance_meters,0)) ELSE 0 END)::text,
 'reported_doors',sum(greatest(0,coalesce(nullif(to_jsonb(s)->>'doors_hit','')::numeric,nullif(to_jsonb(s)->>'completed_count','')::numeric,0)))::text,
 'reported_flyers',sum(greatest(0,coalesce(nullif(to_jsonb(s)->>'flyers_delivered','')::numeric,0)))::text,
 'session_goals_met',(count(*) FILTER(WHERE goal_amount>0 AND goal_type IN ('knocks','flyers') AND CASE WHEN goal_type='flyers' THEN coalesce(nullif(to_jsonb(s)->>'flyers_delivered','')::numeric,0) ELSE coalesce(nullif(to_jsonb(s)->>'doors_hit','')::numeric,nullif(to_jsonb(s)->>'completed_count','')::numeric,0) END>=goal_amount AND end_time IS NOT NULL))::text,
 'sessions_with_goals',(count(*) FILTER(WHERE goal_amount>0 AND goal_type IN ('knocks','flyers') AND end_time IS NOT NULL))::text) AS "values"
 FROM public.sessions s WHERE workspace_id=p_workspace AND user_id=ANY(reps) AND start_time>=first_day::timestamp AT TIME ZONE p_timezone AND start_time<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT user_id rep,campaign_id::text campaign,(created_at AT TIME ZONE p_timezone)::date "day",jsonb_build_object('leads',count(*)::text,
 'leads_contacted',(count(*) FILTER(WHERE last_contacted IS NOT NULL AND last_contacted<=t))::text) AS "values"
 FROM public.contacts WHERE workspace_id=p_workspace AND user_id=ANY(reps) AND lead_kind='field'
 AND created_at>=first_day::timestamp AT TIME ZONE p_timezone AND created_at<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT c.user_id rep,c.campaign_id::text campaign,(a.created_at AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'appointments',(count(*) FILTER(WHERE a.type='meeting'))::text,'calls',(count(*) FILTER(WHERE a.type='call'))::text,
 'texts',(count(*) FILTER(WHERE a.type='text'))::text,'emails',(count(*) FILTER(WHERE a.type='email'))::text,
 'notes',(count(*) FILTER(WHERE a.type='note'))::text,'contact_knocks',(count(*) FILTER(WHERE a.type='knock'))::text,
 'contact_flyers',(count(*) FILTER(WHERE a.type='flyer'))::text) AS "values"
 FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id WHERE c.workspace_id=p_workspace AND c.user_id=ANY(reps) AND c.lead_kind='field'
 AND a.created_at>=first_day::timestamp AT TIME ZONE p_timezone AND a.created_at<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT c.user_id rep,c.campaign_id::text campaign,null::date "day",jsonb_build_object('contacts',count(*)::text,
 'hot_leads',(count(*) FILTER(WHERE lower(c.status)='hot'))::text,'warm_leads',(count(*) FILTER(WHERE lower(c.status)='warm'))::text,
 'cold_leads',(count(*) FILTER(WHERE lower(c.status)='cold'))::text,'new_leads',(count(*) FILTER(WHERE lower(c.status)='new'))::text,
 'overdue_reminders',(count(*) FILTER(WHERE c.reminder_date<t))::text,
 'never_contacted',(count(*) FILTER(WHERE c.last_contacted IS NULL))::text,
 'stale_hot_leads',(count(*) FILTER(WHERE lower(c.status)='hot' AND coalesce(c.last_contacted,c.created_at)<t-interval '3 days'))::text) AS "values"
 FROM public.contacts c WHERE c.workspace_id=p_workspace AND c.user_id=ANY(reps) AND c.lead_kind='field' GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT c.user_id rep,c.campaign_id::text campaign,null::date "day",jsonb_build_object(
 'appointments_today',(count(*) FILTER(WHERE a.timestamp>=t AND coalesce(lower(to_jsonb(a)->>'status'),'') NOT IN ('cancelled','canceled','completed','done') AND (a.timestamp AT TIME ZONE p_timezone)::date=local_day))::text,
 'appointments_upcoming',(count(*) FILTER(WHERE a.timestamp>=t AND coalesce(lower(to_jsonb(a)->>'status'),'') NOT IN ('cancelled','canceled','completed','done')))::text,
 'appointments_completed',CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.contact_activities'::regclass AND attname='status' AND NOT attisdropped) THEN (count(*) FILTER(WHERE lower(to_jsonb(a)->>'status') IN ('completed','done')))::text END,
 'appointments_cancelled',CASE WHEN EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.contact_activities'::regclass AND attname='status' AND NOT attisdropped) THEN (count(*) FILTER(WHERE lower(to_jsonb(a)->>'status') IN ('cancelled','canceled')))::text END) AS "values"
 FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id WHERE c.workspace_id=p_workspace AND c.user_id=ANY(reps) AND c.lead_kind='field'
 AND a.type='meeting' AND a.timestamp >= first_day::timestamp AT TIME ZONE p_timezone GROUP BY 1,2
 ) q;
 rows:=rows||part;

 BEGIN
 SELECT to_jsonb(s) INTO cfg FROM public.field_sales_settings s WHERE workspace_id=p_workspace;
 sales_on:=coalesce((cfg->>'enabled')::boolean,false) AND cfg->>'currency' IS NOT NULL AND cfg->>'timezone' IS NOT NULL;
 sales_tz:=cfg->>'timezone'; money_on:=p_scope='self' OR role_name IN ('owner','admin') OR coalesce((cfg->>'team_revenue_visible')::boolean,false);
 EXCEPTION WHEN undefined_table OR undefined_column THEN sales_on:=false; END;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT rep_id rep,coalesce('territory:'||territory_id::text,campaign_id::text) campaign,sold_on "day",jsonb_build_object(
 'verified_sales',(count(*) FILTER(WHERE status='verified'))::text,'pending_sales',(count(*) FILTER(WHERE status='pending'))::text,
 'cancelled_sales',(count(*) FILTER(WHERE status='cancelled'))::text,
 'revenue_minor',CASE WHEN money_on THEN coalesce(sum(value_minor) FILTER(WHERE status='verified'),0)::text END,
 'unlinked_appointment_sales',(count(*) FILTER(WHERE status='verified' AND appointment_id IS NULL))::text) AS "values"
 FROM public.field_sales WHERE workspace_id=p_workspace AND rep_id=ANY(reps) AND sold_on>=first_day AND sold_on<=(t AT TIME ZONE sales_tz)::date
 AND currency=cfg->>'currency' GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'sales');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'sales'); END;
 ELSE missing:=array_append(missing,'sales'); END IF;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT c.user_id rep,c.campaign_id::text campaign,(c.created_at AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'leads_sold',(count(*) FILTER(WHERE s.id IS NOT NULL))::text,
 'lead_sale_days',coalesce(sum(s.sold_on-(c.created_at AT TIME ZONE sales_tz)::date) FILTER(WHERE s.id IS NOT NULL),0)::text) AS "values"
 FROM public.contacts c LEFT JOIN public.field_sales s ON s.contact_id=c.id AND s.workspace_id=c.workspace_id AND s.rep_id=c.user_id AND s.status='verified'
 AND s.sold_on<=(t AT TIME ZONE sales_tz)::date AND s.currency=cfg->>'currency'
 WHERE c.workspace_id=p_workspace AND c.user_id=ANY(reps) AND c.lead_kind='field' AND c.created_at>=first_day::timestamp AT TIME ZONE p_timezone AND c.created_at<=t
 GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'cohorts');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'cohorts'); END;
 ELSE missing:=array_append(missing,'cohorts'); END IF;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT o.user_id rep,c.campaign_id::text campaign,null::date "day",jsonb_build_object(
 'open_opportunities',(count(*) FILTER(WHERE st.kind='open'))::text,
 'won_opportunities',(count(*) FILTER(WHERE st.kind='won'))::text,'lost_opportunities',(count(*) FILTER(WHERE st.kind='lost'))::text,
 'pipeline_missing_values',(count(*) FILTER(WHERE st.kind='open' AND o.expected_value_minor IS NULL))::text,
 'pipeline_minor',CASE WHEN money_on THEN coalesce(sum(o.expected_value_minor) FILTER(WHERE st.kind='open'),0)::text END,
 'weighted_pipeline_minor',CASE WHEN money_on THEN round(coalesce(sum(o.expected_value_minor::numeric*st.probability/100) FILTER(WHERE st.kind='open'),0))::text END,
 'overdue_expected_closes',(count(*) FILTER(WHERE st.kind='open' AND o.expected_close<local_day))::text,
 'hot_without_next_step',(count(*) FILTER(WHERE st.kind='open' AND lower(c.status)='hot' AND c.reminder_date IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.field_sales_tasks ft WHERE ft.workspace_id=p_workspace AND ft.contact_id=c.id AND ft.user_id=o.user_id AND ft.status='pending')
 AND NOT EXISTS(SELECT 1 FROM public.contact_activities a WHERE a.contact_id=c.id AND a.type='meeting' AND a.timestamp>=t)))::text) AS "values"
 FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND c.user_id=o.user_id
 JOIN public.field_sales_stages st ON st.workspace_id=o.workspace_id AND st.key=o.stage_key
 WHERE o.workspace_id=p_workspace AND o.user_id=ANY(reps) GROUP BY 1,2
 ) q;
 rows:=rows||part;
 available:=array_append(available,'pipeline');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'pipeline'); END;
 ELSE missing:=array_append(missing,'pipeline'); END IF;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT ft.user_id rep,c.campaign_id::text campaign,(ft.due_at AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'tasks_due',count(*)::text,'tasks_done',(count(*) FILTER(WHERE ft.status='done'))::text,
 'tasks_cancelled',(count(*) FILTER(WHERE ft.status='cancelled'))::text,
 'tasks_on_time',(count(*) FILTER(WHERE ft.status='done' AND ft.completed_at<=ft.due_at))::text) AS "values"
 FROM public.field_sales_tasks ft JOIN public.contacts c ON c.id=ft.contact_id AND c.workspace_id=ft.workspace_id AND c.user_id=ft.user_id
 WHERE ft.workspace_id=p_workspace AND ft.user_id=ANY(reps) AND ft.due_at>=first_day::timestamp AT TIME ZONE p_timezone AND ft.due_at<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'tasks');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'tasks'); END;
 ELSE missing:=array_append(missing,'tasks'); END IF;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT ft.user_id rep,c.campaign_id::text campaign,null::date "day",jsonb_build_object(
 'overdue_tasks',(count(*) FILTER(WHERE ft.status='pending' AND ft.due_at<t))::text,
 'pending_tasks',(count(*) FILTER(WHERE ft.status='pending'))::text) AS "values"
 FROM public.field_sales_tasks ft JOIN public.contacts c ON c.id=ft.contact_id AND c.workspace_id=ft.workspace_id AND c.user_id=ft.user_id
 WHERE ft.workspace_id=p_workspace AND ft.user_id=ANY(reps) GROUP BY 1,2
 ) q;
 rows:=rows||part;
 available:=array_append(available,'tasks_current');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'tasks_current'); END;
 ELSE missing:=array_append(missing,'tasks_current'); END IF;

 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT rep_id rep,null::text campaign,null::date "day",jsonb_build_object('monthly_sales_goal',target::text) AS "values"
 FROM public.field_sales_goals WHERE workspace_id=p_workspace AND rep_id=ANY(reps) AND month=date_trunc('month',t AT TIME ZONE sales_tz)::date
 ) q;
 rows:=rows||part;
 available:=array_append(available,'sales_goals');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'sales_goals'); END;
 ELSE missing:=array_append(missing,'sales_goals'); END IF;

 IF true THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT coalesce(to_jsonb(c)->>'owner_id',to_jsonb(c)->>'user_id')::uuid rep,c.id::text campaign,(q.created_at AT TIME ZONE p_timezone)::date "day",
 jsonb_build_object('qr_scans',count(*)::text) AS "values" FROM public.qr_scan_events q JOIN public.campaigns c ON c.id=q.campaign_id
 WHERE c.workspace_id=p_workspace AND coalesce(to_jsonb(c)->>'owner_id',to_jsonb(c)->>'user_id')::uuid=ANY(reps)
 AND q.created_at>=first_day::timestamp AT TIME ZONE p_timezone AND q.created_at<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'qr');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'qr'); END;
 ELSE missing:=array_append(missing,'qr'); END IF;

 IF true THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT lp.user_id rep,c.id::text campaign,(e.timestamp AT TIME ZONE p_timezone)::date "day",jsonb_build_object(
 'page_views',(count(*) FILTER(WHERE e.event_type='view'))::text,'page_clicks',(count(*) FILTER(WHERE e.event_type='click'))::text) AS "values"
 FROM public.landing_page_events e JOIN public.landing_pages lp ON lp.id=e.landing_page_id JOIN public.campaigns c ON c.id=lp.campaign_id
 WHERE c.workspace_id=p_workspace AND lp.user_id=ANY(reps) AND e.timestamp>=first_day::timestamp AT TIME ZONE p_timezone AND e.timestamp<=t GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'landing');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'landing'); END;
 ELSE missing:=array_append(missing,'landing'); END IF;

 IF true THEN
 BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (

 SELECT f.owner_id rep,ft.campaign_id::text campaign,ft.date "day",jsonb_build_object('farm_touches_planned',count(*)::text,
 'farm_touches_completed',(count(*) FILTER(WHERE ft.completed))::text) AS "values"
 FROM public.farm_touches ft JOIN public.farms f ON f.id=ft.farm_id
 WHERE f.workspace_id=p_workspace AND f.owner_id=ANY(reps) AND ft.date>=first_day AND ft.date<=local_day GROUP BY 1,2,3
 ) q;
 rows:=rows||part;
 available:=array_append(available,'farms');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'farms'); END;
 ELSE missing:=array_append(missing,'farms'); END IF;


 IF sales_on THEN
 BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'probability',probability,'kind',kind) ORDER BY position,key),'[]') INTO stage_defs
 FROM public.field_sales_stages WHERE workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (
 SELECT o.user_id rep,c.campaign_id::text campaign,null::date "day",jsonb_build_object('stage_count_'||st.key,count(*)::text,
 'stage_value_'||st.key,CASE WHEN money_on THEN coalesce(sum(o.expected_value_minor),0)::text END) AS "values"
 FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND c.user_id=o.user_id
 JOIN public.field_sales_stages st ON st.workspace_id=o.workspace_id AND st.key=o.stage_key
 WHERE o.workspace_id=p_workspace AND o.user_id=ANY(reps) GROUP BY o.user_id,c.campaign_id,st.key) q;
 rows:=rows||part; available:=array_append(available,'stages');
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'stages'); END;
 IF p_scope='team' AND 'sales_goals'=ANY(available) THEN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO part FROM (
 SELECT actor rep,null::text campaign,null::date "day",jsonb_build_object('team_monthly_sales_goal',target::text) AS "values"
 FROM public.field_sales_goals WHERE workspace_id=p_workspace AND rep_id IS NULL AND month=date_trunc('month',t AT TIME ZONE sales_tz)::date) q;
 rows:=rows||part;
 END IF;
 END IF;
 IF p_scope='self' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO priority FROM (
 SELECT c.id,left(c.full_name,100) name,c.status,c.reminder_date due,c.last_contacted,
 CASE WHEN c.reminder_date<t THEN 'Overdue reminder' WHEN lower(c.status)='hot' THEN 'Hot lead without recent contact' ELSE 'Needs a next contact' END reason
 FROM public.contacts c WHERE c.workspace_id=p_workspace AND c.user_id=actor AND c.lead_kind='field'
 AND (c.reminder_date<t OR (lower(c.status)='hot' AND coalesce(c.last_contacted,c.created_at)<t-interval '3 days'))
 ORDER BY (c.reminder_date<t) DESC NULLS LAST,c.reminder_date ASC NULLS LAST,c.created_at,c.id LIMIT 10) q;
 BEGIN
 SELECT jsonb_build_object('xp',to_jsonb(s)->'xp','day_streak',to_jsonb(s)->'day_streak','best_streak',to_jsonb(s)->'best_streak',
 'qr_codes_scanned',to_jsonb(s)->'qr_codes_scanned','qr_code_scan_rate',to_jsonb(s)->'qr_code_scan_rate','qr_code_lead_rate',to_jsonb(s)->'qr_code_lead_rate',
 'doors_knocked',to_jsonb(s)->'doors_knocked','flyers',to_jsonb(s)->'flyers','conversations',to_jsonb(s)->'conversations',
 'conversation_per_door',to_jsonb(s)->'conversation_per_door','conversation_lead_rate',to_jsonb(s)->'conversation_lead_rate',
 'leads_created',to_jsonb(s)->'leads_created','appointments',to_jsonb(s)->'appointments','distance_walked',to_jsonb(s)->'distance_walked','time_tracked',to_jsonb(s)->'time_tracked')
 INTO lifetime FROM public.user_stats s WHERE user_id=actor;
 EXCEPTION WHEN undefined_table OR undefined_column THEN missing:=array_append(missing,'lifetime'); END;
 END IF;
 IF jsonb_array_length(rows)>60000 THEN RAISE EXCEPTION 'Analysis is too large; select a shorter history'; END IF;
 RETURN jsonb_build_object('version',2,'actor',actor,'role',role_name,'scope',p_scope,'timezone',p_timezone,'sales_timezone',sales_tz,
 'as_of',t,'local_day',local_day,'first_day',first_day,'days',p_days,'people',people,'campaigns',campaigns_json,'goals',goals_json,
 'stage_defs',stage_defs,'rows',rows,'available',available,'unavailable',missing,'currency',CASE WHEN sales_on THEN cfg->>'currency' END,'lifetime',lifetime,'priorities',priority);
END $$;
REVOKE ALL ON FUNCTION public.wolfy_field_context(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wolfy_field_context(uuid,text,text,integer) TO authenticated;
CREATE INDEX IF NOT EXISTS wolfy_sessions_scope_time ON public.sessions(workspace_id,user_id,start_time);
CREATE INDEX IF NOT EXISTS wolfy_contacts_scope_time ON public.contacts(workspace_id,user_id,created_at);
CREATE INDEX IF NOT EXISTS wolfy_events_session_time ON public.session_events(session_id,created_at);
COMMIT;
