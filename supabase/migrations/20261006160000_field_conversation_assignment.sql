BEGIN;
ALTER TABLE public.field_conversations ADD COLUMN assignment_history jsonb NOT NULL DEFAULT '[]';
CREATE FUNCTION public.assign_field_conversation(p_recording uuid,p_conversation uuid,p_user uuid,p_version integer,p_target uuid,p_consent text,p_permission_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_conversations;
BEGIN
 -- Match worker lock order: jobs, then recording, then conversation.
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN
  RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.field_conversations WHERE id=p_conversation AND recording_id=r.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable' USING ERRCODE='P0002'; END IF;
 IF c.version<>p_version OR c.review_state<>'pending' THEN RAISE EXCEPTION 'Conversation changed' USING ERRCODE='40001'; END IF;
 IF p_consent NOT IN ('granted','declined','unknown') OR p_consent IS NULL OR (p_consent='granted' AND p_permission_confirmed IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'Explicit recording permission required' USING ERRCODE='22023';
 END IF;
 IF p_target IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.sessions s WHERE s.id=r.session_id AND s.workspace_id=r.workspace_id
  AND (EXISTS(SELECT 1 FROM unnest(s.target_building_ids) target WHERE lower(target)=p_target::text)
   OR EXISTS(SELECT 1 FROM public.campaign_addresses ca JOIN public.campaigns campaign ON campaign.id=ca.campaign_id
     WHERE ca.id=p_target AND ca.campaign_id=s.campaign_id AND campaign.workspace_id=r.workspace_id
     AND EXISTS(SELECT 1 FROM public.field_recording_events e WHERE e.recording_id=r.id AND e.payload->>'kind'='door_started' AND lower(e.payload->>'targetId')=p_target::text)))
 ) THEN RAISE EXCEPTION 'Target does not belong to this session' USING ERRCODE='22023'; END IF;
 UPDATE public.field_conversations SET target_id=p_target,target_confirmed=(p_target IS NOT NULL),consent=p_consent,
  analysis=NULL,summary=NULL,note=NULL,evidence=NULL,action_proposals='[]',version=version+1,
  assignment_history=assignment_history||jsonb_build_array(jsonb_build_object('userId',p_user,'at',now(),'previousTarget',c.target_id,'target',p_target,'previousConsent',c.consent,'consent',p_consent,'permissionConfirmed',p_permission_confirmed,'previousVersion',c.version))
 WHERE id=c.id RETURNING * INTO c;
 -- Invalidate any old worker lease before it can store stale consent/assignment results.
 UPDATE public.field_recording_jobs j SET stage='analyze',status='pending',attempts=0,error_code=NULL,available_at=now(),lease_token=NULL,lease_until=NULL
 WHERE j.recording_id=r.id AND j.chunk_id=c.chunk_id AND j.stage IN ('analyze','write')
 AND EXISTS(SELECT 1 FROM public.field_recording_chunks chunk WHERE chunk.id=c.chunk_id AND chunk.transcription_state='SUCCESS');
 PERFORM public.refresh_field_recording_processing(r.id);
 RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.assign_field_conversation(uuid,uuid,uuid,integer,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assign_field_conversation(uuid,uuid,uuid,integer,uuid,text,boolean) TO service_role;
COMMIT;
