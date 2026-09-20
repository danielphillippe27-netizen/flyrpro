BEGIN;
ALTER TABLE public.field_sales_opportunities ADD COLUMN lost_at timestamptz;
ALTER FUNCTION public.field_sales_pipeline_command(uuid,text,jsonb) RENAME TO field_sales_pipeline_command_v1;
REVOKE ALL ON FUNCTION public.field_sales_pipeline_command_v1(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.field_sales_pipeline_command(p_workspace uuid,p_action text,p_data jsonb) RETURNS jsonb
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
 IF p_action<>'opportunity' THEN RETURN public.field_sales_pipeline_command_v1(p_workspace,p_action,p_data); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('contact_id','stage_key','expected_value_minor','expected_close','notes','version','loss_reason','loss_note')) THEN RAISE EXCEPTION 'Unknown opportunity field'; END IF;
 SELECT * INTO lead_record FROM public.contacts WHERE id=(p_data->>'contact_id')::uuid AND workspace_id=p_workspace
  AND (user_id=auth.uid() OR public.field_sales_permission(p_workspace,'team_details'));
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an accessible workspace lead' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.field_sales_opportunities WHERE workspace_id=p_workspace AND contact_id=lead_record.id FOR UPDATE;
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
 ON CONFLICT(workspace_id,contact_id) DO UPDATE SET user_id=excluded.user_id,stage_key=excluded.stage_key,expected_value_minor=excluded.expected_value_minor,
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
 INTO opportunities FROM public.field_sales_opportunities o JOIN public.contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id AND (team_scope OR c.user_id=auth.uid())
 WHERE o.workspace_id=p_workspace AND (team_scope OR EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid()));
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('contact_name',c.full_name) ORDER BY t.due_at),'[]'::jsonb) INTO tasks
 FROM public.field_sales_tasks t JOIN public.contacts c ON c.id=t.contact_id AND c.workspace_id=t.workspace_id AND c.user_id=auth.uid()
 WHERE t.workspace_id=p_workspace AND t.user_id=auth.uid() AND (t.status='pending' OR t.completed_at>now()-interval '30 days');
 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',s.key,'label',s.label,'kind',s.kind,'count',q.n,'missing_values',q.missing,
 'value_minor',CASE WHEN money_on THEN q.value::text END,
 'weighted_minor',CASE WHEN money_on THEN q.weighted::text END)) ORDER BY s.position,s.key) INTO summary
 FROM public.field_sales_stages s CROSS JOIN LATERAL (SELECT count(*) n,count(*) FILTER(WHERE expected_value_minor IS NULL) missing,coalesce(sum(expected_value_minor),0) value,
 round(coalesce(sum(expected_value_minor::numeric*s.probability/100),0)) weighted FROM public.field_sales_opportunities o WHERE o.workspace_id=p_workspace AND o.stage_key=s.key AND (team_scope OR EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid()))) q WHERE s.workspace_id=p_workspace;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name) ORDER BY c.full_name),'[]'::jsonb) INTO leads FROM public.contacts c WHERE workspace_id=p_workspace AND (team_scope OR user_id=auth.uid()) AND coalesce(to_jsonb(c)->>'lead_kind','field')='field';
 SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n,'percent',percent) ORDER BY n DESC,reason),'[]') INTO losses FROM (
  SELECT reason,n,round(n*100.0/sum(n) OVER(),2)::text percent FROM (
   SELECT coalesce(o.loss_reason,'unspecified') reason,count(*) n FROM public.field_sales_opportunities o JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
   WHERE o.workspace_id=p_workspace AND (team_scope OR EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid())) AND s.kind='lost' GROUP BY coalesce(o.loss_reason,'unspecified')
  ) reasons
 ) ranked;
 SELECT jsonb_strip_nulls(jsonb_build_object('count',count(*),'missing_values',count(*) FILTER(WHERE o.expected_value_minor IS NULL),
  'value_minor',CASE WHEN money_on THEN coalesce(sum(o.expected_value_minor),0)::text END,
  'stalled',count(*) FILTER(WHERE o.updated_at<now()-interval '72 hours'))) INTO open_pipeline
 FROM public.field_sales_opportunities o JOIN public.field_sales_stages s ON s.workspace_id=o.workspace_id AND s.key=o.stage_key
 WHERE o.workspace_id=p_workspace AND (team_scope OR EXISTS(SELECT 1 FROM public.contacts owned WHERE owned.id=o.contact_id AND owned.workspace_id=p_workspace AND owned.user_id=auth.uid())) AND s.kind='open';
 RETURN public.field_sales_bootstrap(p_workspace)||jsonb_build_object('pipeline_version',2,'scope',CASE WHEN team_scope THEN 'workspace' ELSE 'self' END,'money_visible',money_on,'losses',losses,'open_pipeline',open_pipeline,'needs_setup',false,'stages',stages,'opportunities',opportunities,'tasks',tasks,'task_leads',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name)) FROM public.contacts WHERE workspace_id=p_workspace AND user_id=auth.uid()),'[]'),'summary',summary,'leads',leads,'as_of',now());
END $$;

REVOKE ALL ON FUNCTION public.field_sales_pipeline_command(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_pipeline_command(uuid,text,jsonb) TO authenticated;
COMMIT;
