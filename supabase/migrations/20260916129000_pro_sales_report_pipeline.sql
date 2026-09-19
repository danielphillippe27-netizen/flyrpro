-- Current pipeline is a snapshot, independent of the report's historical sale dates.
BEGIN;
ALTER FUNCTION public.field_sales_report(uuid,jsonb) RENAME TO field_sales_report_without_pipeline;
REVOKE ALL ON FUNCTION public.field_sales_report_without_pipeline(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.field_sales_report(p_workspace uuid,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb; f jsonb; rep uuid; money_on boolean; pipeline jsonb;
BEGIN
 d:=public.field_sales_report_without_pipeline(p_workspace,p_filter);
 IF NOT coalesce((d->>'enabled')::boolean,false) OR coalesce((d->>'needs_setup')::boolean,false) THEN RETURN d; END IF;
 f:=d->'filter'; rep:=nullif(f->>'rep','')::uuid;
 -- These attributes exist on signed sales, not reliably on open opportunities.
 IF nullif(f->>'team','') IS NOT NULL OR nullif(f->>'product','') IS NOT NULL OR nullif(f->>'source','') IS NOT NULL OR nullif(f->>'status','') IS NOT NULL THEN
  RETURN d||jsonb_build_object('current_pipeline',jsonb_build_object('available',false,'note','Current pipeline is unavailable with historical sale-team, product, source or sale-status filters. Clear these filters to inspect open opportunities.'));
 END IF;
 money_on:=CASE WHEN rep=auth.uid() THEN public.field_sales_permission(p_workspace,'own_revenue') ELSE public.field_sales_permission(p_workspace,'team_revenue') END;
 WITH scoped AS MATERIALIZED (
  SELECT o.*,s.kind,s.label,s.position,s.probability FROM public.field_sales_opportunities o
  JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id
  LEFT JOIN public.campaigns cp ON cp.id=c.campaign_id AND cp.workspace_id=c.workspace_id
  JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
  WHERE o.workspace_id=p_workspace AND (rep IS NULL OR c.user_id=rep)
   AND (nullif(f->>'campaign','') IS NULL OR c.campaign_id=(f->>'campaign')::uuid)
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
  'note','Current open and lost opportunities, across all dates. Representative, campaign and territory follow the current lead owner and links. Unchanged means no opportunity update for 72 hours. Potential value is not sold, collected or a forecast.')) INTO pipeline;
 RETURN d||jsonb_build_object('current_pipeline',pipeline);
END $$;
REVOKE ALL ON FUNCTION public.field_sales_report(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_report(uuid,jsonb) TO authenticated;
COMMIT;
