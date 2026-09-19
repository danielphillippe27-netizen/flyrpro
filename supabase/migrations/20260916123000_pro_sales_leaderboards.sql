BEGIN;
ALTER TABLE public.field_sales_settings ADD COLUMN leaderboard_categories text[] NOT NULL DEFAULT ARRAY[
 'sales','sold_value','collected_revenue','appointments','leads','doors','conversations','close_rate','setters','closers','average_ticket','lead_conversion','sales_per_100_doors','revenue_per_100_doors','sales_cycle'];

CREATE FUNCTION public.field_sales_ranking_settings(p_workspace uuid,p_categories text[],p_minimum integer,p_featured text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); old public.field_sales_settings; next public.field_sales_settings;
BEGIN
 IF r NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.field_sales_settings WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT coalesce(old.enabled,false) THEN RAISE EXCEPTION 'Sales is not enabled'; END IF;
 IF p_categories IS NULL OR p_minimum IS NULL OR p_minimum NOT BETWEEN 1 AND 1000 OR p_featured IS NULL OR p_featured NOT IN ('sales','sold_value','collected_revenue') THEN RAISE EXCEPTION 'Invalid leaderboard settings'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_categories) c WHERE c IS NULL OR c NOT IN ('sales','sold_value','collected_revenue','appointments','leads','doors','conversations','close_rate','setters','closers','average_ticket','lead_conversion','sales_per_100_doors','revenue_per_100_doors','sales_cycle')) THEN RAISE EXCEPTION 'Unknown leaderboard category'; END IF;
 UPDATE public.field_sales_settings SET leaderboard_categories=ARRAY(SELECT DISTINCT unnest(p_categories)),minimum_close_opportunities=p_minimum,featured_ranking=p_featured WHERE workspace_id=p_workspace RETURNING * INTO next;
 INSERT INTO public.field_sales_settings_events(workspace_id,actor_id,action,before_record,after_record) VALUES(p_workspace,auth.uid(),'leaderboards',to_jsonb(old),to_jsonb(next));
 RETURN public.field_sales_bootstrap(p_workspace);
END $$;

CREATE FUNCTION public.field_sales_drilldown(p_workspace uuid,p_filter jsonb,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb:=public.field_sales_report(p_workspace,p_filter); f jsonb:=d->'filter'; first_day date; last_day date;
 zone text; rows jsonb; total bigint; page_limit integer:=coalesce((p_filter->>'limit')::integer,50); page_offset integer:=coalesce((p_filter->>'offset')::integer,0);
 show_money boolean; rep uuid; expected numeric;
BEGIN
 IF NOT coalesce((d->>'enabled')::boolean,false) OR coalesce((d->>'needs_setup')::boolean,false) THEN RETURN d; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('doors','conversations','leads','appointments','appointments_completed','opportunities','sales','completed','collected') THEN RAISE EXCEPTION 'Invalid funnel stage'; END IF;
 first_day:=(d->>'period_start')::date;last_day:=(d->>'period_end')::date+1;zone:=d->>'timezone';rep:=nullif(f->>'rep','')::uuid;
 show_money:=(d->'summary') ? 'sold_value_minor';
 IF p_kind IN ('sales','completed','collected') THEN
  WITH source AS (
   SELECT s.id,s.id sale_id,s.contact_id,s.rep_name_snapshot label,s.sold_on::timestamp AT TIME ZONE zone occurred_at,public.field_sales_credit_amount(s.id,rep,s.value_minor) value
   FROM public.field_sales_report_scope(p_workspace,f) s WHERE p_kind='sales' AND s.status='verified' AND s.sold_on>=first_day AND s.sold_on<last_day AND s.sold_on<=(now() AT TIME ZONE zone)::date
   UNION ALL SELECT s.id,s.id,s.contact_id,s.rep_name_snapshot,s.completed_on::timestamp AT TIME ZONE zone,public.field_sales_credit_amount(s.id,rep,s.completed_value_minor)
   FROM public.field_sales_report_scope(p_workspace,f) s WHERE p_kind='completed' AND s.fulfillment_status='completed' AND s.completed_on>=first_day AND s.completed_on<last_day AND s.completed_on<=(now() AT TIME ZONE zone)::date
   UNION ALL SELECT p.id,s.id,s.contact_id,s.rep_name_snapshot,p.occurred_at,public.field_sales_credit_amount(s.id,rep,p.amount_minor)
   FROM public.field_sales_report_scope(p_workspace,f) s JOIN public.field_sales_payments p ON p.sale_id=s.id AND p.workspace_id=p_workspace
   WHERE p_kind='collected' AND p.occurred_at>=first_day::timestamp AT TIME ZONE zone AND p.occurred_at<last_day::timestamp AT TIME ZONE zone AND p.occurred_at<=now()
  ), page AS (SELECT * FROM source ORDER BY occurred_at DESC,id LIMIT page_limit OFFSET page_offset)
  SELECT (SELECT count(*) FROM source),coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'sale_id',sale_id,'contact_id',contact_id,'label',label,'occurred_at',occurred_at,'value_minor',CASE WHEN show_money THEN value::text END)) ORDER BY occurred_at DESC,id),'[]') INTO total,rows FROM page;
  expected:=CASE p_kind WHEN 'sales' THEN (d->'summary'->>'sales')::numeric WHEN 'completed' THEN (d->'summary'->>'completed_jobs')::numeric END;
 ELSE
  IF NOT (d->'metrics'->>'available')::boolean THEN RAISE EXCEPTION 'Remove sale product, source and status filters to inspect activity'; END IF;
  WITH source AS MATERIALIZED (SELECT * FROM public.field_sales_activity_rows(p_workspace,f,first_day,last_day,zone,p_kind)),
  page AS (SELECT * FROM source ORDER BY occurred_at DESC,id LIMIT page_limit OFFSET page_offset)
  SELECT (SELECT count(*) FROM source),coalesce(jsonb_agg(jsonb_build_object('id',id,'contact_id',contact_id,'rep_id',rep_id,'campaign_id',campaign_id,'label',label,'occurred_at',occurred_at,'converted',converted) ORDER BY occurred_at DESC,id),'[]') INTO total,rows FROM page;
  expected:=(d->'metrics'->>p_kind)::numeric;
 END IF;
 RETURN jsonb_build_object('enabled',true,'kind',p_kind,'rows',rows,'total_records',total,'expected_count',expected,'has_more',page_offset+page_limit<total,
  'offset',page_offset,'limit',page_limit,'currency',d->>'currency','timezone',zone,'period_start',first_day,'period_end',last_day-1,'as_of',d->'as_of');
