BEGIN;
ALTER TABLE public.field_recording_deletions
 ADD COLUMN storage_attempts integer NOT NULL DEFAULT 0 CHECK(storage_attempts>=0),
 ADD COLUMN storage_retry_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX field_recording_cleanup_retry_idx ON public.field_recording_deletions(storage_retry_after,created_at) WHERE storage_state='pending';
CREATE FUNCTION public.defer_field_recording_storage_cleanup(p_recording uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE public.field_recording_deletions
 SET storage_attempts=least(storage_attempts+1,30),
     storage_retry_after=now()+make_interval(secs=>least(3600,60*power(2,least(storage_attempts,6)))::integer)
 WHERE recording_id=p_recording AND storage_state='pending';
$$;
REVOKE ALL ON FUNCTION public.defer_field_recording_storage_cleanup(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_field_recording_storage_cleanup(uuid) TO service_role;
COMMIT;
