-- Authorized sale details and revenue ledger. Dollar amounts remain decimal integer strings.
BEGIN;
CREATE FUNCTION public.field_sales_record(p_workspace uuid,p_sale uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings; s public.field_sales;
 result jsonb; credits jsonb; payments jsonb; events jsonb; timeline jsonb; show_money boolean; may_read boolean;
 cash text; contracts text; completed text;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RAISE EXCEPTION 'Sales is not enabled'; END IF;
 SELECT * INTO s FROM public.field_sales WHERE workspace_id=p_workspace AND id=p_sale;
 may_read:=s.created_by=auth.uid() OR s.rep_id=auth.uid() OR s.setter_id=auth.uid() OR s.closer_id=auth.uid()
  OR EXISTS(SELECT 1 FROM public.field_sales_credits WHERE sale_id=s.id AND user_id=auth.uid())
  OR public.field_sales_permission(p_workspace,'team_details');
 IF s.id IS NULL OR NOT coalesce(may_read,false) THEN RAISE EXCEPTION 'Sale access required' USING ERRCODE='42501'; END IF;
 show_money:=CASE WHEN s.rep_id=auth.uid() OR s.created_by=auth.uid() OR s.setter_id=auth.uid() OR s.closer_id=auth.uid()
  THEN public.field_sales_permission(p_workspace,'own_revenue') ELSE public.field_sales_permission(p_workspace,'team_revenue') END;
 result:=to_jsonb(s)-ARRAY['request_id','external_crm_id','external_provider','commission_minor','gross_profit_minor','industry_values'];
 -- Never pass a numeric JSON financial field across the wire.
 FOREACH contracts IN ARRAY ARRAY['value_minor','expected_revenue_minor','completed_value_minor'] LOOP
  result:=result-contracts;
  IF show_money THEN result:=result||jsonb_build_object(contracts,to_jsonb(s)->>contracts); END IF;
 END LOOP;
 IF public.field_sales_permission(p_workspace,'commission') THEN result:=result||jsonb_build_object('commission_minor',s.commission_minor::text); END IF;
 IF public.field_sales_permission(p_workspace,'margin') THEN result:=result||jsonb_build_object('gross_profit_minor',s.gross_profit_minor::text); END IF;
 -- Integer allocation assigns rounding residue to the final stable user ID. Shares sum exactly to the contract.
 WITH shares AS (
  SELECT c.*,floor(s.value_minor::numeric*c.basis_points/10000) base,
   row_number() OVER(ORDER BY (c.basis_points>0) DESC,c.user_id DESC) last_row,
   sum(floor(s.value_minor::numeric*c.basis_points/10000)) OVER() base_sum
  FROM public.field_sales_credits c WHERE c.workspace_id=p_workspace AND c.sale_id=p_sale
 ) SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('user_id',user_id,'role',role,'basis_points',basis_points,
  'rep_name',rep_name_snapshot,'team_id',team_id,'team_name',team_name_snapshot,
  'credited_value_minor',CASE WHEN show_money THEN (base+CASE WHEN last_row=1 THEN s.value_minor-base_sum ELSE 0 END)::text END)) ORDER BY user_id),'[]') INTO credits FROM shares;
 SELECT coalesce(sum(amount_minor),0)::text INTO cash FROM public.field_sales_payments WHERE workspace_id=p_workspace AND sale_id=p_sale;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'amount_minor',amount_minor::text,'occurred_at',occurred_at,'recorded_at',recorded_at,'reference',reference,'note',note) ORDER BY occurred_at,id),'[]') INTO payments
  FROM public.field_sales_payments WHERE workspace_id=p_workspace AND sale_id=p_sale AND show_money;
 SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',e.id,'action',e.action,'created_at',e.created_at,
  'actor',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Representative'),
  'status',e.after_record->>'status','version',e.after_record->'version','currency',s.currency,'sold_on',e.after_record->>'sold_on',
  'reason',coalesce(e.after_record->>'cancellation_reason',e.after_record->>'reason',e.after_record->'attribution_evidence'->>'correction_reason'),
  'value_minor',CASE WHEN show_money THEN e.after_record->>'value_minor' END,
  'amount_minor',CASE WHEN show_money THEN e.after_record->>'amount_minor' END,
  'credits_before',CASE WHEN public.field_sales_permission(p_workspace,'attribution') THEN e.before_record->'credits' END,
  'credits_after',CASE WHEN public.field_sales_permission(p_workspace,'attribution') THEN e.after_record->'credits' END)) ORDER BY e.created_at,e.id),'[]') INTO events
  FROM public.field_sales_events e JOIN auth.users u ON u.id=e.actor_id WHERE e.workspace_id=p_workspace AND e.sale_id=p_sale;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.at),'[]') INTO timeline FROM (
  SELECT c.created_at at,jsonb_build_object('kind','lead','at',c.created_at,'id',c.id) item FROM public.contacts c WHERE c.workspace_id=p_workspace AND c.id=s.contact_id
  UNION ALL SELECT a.timestamp,jsonb_build_object('kind',a.type,'at',a.timestamp,'id',a.id,'note',to_jsonb(a)->>'note')
   FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id WHERE c.workspace_id=p_workspace AND c.id=s.contact_id
  UNION ALL SELECT e.created_at,jsonb_build_object('kind','original_activity','at',e.created_at,'id',e.id)
   FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id WHERE sn.workspace_id=p_workspace AND e.id=s.original_event_id
  UNION ALL SELECT (s.sold_on::timestamp AT TIME ZONE cfg.timezone),jsonb_build_object('kind','sale','at',s.sold_on,'id',s.id)
  UNION ALL SELECT (s.completed_on::timestamp AT TIME ZONE cfg.timezone),jsonb_build_object('kind','completed','at',s.completed_on,'id',s.id) WHERE s.completed_on IS NOT NULL
 ) x;
 RETURN jsonb_strip_nulls(result||jsonb_build_object('collected_revenue_minor',CASE WHEN show_money THEN cash END,
  'net_sold_value_minor',CASE WHEN show_money THEN CASE WHEN s.status='verified' THEN s.value_minor::text ELSE '0' END END,
  'credits',credits,'payments',payments,'events',events,'timeline',timeline,
  'can_verify',s.status='pending' AND public.field_sales_permission(p_workspace,'verify') AND (r='owner' OR (s.rep_id<>auth.uid() AND s.created_by<>auth.uid() AND s.setter_id IS DISTINCT FROM auth.uid() AND s.closer_id IS DISTINCT FROM auth.uid()
    AND NOT EXISTS(SELECT 1 FROM public.field_sales_credits WHERE sale_id=s.id AND user_id=auth.uid()))),
  'can_edit',s.status IN ('pending','verified') AND ((s.created_by=auth.uid() AND s.status='pending') OR public.field_sales_permission(p_workspace,'edit_verified')),
  'can_attribute',public.field_sales_permission(p_workspace,'attribution'),
  'can_complete',s.status='verified' AND public.field_sales_permission(p_workspace,'complete'),
  'can_collect',public.field_sales_permission(p_workspace,'collect'),
  'can_cancel',s.status IN ('pending','verified') AND public.field_sales_permission(p_workspace,'cancel')));
