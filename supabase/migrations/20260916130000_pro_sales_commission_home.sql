BEGIN;
CREATE FUNCTION public.field_sales_commission_home(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_name text:=public.field_sales_role(p_workspace);cfg public.field_sales_settings;today date;first_day date;visible boolean;summary jsonb;target numeric;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN jsonb_build_object('enabled',true,'needs_setup',true); END IF;
 today:=(now() AT TIME ZONE cfg.timezone)::date;first_day:=date_trunc('week',today)::date;
 visible:=public.field_sales_permission(p_workspace,'commission');
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'weekly_sales',count(*) FILTER(WHERE sold_on>=first_day),
  'daily_sales',count(*) FILTER(WHERE sold_on=today),
  'weekly_commission_minor',CASE WHEN visible THEN coalesce(sum(public.field_sales_credit_amount(id,auth.uid(),commission_minor)) FILTER(WHERE sold_on>=first_day),0)::text END,
  'daily_commission_minor',CASE WHEN visible THEN coalesce(sum(public.field_sales_credit_amount(id,auth.uid(),commission_minor)) FILTER(WHERE sold_on=today),0)::text END,
  'weekly_missing',CASE WHEN visible THEN count(*) FILTER(WHERE sold_on>=first_day AND commission_minor IS NULL) END,
  'daily_missing',CASE WHEN visible THEN count(*) FILTER(WHERE sold_on=today AND commission_minor IS NULL) END)) INTO summary
 FROM public.field_sales_report_scope(p_workspace,jsonb_build_object('rep',auth.uid()))
 WHERE status='verified' AND sold_on BETWEEN first_day AND today;
 IF visible THEN
  SELECT g.target INTO target FROM public.field_sales_targets g WHERE g.workspace_id=p_workspace AND g.scope='rep' AND g.scope_id=auth.uid()
   AND g.metric='commission' AND NOT g.archived AND g.starts_on=first_day AND g.ends_on=first_day+6;
 END IF;
 RETURN summary||jsonb_strip_nulls(jsonb_build_object('enabled',true,'commission_visible',visible,'currency',cfg.currency,'timezone',cfg.timezone,
  'week_start',first_day,'through',today,'weekly_target_minor',target::text,
  'note','Estimated gross commission on your verified sales, allocated by split credit and sale date in workspace time. Excludes reversed sales. This is not commission paid out.'));
END $$;
REVOKE ALL ON FUNCTION public.field_sales_commission_home(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_commission_home(uuid) TO authenticated;
COMMIT;
