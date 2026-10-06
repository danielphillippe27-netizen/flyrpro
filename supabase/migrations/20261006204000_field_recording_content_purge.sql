BEGIN;
ALTER TABLE public.field_recording_deletions ADD COLUMN content_purged_at timestamptz;
-- Reconcile cleanup completed by earlier code before content purging existed.
UPDATE public.field_recording_deletions SET storage_state='pending',storage_retry_after=now() WHERE storage_state='done';
CREATE FUNCTION public.complete_field_recording_storage_cleanup(p_recording uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; d public.field_recording_deletions;
BEGIN
 -- Keep the same lock order as deletion, restructuring and worker commits.
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording FOR UPDATE;
 SELECT * INTO d FROM public.field_recording_deletions WHERE recording_id=p_recording FOR UPDATE;
 IF r.id IS NULL OR d.recording_id IS NULL OR r.deleted_at IS NULL
    OR r.user_id<>d.user_id OR r.workspace_id<>d.workspace_id THEN
  RAISE EXCEPTION 'Deletion identity unavailable' USING ERRCODE='42501';
 END IF;
 IF d.storage_not_before>now() THEN RAISE EXCEPTION 'Upload access has not expired' USING ERRCODE='40001'; END IF;
 IF d.content_purged_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.field_recording_chunks SET transcript=NULL,provider_upload=NULL,provider_parts='[]',provider_download_url=NULL WHERE recording_id=r.id;
 UPDATE public.field_conversation_applications SET result=result-'conversation'
 WHERE conversation_id IN (SELECT id FROM public.field_conversations WHERE recording_id=r.id);
 UPDATE public.field_conversations SET segments='[]',analysis=NULL,summary=NULL,note=NULL,evidence=NULL,
  action_proposals='[]',assignment_history='[]',target_id=NULL,target_confirmed=false,timing=NULL,version=version+1
 WHERE recording_id=r.id;
 UPDATE public.field_recording_events SET payload='{}' WHERE recording_id=r.id;
 UPDATE public.field_recording_deletions SET storage_state='done',content_purged_at=now() WHERE recording_id=r.id;
 -- Provider/device copies and approved CRM activities/tasks are separate custody.
END $$;
REVOKE ALL ON FUNCTION public.complete_field_recording_storage_cleanup(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_field_recording_storage_cleanup(uuid) TO service_role;
COMMIT;
