BEGIN;
CREATE FUNCTION public.field_sales_home(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_name text:=public.field_sales_role(p_workspace);cfg public.field_sales_settings;manager boolean;money_on boolean;f jsonb;
 today date;week_start date;month_start date;weekly jsonb;monthly jsonb;daily jsonb;activity jsonb;goals jsonb;board jsonb;self_board jsonb;latest jsonb;
 doors bigint;talks bigint;leads bigint;appointments bigint;completed bigint;wins bigint;pending bigint;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.timezone IS NULL OR cfg.currency IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 manager:=public.field_sales_permission(p_workspace,'team_details');
 f:=CASE WHEN manager THEN '{}'::jsonb ELSE jsonb_build_object('rep',auth.uid()) END;
 money_on:=public.field_sales_permission(p_workspace,CASE WHEN manager THEN 'team_revenue' ELSE 'own_revenue' END);
 today:=(now() AT TIME ZONE cfg.timezone)::date;week_start:=date_trunc('week',today)::date;month_start:=date_trunc('month',today)::date;
 weekly:=public.field_sales_financial_summary(p_workspace,f,week_start,today+1,cfg.timezone,money_on);
 monthly:=public.field_sales_financial_summary(p_workspace,f,month_start,today+1,cfg.timezone,money_on);
 daily:=public.field_sales_financial_summary(p_workspace,f,today,today+1,cfg.timezone,money_on);
 SELECT count(*) FILTER(WHERE kind='doors'),count(*) FILTER(WHERE kind='conversations'),count(*) FILTER(WHERE kind='leads'),
  count(*) FILTER(WHERE kind='appointments'),count(*) FILTER(WHERE kind='appointments_completed'),count(*) FILTER(WHERE kind='appointments_completed' AND converted)
 INTO doors,talks,leads,appointments,completed,wins FROM public.field_sales_activity_rows(p_workspace,f,week_start,today+1,cfg.timezone);
 activity:=jsonb_build_object('doors',doors,'conversations',talks,'leads',leads,'appointments',appointments,'appointments_completed',completed,
  'close_rate',CASE WHEN completed>0 THEN round(wins::numeric*100/completed,2)::text END);
 SELECT coalesce(jsonb_agg(public.field_sales_target_progress((SELECT t FROM public.field_sales_targets t WHERE t.id=g.id),cfg.timezone,cfg.minimum_close_opportunities) ORDER BY priority,g.ends_on-g.starts_on,g.id),'[]') INTO goals
 FROM (SELECT *,CASE WHEN metric='sold_value' THEN 0 WHEN metric='sales' THEN 1 ELSE 2 END priority FROM public.field_sales_targets
  WHERE workspace_id=p_workspace AND NOT archived AND starts_on<=today AND ends_on>=today
  AND scope=CASE WHEN manager THEN 'workspace' ELSE 'rep' END AND scope_id IS NOT DISTINCT FROM CASE WHEN NOT manager THEN auth.uid() END
  AND public.field_sales_target_access(p_workspace,scope,scope_id,metric)
  ORDER BY priority,ends_on-starts_on,id LIMIT 5) g;
 board:=public.field_sales_leaderboard(p_workspace,jsonb_build_object('period','week','limit',1),NULL);
 IF board->>'metric' IS NOT NULL THEN self_board:=public.field_sales_leaderboard(p_workspace,jsonb_build_object('period','week','focus_rep',auth.uid(),'limit',1),board->>'metric'); END IF;
 SELECT count(*) INTO pending FROM public.field_sales_report_scope(p_workspace,f) WHERE status='pending';
 IF NOT manager OR coalesce((cfg.feed_options->>'enabled')::boolean,true) THEN
  SELECT jsonb_strip_nulls(jsonb_build_object('id',s.id,'sold_on',s.sold_on,
   'rep_name',CASE WHEN NOT manager OR coalesce((cfg.feed_options->>'rep_names')::boolean,true) THEN s.rep_name_snapshot ELSE 'A team member' END,
   'value_minor',CASE WHEN money_on AND (NOT manager OR coalesce((cfg.feed_options->>'contract_values')::boolean,false)) THEN public.field_sales_credit_amount(s.id,CASE WHEN NOT manager THEN auth.uid() END,s.value_minor)::text END))
  INTO latest FROM public.field_sales_report_scope(p_workspace,f) s WHERE status='verified' AND sold_on<=today ORDER BY sold_on DESC,verified_at DESC,id LIMIT 1;
 END IF;
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('home_version',1,'scope',CASE WHEN manager THEN 'workspace' ELSE 'rep' END,
  'week_start',week_start,'through',today,'weekly',weekly,'monthly',monthly,'daily',daily,'activity',activity,'active_goals',goals,
  'pending_review',pending,'latest_sale',latest,'ranking',jsonb_build_object('metric',board->>'metric','unit',board->>'unit','top',board->'rows'->0,'self',self_board->'rows'->0),
  'notes','Week starts Monday in workspace time. Only eligible verified sales count as sold. Completed value and cash remain separate. Activity uses source owners; close rate uses completed appointment cohorts.');
END $$;
REVOKE ALL ON FUNCTION public.field_sales_home(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_home(uuid) TO authenticated;
COMMIT;
