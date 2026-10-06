BEGIN;
CREATE FUNCTION public.field_conversation_application_options(p_recording uuid,p_conversation uuid,p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations; households jsonb; tasks_enabled boolean;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF c.consent<>'granted' OR NOT c.target_confirmed OR c.review_state<>'pending' THEN RAISE EXCEPTION 'Confirm door assignment and recording permission first' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('addressId',ca.id,
  'label',coalesce(nullif(trim(to_jsonb(ca)->>'address'),''),nullif(trim(to_jsonb(ca)->>'formatted'),''),'Unresolved address '||ca.id::text),
  'contacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',lead.id,'name',coalesce(nullif(trim(to_jsonb(lead)->>'full_name'),''),'Unnamed contact')) ORDER BY lead.id)
   FROM public.contacts lead WHERE lead.workspace_id=r.workspace_id AND lead.user_id=p_user AND coalesce(to_jsonb(lead)->>'lead_kind','field')='field'
   AND coalesce(to_jsonb(lead)->>'address_id',to_jsonb(lead)->>'campaign_address_id','')=ca.id::text),'[]')) ORDER BY ca.id),'[]') INTO households
 FROM public.campaign_addresses ca JOIN public.sessions s ON s.campaign_id=ca.campaign_id JOIN public.campaigns campaign ON campaign.id=ca.campaign_id
 WHERE s.id=r.session_id AND s.workspace_id=r.workspace_id AND campaign.workspace_id=r.workspace_id
 AND (ca.id=c.target_id OR lower(ca.gers_id::text)=c.target_id::text);
 SELECT EXISTS(SELECT 1 FROM public.field_sales_settings WHERE workspace_id=r.workspace_id AND enabled AND currency IS NOT NULL AND timezone IS NOT NULL) INTO tasks_enabled;
 RETURN jsonb_build_object('households',households,'taskCreationEnabled',tasks_enabled);
END $$;
REVOKE ALL ON FUNCTION public.field_conversation_application_options(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_conversation_application_options(uuid,uuid,uuid) TO service_role;
COMMIT;
