BEGIN;
ALTER TABLE public.field_recording_chunks ADD COLUMN mime_type text NOT NULL DEFAULT 'audio/mpeg';
ALTER TABLE public.field_recording_chunks ADD COLUMN provider_upload jsonb;
ALTER TABLE public.field_recording_chunks ADD COLUMN provider_parts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.field_recording_chunks ADD COLUMN provider_download_url text;
ALTER TABLE public.field_recording_chunks ADD COLUMN verified_at timestamptz;
ALTER TABLE public.field_recording_jobs ADD COLUMN lease_token uuid;
ALTER TABLE public.field_recording_jobs DROP CONSTRAINT field_recording_jobs_stage_check;
ALTER TABLE public.field_recording_jobs ADD CONSTRAINT field_recording_jobs_stage_check CHECK(stage IN ('verify','upload','transcribe','poll','analyze','write'));
ALTER TABLE public.field_conversations ADD COLUMN timing jsonb;
ALTER TABLE public.field_conversations ADD COLUMN evidence jsonb;
ALTER TABLE public.field_conversations ADD COLUMN action_proposals jsonb NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX field_conversations_chunk_start ON public.field_conversations(chunk_id,((segments->0->>'id'))) WHERE chunk_id IS NOT NULL;

-- Derive recording status from every chunk/job, rather than the last worker result.
CREATE FUNCTION public.refresh_field_recording_processing(p_recording uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.field_recordings r SET processing_state=CASE
  WHEN r.deleted_at IS NOT NULL THEN 'deleted'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.recording_id=r.id AND j.status='error') THEN 'error'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.recording_id=r.id AND j.status IN ('pending','running') AND j.stage IN ('verify','upload')) THEN 'transferring'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.recording_id=r.id AND j.status IN ('pending','running') AND j.stage IN ('transcribe','poll')) THEN 'transcription_pending'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.recording_id=r.id AND j.status IN ('pending','running')) THEN 'analyzing'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_chunks c WHERE c.recording_id=r.id AND NOT EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.chunk_id=c.id)) THEN 'uploaded'
  WHEN EXISTS(SELECT 1 FROM public.field_recording_jobs j WHERE j.recording_id=r.id AND j.status='done') THEN 'needs_review'
  ELSE 'awaiting_file' END,updated_at=now(),version=version+1
 WHERE r.id=p_recording;
END $$;
REVOKE ALL ON FUNCTION public.refresh_field_recording_processing(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_field_recording_processing(uuid) TO service_role;

CREATE FUNCTION public.claim_field_recording_job() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.field_recording_jobs; expired_recording uuid;
BEGIN
 -- A crash after submission intent may mean an external transcription exists.
 -- Do not repeat a paid submission when no task ID was durably received.
 FOR expired_recording IN
  UPDATE public.field_recording_jobs SET status='error',error_code='submission_outcome_unknown',lease_token=NULL,lease_until=NULL
  WHERE status='running' AND stage='transcribe' AND lease_until<now()
  RETURNING recording_id
 LOOP
  PERFORM public.refresh_field_recording_processing(expired_recording);
 END LOOP;
 SELECT q.* INTO j FROM public.field_recording_jobs q JOIN public.field_recordings r ON r.id=q.recording_id
 WHERE r.deleted_at IS NULL AND ((q.status='pending' AND q.available_at<=now()) OR (q.status='running' AND q.lease_until<now()))
 AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.user_id=r.user_id AND m.workspace_id=r.workspace_id)
 ORDER BY q.available_at,q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.field_recording_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

CREATE FUNCTION public.commit_field_recording_job(p_job uuid,p_lease uuid,p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.field_recording_jobs; r public.field_recordings; conv jsonb;
BEGIN
 SELECT * INTO j FROM public.field_recording_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_lease THEN RETURN false; END IF;
 SELECT * INTO r FROM public.field_recordings WHERE id=j.recording_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN
  UPDATE public.field_recording_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE id=j.id; RETURN false;
 END IF;
 IF p_result ? 'chunk' THEN
  UPDATE public.field_recording_chunks SET
   verified_at=CASE WHEN p_result->'chunk' ? 'verified_at' THEN (p_result->'chunk'->>'verified_at')::timestamptz ELSE verified_at END,
   provider_upload=coalesce(p_result->'chunk'->'provider_upload',provider_upload),
   provider_parts=coalesce(p_result->'chunk'->'provider_parts',provider_parts),
   provider_download_url=coalesce(p_result->'chunk'->>'provider_download_url',provider_download_url),
   transcription_id=coalesce(p_result->'chunk'->>'transcription_id',transcription_id),
   transcription_state=coalesce(p_result->'chunk'->>'transcription_state',transcription_state),
   transcript=coalesce(p_result->'chunk'->'transcript',transcript)
  WHERE id=j.chunk_id AND recording_id=r.id;
 END IF;
 IF p_result ? 'conversations' THEN
  FOR conv IN SELECT value FROM jsonb_array_elements(p_result->'conversations') LOOP
   INSERT INTO public.field_conversations(recording_id,chunk_id,target_id,target_confirmed,consent,segments,timing)
   VALUES(r.id,j.chunk_id,nullif(conv->>'targetId','')::uuid,false,conv->>'consent',conv->'segments',conv->'timing')
   ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 IF p_result ? 'conversation' THEN
  UPDATE public.field_conversations SET
   analysis=CASE WHEN p_result->'conversation' ? 'analysis' THEN p_result->'conversation'->'analysis' ELSE analysis END,
   summary=CASE WHEN p_result->'conversation' ? 'summary' THEN p_result->'conversation'->>'summary' ELSE summary END,
   note=CASE WHEN p_result->'conversation' ? 'note' THEN p_result->'conversation'->>'note' ELSE note END,
   evidence=CASE WHEN p_result->'conversation' ? 'evidence' THEN p_result->'conversation'->'evidence' ELSE evidence END,
   action_proposals=CASE WHEN p_result->'conversation' ? 'action_proposals' THEN p_result->'conversation'->'action_proposals' ELSE action_proposals END,
   version=version+1
  WHERE id=(p_result->'conversation'->>'id')::uuid AND recording_id=r.id AND review_state='pending'
   AND version=(p_result->'conversation'->>'expectedVersion')::integer;
 END IF;
 UPDATE public.field_recording_jobs SET stage=coalesce(p_result->>'nextStage',stage),status=coalesce(p_result->>'status','pending'),
  available_at=now()+make_interval(secs=>coalesce((p_result->>'delaySeconds')::integer,0)),
  error_code=p_result->>'errorCode',lease_token=NULL,lease_until=NULL WHERE id=j.id;
 PERFORM public.refresh_field_recording_processing(r.id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_field_recording_job(),public.commit_field_recording_job(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_field_recording_job(),public.commit_field_recording_job(uuid,uuid,jsonb) TO service_role;
COMMIT;
