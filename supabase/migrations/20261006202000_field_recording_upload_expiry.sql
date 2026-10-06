BEGIN;
ALTER TABLE public.field_recordings ADD COLUMN upload_access_until timestamptz;
ALTER TABLE public.field_recording_deletions ADD COLUMN storage_not_before timestamptz NOT NULL DEFAULT (now()+interval '125 minutes');
CREATE FUNCTION public.reserve_field_recording_upload(p_recording uuid,p_user uuid,p_chunk uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_user) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.field_recording_chunks WHERE id=p_chunk AND recording_id=r.id) THEN RAISE EXCEPTION 'Audio chunk unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE public.field_recordings SET upload_access_until=greatest(coalesce(upload_access_until,now()),now()+interval '125 minutes') WHERE id=r.id;
 RETURN true;
END $$;
CREATE FUNCTION public.defer_field_recording_storage_cleanup() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE deadline timestamptz;
BEGIN
 SELECT upload_access_until INTO deadline FROM public.field_recordings WHERE id=NEW.recording_id;
 NEW.storage_not_before:=greatest(NEW.storage_not_before,coalesce(deadline,now()+interval '125 minutes'));
 RETURN NEW;
END $$;
CREATE TRIGGER field_recording_cleanup_expiry BEFORE INSERT ON public.field_recording_deletions FOR EACH ROW EXECUTE FUNCTION public.defer_field_recording_storage_cleanup();
REVOKE ALL ON FUNCTION public.reserve_field_recording_upload(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_field_recording_upload(uuid,uuid,uuid) TO service_role;
COMMIT;
