BEGIN;
CREATE FUNCTION public.enqueue_field_recording_chunk(p_recording uuid,p_user uuid,p_chunk uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; c public.field_recording_chunks; j public.field_recording_jobs;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording AND user_id=p_user AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.field_recording_chunks WHERE id=p_chunk AND recording_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audio unavailable'; END IF;
 INSERT INTO public.field_recording_jobs(recording_id,chunk_id,stage,deduplication_key)
 VALUES(r.id,c.id,'verify','chunk:'||c.id::text) ON CONFLICT(deduplication_key) DO NOTHING;
 SELECT * INTO j FROM public.field_recording_jobs WHERE deduplication_key='chunk:'||c.id::text;
 PERFORM public.refresh_field_recording_processing(r.id);
 RETURN to_jsonb(j);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_field_recording_chunk(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_field_recording_chunk(uuid,uuid,uuid) TO service_role;
COMMIT;
