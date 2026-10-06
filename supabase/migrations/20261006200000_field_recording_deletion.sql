BEGIN;
CREATE TABLE public.field_recording_deletions (
 recording_id uuid PRIMARY KEY REFERENCES public.field_recordings(id),
 request_id uuid NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 manifest jsonb NOT NULL,
 storage_state text NOT NULL DEFAULT 'pending' CHECK(storage_state IN ('pending','done','error')),
 provider_state text NOT NULL DEFAULT 'pending' CHECK(provider_state IN ('pending','done','error','unavailable')),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
ALTER TABLE public.field_recording_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_recording_deletions FROM anon,authenticated;
CREATE FUNCTION public.request_field_recording_deletion(p_recording uuid,p_user uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; prior public.field_recording_deletions; files jsonb;
BEGIN
 IF p_request IS NULL THEN RAISE EXCEPTION 'Deletion request required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.field_recording_deletions WHERE recording_id=r.id;
 IF FOUND THEN
  IF prior.user_id<>p_user OR prior.request_id<>p_request THEN RAISE EXCEPTION 'Deletion request changed' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('recordingId',r.id,'requestId',prior.request_id,'storageState',prior.storage_state,'providerState',prior.provider_state,'replayed',true);
 END IF;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deletion needs reconciliation' USING ERRCODE='40001'; END IF;
 IF r.capture_state<>'stopped' THEN RAISE EXCEPTION 'Stop recording before deleting' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('chunkId',id,'storagePath',storage_path,'providerFileId',provider_upload->>'FileId','transcriptionId',transcription_id) ORDER BY id),'[]') INTO files FROM public.field_recording_chunks WHERE recording_id=r.id;
 INSERT INTO public.field_recording_deletions(recording_id,request_id,user_id,workspace_id,manifest) VALUES(r.id,p_request,p_user,r.workspace_id,files);
 UPDATE public.field_recording_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,error_code='recording_deleted' WHERE recording_id=r.id AND status IN ('pending','running');
 UPDATE public.field_recordings SET deleted_at=now(),processing_state='deleted',version=version+1,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('recordingId',r.id,'requestId',p_request,'storageState','pending','providerState','pending','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.request_field_recording_deletion(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_field_recording_deletion(uuid,uuid,uuid) TO service_role;
COMMIT;