END $$;

-- History uses the same privacy contract as the details, including hidden personal revenue.
CREATE OR REPLACE FUNCTION public.field_sales_history(p_workspace uuid,p_sale uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.field_sales_record(p_workspace,p_sale)->'events';
$$;

ALTER FUNCTION public.field_sales_bootstrap(uuid) RENAME TO field_sales_bootstrap_v1;
REVOKE ALL ON FUNCTION public.field_sales_bootstrap_v1(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.field_sales_bootstrap(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb:=public.field_sales_bootstrap_v1(p_workspace); cfg public.field_sales_settings; capabilities jsonb;
BEGIN
 IF NOT (result->>'enabled')::boolean THEN RETURN result; END IF;
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 SELECT jsonb_object_agg(cap,public.field_sales_permission(p_workspace,cap)) INTO capabilities
  FROM unnest(ARRAY['submit','verify','cancel','complete','collect','export','team_details','attribution','team_revenue','own_revenue','leaderboard_revenue','commission','margin','edit_verified']) cap;
 RETURN result||jsonb_build_object('pro_sales_version',1,'capabilities',capabilities,'verification_required',cfg.verification_required,
  'rep_revenue_visible',cfg.rep_revenue_visible,'minimum_close_opportunities',cfg.minimum_close_opportunities,'industry',cfg.industry,'terminology',cfg.terminology,
  'featured_ranking',cfg.featured_ranking,'feed_options',cfg.feed_options,
  'settings',CASE WHEN result->>'role' IN ('owner','admin') THEN to_jsonb(cfg) END);
END $$;

-- Old client dashboards must respect new visibility settings while they are upgraded.
ALTER FUNCTION public.field_sales_dashboard(uuid,text,boolean,uuid,uuid,text) RENAME TO field_sales_dashboard_v1;
REVOKE ALL ON FUNCTION public.field_sales_dashboard_v1(uuid,text,boolean,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.field_sales_dashboard(p_workspace uuid,p_period text DEFAULT 'month',p_team boolean DEFAULT false,p_rep uuid DEFAULT NULL,p_campaign uuid DEFAULT NULL,p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; own boolean; show_money boolean; cfg public.field_sales_settings; key text;
BEGIN
 result:=public.field_sales_dashboard_v1(p_workspace,p_period,p_team,p_rep,p_campaign,p_status);
 IF NOT coalesce((result->>'enabled')::boolean,false) OR coalesce((result->>'needs_setup')::boolean,false) THEN RETURN result; END IF;
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 own:=NOT p_team OR p_rep=auth.uid();
 show_money:=CASE WHEN own THEN public.field_sales_permission(p_workspace,'own_revenue') ELSE public.field_sales_permission(p_workspace,'team_revenue') OR public.field_sales_permission(p_workspace,'leaderboard_revenue') END;
 IF NOT show_money THEN
  result:=jsonb_set(result,'{totals}',(result->'totals')-ARRAY['revenue_minor','weekly_revenue_minor','monthly_revenue_minor']);
  result:=jsonb_set(result,'{sales}',(SELECT coalesce(jsonb_agg(x-'value_minor'),'[]') FROM jsonb_array_elements(result->'sales') x));
 END IF;
 IF NOT public.field_sales_permission(p_workspace,'leaderboard_revenue') THEN
  result:=jsonb_set(result,'{ranking}',(SELECT coalesce(jsonb_agg(x-'revenue_minor'),'[]') FROM jsonb_array_elements(result->'ranking') x));
 END IF;
 -- Feed settings apply even when the viewer can see revenue elsewhere.
 IF NOT coalesce((cfg.feed_options->>'enabled')::boolean,true) THEN result:=jsonb_set(result,'{feed}','[]');
 ELSE
  IF NOT coalesce((cfg.feed_options->>'contract_values')::boolean,false) OR NOT public.field_sales_permission(p_workspace,'leaderboard_revenue') THEN
   result:=jsonb_set(result,'{feed}',(SELECT coalesce(jsonb_agg(x-'value_minor'),'[]') FROM jsonb_array_elements(result->'feed') x));
  END IF;
  IF NOT coalesce((cfg.feed_options->>'rep_names')::boolean,true) THEN
   result:=jsonb_set(result,'{feed}',(SELECT coalesce(jsonb_agg(x||'{"rep_name":"A team member"}'::jsonb),'[]') FROM jsonb_array_elements(result->'feed') x));
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_record(uuid,uuid),public.field_sales_history(uuid,uuid),public.field_sales_bootstrap(uuid),public.field_sales_dashboard(uuid,text,boolean,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_record(uuid,uuid),public.field_sales_history(uuid,uuid),public.field_sales_bootstrap(uuid),public.field_sales_dashboard(uuid,text,boolean,uuid,uuid,text) TO authenticated;
COMMIT;
