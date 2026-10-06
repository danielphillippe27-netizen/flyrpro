BEGIN;
CREATE FUNCTION public.review_field_conversation_draft(p_recording uuid,p_conversation uuid,p_user uuid,p_version integer,p_operation text,p_writing jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN
  RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF c.version<>p_version OR c.review_state<>'pending' THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF p_operation NOT IN ('save_draft','reject') THEN RAISE EXCEPTION 'Invalid review operation'; END IF;
 IF p_operation='save_draft' THEN
  IF p_writing IS NULL OR jsonb_typeof(p_writing)<>'object' OR jsonb_typeof(p_writing->'actions')<>'array' OR jsonb_typeof(p_writing->'evidence')<>'array' THEN RAISE EXCEPTION 'Invalid draft'; END IF;
  UPDATE public.field_conversations SET summary=p_writing->>'summary',note=p_writing->>'note',evidence=p_writing->'evidence',action_proposals=p_writing->'actions',version=version+1 WHERE id=c.id RETURNING * INTO c;
 ELSE
  UPDATE public.field_conversations SET review_state='rejected',reviewed_at=now(),version=version+1 WHERE id=c.id RETURNING * INTO c;
 END IF;
 RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.review_field_conversation_draft(uuid,uuid,uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_field_conversation_draft(uuid,uuid,uuid,integer,text,jsonb) TO service_role;
COMMIT;