END $$;

CREATE FUNCTION public.field_sales_leaderboard(p_workspace uuid,p_filter jsonb DEFAULT '{}',p_metric text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; f jsonb:=coalesce(p_filter,'{}'::jsonb); bounds record;
 metric text; metric_key text; money_on boolean; categories text[]; rows jsonb; total bigint; excluded bigint;
 page_limit integer:=coalesce((f->>'limit')::integer,100);page_offset integer:=coalesce((f->>'offset')::integer,0);
 activity_on boolean; period text:=coalesce(f->>'period','month'); unit text;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR page_limit NOT BETWEEN 1 AND 200 OR page_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid ranking request'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('period','start','end','campaign','territory','team','product','source','limit','offset','focus_rep')) THEN RAISE EXCEPTION 'Unknown leaderboard filter'; END IF;
 money_on:=public.field_sales_permission(p_workspace,'leaderboard_revenue');
 activity_on:=nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL;
 SELECT coalesce(array_agg(c),'{}') INTO categories FROM unnest(cfg.leaderboard_categories) c
 WHERE (money_on OR c NOT IN ('sold_value','collected_revenue','average_ticket','revenue_per_100_doors'))
 AND (activity_on OR c IN ('sales','sold_value','collected_revenue','average_ticket','setters','closers','sales_cycle'));
 metric:=coalesce(p_metric,CASE WHEN cfg.featured_ranking=ANY(categories) THEN cfg.featured_ranking ELSE categories[1] END);
 IF metric IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('enabled',true,'categories',categories,'rows','[]'::jsonb,'message','No leaderboards are enabled for this view.'); END IF;
 IF NOT metric=ANY(categories) THEN RAISE EXCEPTION 'This leaderboard is not available for your permissions or filters' USING ERRCODE='42501'; END IF;
 metric_key:=CASE metric WHEN 'sales' THEN 'sales' WHEN 'sold_value' THEN 'sold_value_minor' WHEN 'collected_revenue' THEN 'collected_revenue_minor'
 WHEN 'setters' THEN 'setter_sales' WHEN 'closers' THEN 'closer_sales' WHEN 'average_ticket' THEN 'average_ticket_minor' ELSE metric END;
 unit:=CASE WHEN metric IN ('sold_value','collected_revenue','average_ticket','revenue_per_100_doors') THEN 'money'
 WHEN metric IN ('close_rate','lead_conversion') THEN 'percent' WHEN metric='sales_cycle' THEN 'days' WHEN metric='sales_per_100_doors' THEN 'ratio' ELSE 'count' END;
 SELECT * INTO bounds FROM public.field_sales_period_bounds(cfg.timezone,period,nullif(f->>'start','')::date,nullif(f->>'end','')::date);
 IF period='all' THEN
  SELECT least(coalesce((SELECT min(sold_on) FROM public.field_sales_report_scope(p_workspace,f)),bounds.end_day-1),
   coalesce((SELECT min((created_at AT TIME ZONE cfg.timezone)::date) FROM public.contacts WHERE workspace_id=p_workspace),bounds.end_day-1),
   coalesce((SELECT min((e.created_at AT TIME ZONE cfg.timezone)::date) FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id WHERE sn.workspace_id=p_workspace),bounds.end_day-1)) INTO bounds.start_day;
  bounds.previous_end:=bounds.start_day;bounds.previous_start:=bounds.start_day-(bounds.end_day-bounds.start_day);
 END IF;
 WITH scoped AS MATERIALIZED (SELECT * FROM public.field_sales_report_scope(p_workspace,f)),
 participants AS MATERIALIZED (
  SELECT s.*,p.user_id participant FROM scoped s CROSS JOIN LATERAL (
   SELECT s.rep_id user_id UNION SELECT s.setter_id UNION SELECT s.closer_id UNION SELECT c.user_id FROM public.field_sales_credits c WHERE c.sale_id=s.id
  ) p WHERE p.user_id IS NOT NULL
 ), activity AS MATERIALIZED (
  SELECT rep_id,count(*) FILTER(WHERE kind='doors') doors,count(*) FILTER(WHERE kind='conversations') conversations,
   count(*) FILTER(WHERE kind='leads') leads,count(*) FILTER(WHERE kind='leads' AND converted) lead_wins,
   count(*) FILTER(WHERE kind='appointments') appointments,count(*) FILTER(WHERE kind='appointments_completed') completed_appointments,
   count(*) FILTER(WHERE kind='appointments_completed' AND converted) appointment_wins
  FROM public.field_sales_activity_rows(p_workspace,f,bounds.start_day,bounds.end_day,cfg.timezone) GROUP BY rep_id
 ), financial AS MATERIALIZED (
  SELECT s.participant user_id,
   count(*) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day) sales,
   count(*) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.previous_start AND s.sold_on<bounds.previous_end) previous_sales,
   coalesce(sum(public.field_sales_credit_amount(s.id,s.participant,s.value_minor)) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day),0) sold,
   coalesce(sum(public.field_sales_credit_amount(s.id,s.participant,s.value_minor)) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.previous_start AND s.sold_on<bounds.previous_end),0) previous_sold,
   count(*) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day AND s.setter_id=s.participant) setter_sales,
   count(*) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day AND s.closer_id=s.participant) closer_sales,
   avg(s.sold_on-(c.created_at AT TIME ZONE cfg.timezone)::date) FILTER(WHERE s.status='verified' AND s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day) sale_days
  FROM participants s JOIN public.contacts c ON c.id=s.contact_id AND c.workspace_id=p_workspace
  WHERE s.sold_on<=(now() AT TIME ZONE cfg.timezone)::date GROUP BY s.participant
 ), cash AS (
  SELECT s.participant user_id,sum(public.field_sales_credit_amount(s.id,s.participant,p.amount_minor)) value
  FROM participants s JOIN public.field_sales_payments p ON p.sale_id=s.id AND p.workspace_id=p_workspace
  WHERE p.occurred_at>=bounds.start_day::timestamp AT TIME ZONE cfg.timezone AND p.occurred_at<bounds.end_day::timestamp AT TIME ZONE cfg.timezone AND p.occurred_at<=now() GROUP BY s.participant
 ), candidates AS (
  SELECT user_id FROM public.workspace_members WHERE workspace_id=p_workspace UNION SELECT participant FROM participants UNION SELECT rep_id FROM activity
 ), facts AS (
  SELECT u.id,coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative') name,
   jsonb_strip_nulls(jsonb_build_object('sales',coalesce(fin.sales,0)::text,'previous_sales',coalesce(fin.previous_sales,0)::text,
    'sold_value_minor',CASE WHEN money_on THEN coalesce(fin.sold,0)::text END,'collected_revenue_minor',CASE WHEN money_on THEN coalesce(cash.value,0)::text END,
    'average_ticket_minor',CASE WHEN money_on AND fin.sales>0 THEN round(fin.sold/fin.sales)::text END,
    'setter_sales',coalesce(fin.setter_sales,0)::text,'closer_sales',coalesce(fin.closer_sales,0)::text,
    'doors',CASE WHEN activity_on THEN coalesce(a.doors,0)::text END,'conversations',CASE WHEN activity_on THEN coalesce(a.conversations,0)::text END,
    'appointments',CASE WHEN activity_on THEN coalesce(a.appointments,0)::text END,'leads',CASE WHEN activity_on THEN coalesce(a.leads,0)::text END,
    'close_rate',CASE WHEN a.completed_appointments>=cfg.minimum_close_opportunities THEN round(a.appointment_wins::numeric*100/a.completed_appointments,2)::text END,
    'close_opportunities',coalesce(a.completed_appointments,0)::text,
    'lead_conversion',CASE WHEN a.leads>=cfg.minimum_close_opportunities THEN round(a.lead_wins::numeric*100/a.leads,2)::text END,
    'sales_per_100_doors',CASE WHEN a.doors>0 THEN round(coalesce(fin.sales,0)::numeric*100/a.doors,2)::text END,
    'revenue_per_100_doors',CASE WHEN money_on AND a.doors>0 THEN round(coalesce(fin.sold,0)*100/a.doors)::text END,
    'sales_cycle',CASE WHEN fin.sales>=cfg.minimum_close_opportunities THEN round(fin.sale_days,2)::text END,
    'sales_change_percent',CASE WHEN fin.previous_sales>0 THEN round((fin.sales-fin.previous_sales)::numeric*100/fin.previous_sales,2)::text END,
    'sold_change_percent',CASE WHEN money_on AND fin.previous_sold<>0 THEN round((fin.sold-fin.previous_sold)*100/abs(fin.previous_sold),2)::text END)) stats
  FROM candidates c JOIN auth.users u ON u.id=c.user_id LEFT JOIN financial fin ON fin.user_id=u.id LEFT JOIN activity a ON a.rep_id=u.id LEFT JOIN cash ON cash.user_id=u.id
 ), ranked AS (
  SELECT *,dense_rank() OVER(ORDER BY CASE WHEN metric='sales_cycle' THEN -(stats->>metric_key)::numeric ELSE (stats->>metric_key)::numeric END DESC) rank
  FROM facts WHERE stats->>metric_key IS NOT NULL
 ), page AS (SELECT * FROM ranked WHERE nullif(f->>'focus_rep','') IS NULL OR id=(f->>'focus_rep')::uuid ORDER BY rank,name,id LIMIT page_limit OFFSET page_offset)
 SELECT (SELECT count(*) FROM ranked),(SELECT count(*) FROM facts WHERE stats->>metric_key IS NULL),
  coalesce(jsonb_agg(jsonb_build_object('rep_id',id,'rep_name',name,'rank',rank,'value',stats->>metric_key,'metrics',(SELECT coalesce(jsonb_object_agg(k,v),'{}') FROM jsonb_each(stats) q(k,v) WHERE k IN (
   SELECT CASE c WHEN 'sold_value' THEN 'sold_value_minor' WHEN 'collected_revenue' THEN 'collected_revenue_minor' WHEN 'setters' THEN 'setter_sales' WHEN 'closers' THEN 'closer_sales' WHEN 'average_ticket' THEN 'average_ticket_minor' ELSE c END FROM unnest(categories) c
  ) OR (k IN ('previous_sales','sales_change_percent') AND 'sales'=ANY(categories)) OR (k='sold_change_percent' AND 'sold_value'=ANY(categories)) OR (k='close_opportunities' AND 'close_rate'=ANY(categories)))) ORDER BY rank,name,id),'[]') INTO total,excluded,rows FROM page;
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('metric',metric,'categories',categories,'unit',unit,'rows',rows,'total_ranked',total,
  'below_threshold_or_unavailable',excluded,'minimum_opportunities',cfg.minimum_close_opportunities,'limit',page_limit,'offset',page_offset,'has_more',nullif(f->>'focus_rep','') IS NULL AND page_limit+page_offset<total,
  'period_start',bounds.start_day,'period_end',bounds.end_day-1,'as_of',now(),
  'options',jsonb_build_object(
   'products',coalesce((SELECT jsonb_agg(product) FROM (SELECT DISTINCT product FROM public.field_sales WHERE workspace_id=p_workspace AND product<>'') p),'[]'),
   'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.campaigns WHERE workspace_id=p_workspace),'[]'),
   'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.field_sales_teams WHERE workspace_id=p_workspace),'[]'),
   'territories',coalesce((SELECT jsonb_agg(jsonb_build_object('id',territory_id,'name','Unnamed territory')) FROM (SELECT DISTINCT territory_id FROM public.field_sales WHERE workspace_id=p_workspace AND territory_id IS NOT NULL) t),'[]')),
  'definition','Sales counts indicate participation; company sales must not be computed by adding reps. Revenue uses exact split credit. Close rate uses explicitly completed appointments. Lead conversion and sales-cycle rankings also require the configured sample minimum. No customer identity appears here.');
END $$;
REVOKE ALL ON FUNCTION public.field_sales_drilldown(uuid,jsonb,text),public.field_sales_leaderboard(uuid,jsonb,text),public.field_sales_ranking_settings(uuid,text[],integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_drilldown(uuid,jsonb,text),public.field_sales_leaderboard(uuid,jsonb,text),public.field_sales_ranking_settings(uuid,text[],integer,text) TO authenticated;
COMMIT;
