BEGIN;
ALTER TABLE public.field_recordings ADD COLUMN retention_retry_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX field_recordings_retention_due ON public.field_recordings(retention_retry_after,ended_at,id) WHERE deleted_at IS NULL AND capture_state='stopped' AND ended_at IS NOT NULL;
-- Selection is advisory. Expiry rechecks policy and identity under locks in its own transaction.
CREATE FUNCTION public.field_recording_retention_candidates()
RETURNS TABLE(recording_id uuid,policy_version bigint) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.id,p.version FROM public.field_recordings r
 JOIN public.field_recording_retention_policies p ON p.workspace_id=r.workspace_id AND p.user_id=r.user_id
 WHERE p.retention_days IS NOT NULL AND r.deleted_at IS NULL AND r.capture_state='stopped' AND r.ended_at IS NOT NULL
 AND r.retention_retry_after<=now() AND r.ended_at<=now()-make_interval(secs=>p.retention_days::double precision*86400)
 AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=r.workspace_id AND m.user_id=r.user_id)
 ORDER BY r.retention_retry_after,r.ended_at,r.id LIMIT 3;
$$;
CREATE FUNCTION public.defer_field_recording_retention(p_recording uuid,p_policy_version bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE public.field_recordings r SET retention_retry_after=now()+interval '15 minutes'
 WHERE r.id=p_recording AND r.deleted_at IS NULL AND EXISTS(
 SELECT 1 FROM public.field_recording_retention_policies p WHERE p.workspace_id=r.workspace_id AND p.user_id=r.user_id AND p.version=p_policy_version AND p.retention_days IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.field_recording_retention_candidates(),public.defer_field_recording_retention(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_recording_retention_candidates(),public.defer_field_recording_retention(uuid,bigint) TO service_role;
COMMIT;
