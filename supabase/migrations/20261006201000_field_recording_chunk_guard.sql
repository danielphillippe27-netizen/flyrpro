BEGIN;
CREATE FUNCTION public.guard_field_recording_chunk_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; expected text;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=NEW.recording_id FOR UPDATE;
 IF NOT FOUND OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Recording unavailable for audio upload' USING ERRCODE='42501'; END IF;
 expected:=r.workspace_id::text||'/'||r.user_id::text||'/'||r.id::text||'/'||NEW.id::text||'.mp3';
 IF NEW.storage_path<>expected THEN RAISE EXCEPTION 'Audio path identity changed' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND (NEW.recording_id<>OLD.recording_id OR NEW.storage_path<>OLD.storage_path OR NEW.id<>OLD.id) THEN RAISE EXCEPTION 'Audio chunk identity is immutable' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER field_recording_chunk_identity BEFORE INSERT OR UPDATE OF recording_id,storage_path,id ON public.field_recording_chunks FOR EACH ROW EXECUTE FUNCTION public.guard_field_recording_chunk_identity();
COMMIT;
