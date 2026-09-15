-- Preserve exact aggregate estimates above the bigint limit. Individual values remain bounded.
BEGIN;
CREATE OR REPLACE FUNCTION public.field_sales_workbench(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; stages jsonb; opportunities jsonb; tasks jsonb; summary jsonb; leads jsonb;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF cfg.currency IS NULL OR cfg.timezone IS NULL THEN RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',true); END IF;
 INSERT INTO public.field_sales_stages(workspace_id,key,label,position,probability,kind) VALUES
 (p_workspace,'new','New',0,0,'open'),(p_workspace,'qualified','Qualified',1,25,'open'),(p_workspace,'appointment','Appointment',2,50,'open'),
 (p_workspace,'proposal','Proposal',3,75,'open'),(p_workspace,'won','Won',4,100,'won'),(p_workspace,'lost','Lost',5,0,'lost') ON CONFLICT DO NOTHING;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY position,key) INTO stages FROM public.field_sales_stages s WHERE workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('contact_name',c.full_name,'expected_value_minor',o.expected_value_minor::text) ORDER BY o.updated_at DESC),'[]'::jsonb)
 INTO opportunities FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND c.user_id=auth.uid()
 WHERE o.workspace_id=p_workspace AND o.user_id=auth.uid();
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('contact_name',c.full_name) ORDER BY t.due_at),'[]'::jsonb) INTO tasks
 FROM public.field_sales_tasks t JOIN public.contacts c ON c.id=t.contact_id AND c.workspace_id=t.workspace_id AND c.user_id=auth.uid()
 WHERE t.workspace_id=p_workspace AND t.user_id=auth.uid() AND (t.status='pending' OR t.completed_at>now()-interval '30 days');
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',s.key,'label',s.label,'kind',s.kind,'count',q.n,'missing_values',q.missing,
 'value_minor',CASE WHEN r IN ('owner','admin') OR cfg.team_revenue_visible THEN q.value::text END,
 'weighted_minor',CASE WHEN r IN ('owner','admin') OR cfg.team_revenue_visible THEN q.weighted::text END)) ORDER BY s.position,s.key) INTO summary
 FROM public.field_sales_stages s CROSS JOIN LATERAL (SELECT count(*) n,count(*) FILTER(WHERE expected_value_minor IS NULL) missing,coalesce(sum(expected_value_minor),0) value,
 round(coalesce(sum(expected_value_minor::numeric*s.probability/100),0)) weighted FROM public.field_sales_opportunities o WHERE o.workspace_id=p_workspace AND o.stage_key=s.key) q WHERE s.workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name),'[]'::jsonb) INTO leads FROM public.contacts c WHERE workspace_id=p_workspace AND user_id=auth.uid() AND coalesce(to_jsonb(c)->>'lead_kind','field')='field';
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('needs_setup',false,'stages',stages,'opportunities',opportunities,'tasks',tasks,'summary',summary,'leads',leads,'as_of',now());
END $$;
COMMIT;
