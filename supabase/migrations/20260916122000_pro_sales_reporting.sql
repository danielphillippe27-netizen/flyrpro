-- Shared report contract for public web and iOS. No client-side financial aggregation.
BEGIN;

CREATE FUNCTION public.field_sales_credit_amount(p_sale uuid,p_rep uuid,p_amount numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_rep IS NULL THEN p_amount ELSE coalesce((
  SELECT sign(p_amount)*(floor(abs(p_amount)*c.basis_points/10000)+CASE WHEN c.user_id=(
   SELECT user_id FROM public.field_sales_credits WHERE sale_id=p_sale AND basis_points>0 ORDER BY user_id DESC LIMIT 1
  ) THEN abs(p_amount)-(SELECT sum(floor(abs(p_amount)*basis_points/10000)) FROM public.field_sales_credits WHERE sale_id=p_sale) ELSE 0 END)
  FROM public.field_sales_credits c WHERE c.sale_id=p_sale AND c.user_id=p_rep
 ),0) END;
$$;

CREATE FUNCTION public.field_sales_report_scope(w uuid,f jsonb) RETURNS SETOF public.field_sales
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.* FROM public.field_sales s WHERE s.workspace_id=w
 AND (nullif(f->>'rep','') IS NULL OR s.rep_id=(f->>'rep')::uuid OR s.setter_id=(f->>'rep')::uuid OR s.closer_id=(f->>'rep')::uuid
  OR EXISTS(SELECT 1 FROM public.field_sales_credits c WHERE c.sale_id=s.id AND c.user_id=(f->>'rep')::uuid))
 AND (nullif(f->>'campaign','') IS NULL OR s.campaign_id=(f->>'campaign')::uuid)
 AND (nullif(f->>'territory','') IS NULL OR s.territory_id=(f->>'territory')::uuid)
 AND (nullif(f->>'team','') IS NULL OR s.team_id=(f->>'team')::uuid)
 AND (nullif(f->>'product','') IS NULL OR s.product=f->>'product')
 AND (nullif(f->>'status','') IS NULL OR s.status=f->>'status')
 AND (nullif(f->>'source','') IS NULL OR s.attribution_source=f->>'source');
$$;

CREATE FUNCTION public.field_sales_financial_summary(w uuid,f jsonb,first_day date,last_day date,zone text,show_money boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH scoped AS MATERIALIZED (SELECT * FROM public.field_sales_report_scope(w,f)),
 sold AS (
  SELECT count(*) FILTER(WHERE status='verified') sales,
   count(*) FILTER(WHERE status='pending') pending,
   count(*) FILTER(WHERE verified_at IS NOT NULL AND status IN ('cancelled','refunded','charged_back')) cancelled,
   count(*) FILTER(WHERE status='verified' AND setter_id=nullif(f->>'rep','')::uuid) setter_sales,
   count(*) FILTER(WHERE status='verified' AND closer_id=nullif(f->>'rep','')::uuid) closer_sales,
   coalesce(sum(public.field_sales_credit_amount(id,nullif(f->>'rep','')::uuid,value_minor)) FILTER(WHERE verified_at IS NOT NULL),0) gross,
   coalesce(sum(public.field_sales_credit_amount(id,nullif(f->>'rep','')::uuid,value_minor)) FILTER(WHERE verified_at IS NOT NULL AND status IN ('cancelled','refunded','charged_back')),0) cancellations,
   coalesce(sum(public.field_sales_credit_amount(id,nullif(f->>'rep','')::uuid,value_minor)) FILTER(WHERE status='verified'),0) net
  FROM scoped WHERE sold_on>=first_day AND sold_on<last_day AND sold_on<=(now() AT TIME ZONE zone)::date
 ), completion AS (
  SELECT count(*) n,coalesce(sum(public.field_sales_credit_amount(id,nullif(f->>'rep','')::uuid,completed_value_minor)),0) value
  FROM scoped WHERE completed_on>=first_day AND completed_on<last_day AND completed_on<=(now() AT TIME ZONE zone)::date AND fulfillment_status='completed'
 ), cash AS (
  SELECT coalesce(sum(public.field_sales_credit_amount(s.id,nullif(f->>'rep','')::uuid,p.amount_minor)),0) value
  FROM scoped s JOIN public.field_sales_payments p ON p.sale_id=s.id AND p.workspace_id=w
  WHERE p.occurred_at>=(first_day::timestamp AT TIME ZONE zone) AND p.occurred_at<(last_day::timestamp AT TIME ZONE zone) AND p.occurred_at<=now()
 ) SELECT jsonb_strip_nulls(jsonb_build_object('sales',sold.sales,'pending_sales',sold.pending,'cancelled_sales',sold.cancelled,
  'setter_sales',sold.setter_sales,'closer_sales',sold.closer_sales,'completed_jobs',completion.n,
  'gross_sold_minor',CASE WHEN show_money THEN sold.gross::text END,
  'cancellations_minor',CASE WHEN show_money THEN sold.cancellations::text END,
  'sold_value_minor',CASE WHEN show_money THEN sold.net::text END,
  'average_ticket_minor',CASE WHEN show_money AND sold.sales>0 THEN round(sold.net/sold.sales)::text END,
  'completed_value_minor',CASE WHEN show_money THEN completion.value::text END,
  'collected_revenue_minor',CASE WHEN show_money THEN cash.value::text END)) FROM sold,completion,cash;
$$;

CREATE FUNCTION public.field_sales_report(p_workspace uuid,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; f jsonb:=coalesce(p_filter,'{}'::jsonb);
 bounds record; summary jsonb; previous jsonb; changes jsonb:='{}'; key text; val numeric; prior numeric;
 rep uuid; show_money boolean; period text:=coalesce(nullif(f->>'period',''),'month');
 rows jsonb; ranks jsonb; groups jsonb; dimension text:=coalesce(f->>'dimension','campaign');
 row_count bigint; row_limit integer:=coalesce((f->>'limit')::integer,50); row_offset integer:=coalesce((f->>'offset')::integer,0);
 options jsonb; dims jsonb; col text; first_at timestamptz; last_at timestamptz;
 doors bigint; conversations bigint; leads bigint; linked_sales bigint; appointments bigint; completed_appointments bigint; appointment_sales bigint;
 opportunities bigint; source_metrics boolean; metrics jsonb; members jsonb; note text;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR row_limit NOT BETWEEN 1 AND 200 OR row_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid report request'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('period','start','end','scope','rep','campaign','territory','team','product','status','source','dimension','limit','offset')) THEN RAISE EXCEPTION 'Unknown report filter'; END IF;
 IF coalesce(f->>'scope','self') NOT IN ('self','team') THEN RAISE EXCEPTION 'Invalid report scope'; END IF;
 IF f->>'scope'='team' THEN
  IF NOT public.field_sales_permission(p_workspace,'team_details') THEN RAISE EXCEPTION 'Team reporting permission required' USING ERRCODE='42501'; END IF;
 ELSE f:=f||jsonb_build_object('rep',auth.uid()); END IF;
 rep:=nullif(f->>'rep','')::uuid;
 -- Former members remain selectable when there is historical sales evidence.
 IF rep IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=rep)
  AND NOT EXISTS(SELECT 1 FROM public.field_sales_credits WHERE workspace_id=p_workspace AND user_id=rep) THEN RAISE EXCEPTION 'Representative unavailable in this workspace'; END IF;
 IF nullif(f->>'status','') IS NOT NULL AND f->>'status' NOT IN ('pending','verified','cancelled','rejected','refunded','charged_back') THEN RAISE EXCEPTION 'Invalid sale status'; END IF;
 IF dimension NOT IN ('campaign','territory','team','product','source') THEN RAISE EXCEPTION 'Invalid report dimension'; END IF;
 show_money:=CASE WHEN rep=auth.uid() THEN public.field_sales_permission(p_workspace,'own_revenue') ELSE public.field_sales_permission(p_workspace,'team_revenue') END;
 SELECT * INTO bounds FROM public.field_sales_period_bounds(cfg.timezone,period,nullif(f->>'start','')::date,nullif(f->>'end','')::date);
 IF period='all' THEN
  SELECT least(
   coalesce((SELECT min(sold_on) FROM public.field_sales_report_scope(p_workspace,f)),(now() AT TIME ZONE cfg.timezone)::date),
   coalesce((SELECT min((created_at AT TIME ZONE cfg.timezone)::date) FROM public.contacts WHERE workspace_id=p_workspace AND (rep IS NULL OR user_id=rep)),(now() AT TIME ZONE cfg.timezone)::date),
   coalesce((SELECT min((e.created_at AT TIME ZONE cfg.timezone)::date) FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id WHERE sn.workspace_id=p_workspace AND (rep IS NULL OR sn.user_id=rep)),(now() AT TIME ZONE cfg.timezone)::date)
  ) INTO bounds.start_day;
  bounds.start_at:=bounds.start_day::timestamp AT TIME ZONE cfg.timezone;
  bounds.previous_end:=bounds.start_day; bounds.previous_start:=bounds.start_day-(bounds.end_day-bounds.start_day);
 END IF;
 first_at:=bounds.start_at; last_at:=bounds.end_at;
 summary:=public.field_sales_financial_summary(p_workspace,f,bounds.start_day,bounds.end_day,cfg.timezone,show_money);
 previous:=public.field_sales_financial_summary(p_workspace,f,bounds.previous_start,bounds.previous_end,cfg.timezone,show_money);
 FOR key IN SELECT jsonb_object_keys(summary) LOOP
  val:=(summary->>key)::numeric; prior:=(previous->>key)::numeric;
  changes:=changes||jsonb_build_object(key,CASE WHEN prior<>0 THEN round((val-prior)*100/abs(prior),2)::text END);
 END LOOP;
 SELECT count(*) INTO row_count FROM public.field_sales_report_scope(p_workspace,f) s WHERE s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day AND s.sold_on<=(now() AT TIME ZONE cfg.timezone)::date;
 SELECT coalesce(jsonb_agg(item ORDER BY sold_on DESC,id),'[]') INTO rows FROM (
  SELECT s.sold_on,s.id,jsonb_strip_nulls(jsonb_build_object('id',s.id,'version',s.version,'status',s.status,'sold_on',s.sold_on,
   'rep_id',s.rep_id,'rep_name',s.rep_name_snapshot,'setter_id',s.setter_id,'closer_id',s.closer_id,
   'campaign_id',s.campaign_id,'campaign_name',s.campaign_name_snapshot,'territory_id',s.territory_id,'team_id',s.team_id,'team_name',s.team_name_snapshot,
   'product',s.product,'source',s.attribution_source,'currency',s.currency,'contact_id',s.contact_id,
   'value_minor',CASE WHEN show_money THEN public.field_sales_credit_amount(s.id,rep,s.value_minor)::text END,
   'fulfillment_status',s.fulfillment_status)) item
  FROM public.field_sales_report_scope(p_workspace,f) s WHERE s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day AND s.sold_on<=(now() AT TIME ZONE cfg.timezone)::date
  ORDER BY s.sold_on DESC,s.id LIMIT row_limit OFFSET row_offset
 ) q;
 -- Group the same filtered financial records. Source activity will be attached through drilldowns.
 col:=CASE dimension WHEN 'campaign' THEN 'campaign_id' WHEN 'territory' THEN 'territory_id' WHEN 'team' THEN 'team_id' WHEN 'product' THEN 'product' ELSE 'attribution_source' END;
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',group_id,'name',name,'sales',sales,
  'sold_value_minor',CASE WHEN show_money THEN revenue::text END,'average_ticket_minor',CASE WHEN show_money AND sales>0 THEN round(revenue/sales)::text END)) ORDER BY revenue DESC,group_id),'[]') INTO groups
 FROM (SELECT to_jsonb(s)->>col group_id,
  coalesce(max(CASE dimension WHEN 'campaign' THEN s.campaign_name_snapshot WHEN 'team' THEN s.team_name_snapshot ELSE to_jsonb(s)->>col END),'Unassigned') name,
  count(*) FILTER(WHERE s.status='verified') sales,
  coalesce(sum(public.field_sales_credit_amount(s.id,rep,s.value_minor)) FILTER(WHERE s.status='verified'),0) revenue
  FROM public.field_sales_report_scope(p_workspace,f) s WHERE s.sold_on>=bounds.start_day AND s.sold_on<bounds.end_day AND s.sold_on<=(now() AT TIME ZONE cfg.timezone)::date
  GROUP BY to_jsonb(s)->>col) q;

 -- Activity is counted by its source owner and timestamp. A product/source/status sale filter cannot
 -- be applied backwards to unsold activity without biasing the denominator; explicitly withhold it.
 source_metrics:=nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL;
 IF source_metrics THEN
  SELECT count(*) FILTER(WHERE kind='doors'),count(*) FILTER(WHERE kind='conversations'),
   count(*) FILTER(WHERE kind='leads'),count(*) FILTER(WHERE kind='leads' AND converted),
   count(*) FILTER(WHERE kind='appointments'),count(*) FILTER(WHERE kind='appointments_completed'),
   count(*) FILTER(WHERE kind='appointments_completed' AND converted),count(*) FILTER(WHERE kind='opportunities')
  INTO doors,conversations,leads,linked_sales,appointments,completed_appointments,appointment_sales,opportunities
  FROM public.field_sales_activity_rows(p_workspace,f,bounds.start_day,bounds.end_day,cfg.timezone);
 END IF;
 metrics:=jsonb_build_object('available',source_metrics,'doors',doors,'conversations',conversations,'leads',leads,'appointments',appointments,
  'appointments_completed',completed_appointments,'opportunities',opportunities,'leads_converted',linked_sales,'appointments_converted',appointment_sales,
  'conversation_rate',CASE WHEN doors>0 THEN round(conversations::numeric*100/doors,2)::text END,
  'lead_conversion_rate',CASE WHEN leads>0 THEN round(linked_sales::numeric*100/leads,2)::text END,
  'close_rate',CASE WHEN completed_appointments>0 THEN round(appointment_sales::numeric*100/completed_appointments,2)::text END,
  'close_rate_rank_eligible',coalesce(completed_appointments>=cfg.minimum_close_opportunities,false),
  'revenue_per_door_minor',CASE WHEN show_money AND doors>0 THEN round((summary->>'sold_value_minor')::numeric/doors)::text END,
  'revenue_per_conversation_minor',CASE WHEN show_money AND conversations>0 THEN round((summary->>'sold_value_minor')::numeric/conversations)::text END,
  'revenue_per_lead_minor',CASE WHEN show_money AND leads>0 THEN round((summary->>'sold_value_minor')::numeric/leads)::text END);
 note:=CASE WHEN NOT source_metrics THEN 'Activity and conversion are unavailable under sale product, source or status filters; unsold activity has no matching sale dimension.'
 ELSE 'Activity uses source-owner attribution. Lead conversion follows leads created in this period through today. Close rate uses explicitly completed appointments with linked verified sales. Missing completion evidence is not inferred from elapsed time. Revenue ratios are production ratios, not customer conversion probabilities.' END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.user_id,'name',x.name) ORDER BY x.name),'[]') INTO members FROM (
  SELECT wm.user_id,coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative') name FROM public.workspace_members wm JOIN auth.users u ON u.id=wm.user_id WHERE wm.workspace_id=p_workspace
  UNION SELECT c.user_id,c.rep_name_snapshot FROM public.field_sales_credits c WHERE c.workspace_id=p_workspace AND NOT EXISTS(SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=p_workspace AND wm.user_id=c.user_id)
 ) x;
 SELECT jsonb_build_object('representatives',members,
  'campaigns',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.campaigns WHERE workspace_id=p_workspace),'[]'),
  'territories',coalesce((SELECT jsonb_agg(jsonb_build_object('id',territory_id,'name',territory_id::text)) FROM (SELECT DISTINCT territory_id FROM public.field_sales_report_scope(p_workspace,f-'territory') WHERE territory_id IS NOT NULL) t),'[]'),
  'teams',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.field_sales_teams WHERE workspace_id=p_workspace),'[]'),
  'products',coalesce((SELECT jsonb_agg(product) FROM (SELECT DISTINCT product FROM public.field_sales_report_scope(p_workspace,f-'product') WHERE product<>'') p),'[]')) INTO options;
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('report_version',1,'currency',cfg.currency,'timezone',cfg.timezone,'filter',f,'as_of',now(),
  'period',period,'period_start',bounds.start_day,'period_end',bounds.end_day-1,'previous_start',bounds.previous_start,'previous_end',bounds.previous_end-1,
  'summary',summary,'previous',previous,'change_percent',changes,'metrics',metrics,'metric_notes',note,
  'sales',rows,'total_records',row_count,'limit',row_limit,'offset',row_offset,'has_more',row_offset+row_limit<row_count,
  'dimension',dimension,'groups',groups,'options',options,
  'financial_definitions',jsonb_build_object('sold','Verified contract value, less reversed contracts, by sale date.',
   'completed','Recorded work completion value by completion date, including completed work whose contract was later cancelled.',
   'collected','Recorded cash received less cash refunds and chargebacks by payment timestamp. No payment is inferred from a sale status.',
   'credit','Rep revenue is the allocated share. Company totals count each contract once. Rep sale counts indicate participation and must not be summed to calculate company sale count.',
   'comparison','Previous period has the same number of calendar days. Both periods use current verification, cancellation and attribution state.'));
END $$;

REVOKE ALL ON FUNCTION public.field_sales_credit_amount(uuid,uuid,numeric),public.field_sales_report_scope(uuid,jsonb),public.field_sales_financial_summary(uuid,jsonb,date,date,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.field_sales_report(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_report(uuid,jsonb) TO authenticated;
COMMIT;
