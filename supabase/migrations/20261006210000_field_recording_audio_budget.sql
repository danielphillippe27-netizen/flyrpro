BEGIN;
ALTER TABLE public.field_recording_chunks ADD COLUMN measured_audio_ms bigint CHECK(measured_audio_ms BETWEEN 1 AND 18000000);
ALTER TABLE public.field_recording_provider_reservations ADD COLUMN reserved_audio_ms bigint NOT NULL DEFAULT 0 CHECK(reserved_audio_ms BETWEEN 0 AND 18000000);
-- Historical requests were not measured: reserve the maximum supported duration conservatively.
UPDATE public.field_recording_provider_reservations SET reserved_audio_ms=18000000 WHERE stage='transcribe';
CREATE FUNCTION public.checkpoint_field_recording_audio_duration(p_job uuid,p_lease uuid,p_duration bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.field_recording_jobs; r public.field_recordings; c public.field_recording_chunks;
BEGIN
 IF p_duration IS NULL OR p_duration NOT BETWEEN 1 AND 18000000 THEN RAISE EXCEPTION 'Invalid audio duration' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.field_recording_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR p_lease IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until IS NULL OR j.lease_until<=now() OR j.stage NOT IN ('verify','transcribe') THEN RAISE EXCEPTION 'Verification lease unavailable' USING ERRCODE='40001'; END IF;
 SELECT * INTO r FROM public.field_recordings WHERE id=j.recording_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=r.user_id) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.field_recording_chunks WHERE id=j.chunk_id AND recording_id=r.id FOR UPDATE;
 IF c.id IS NULL OR (c.measured_audio_ms IS NOT NULL AND c.measured_audio_ms<>p_duration) THEN RAISE EXCEPTION 'Audio identity changed' USING ERRCODE='40001'; END IF;
 UPDATE public.field_recording_chunks SET measured_audio_ms=p_duration WHERE id=c.id;
END $$;
REVOKE ALL ON FUNCTION public.checkpoint_field_recording_audio_duration(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_field_recording_audio_duration(uuid,uuid,bigint) TO service_role;
-- Remove the old signature so an older worker cannot bypass the new duration check.
DROP FUNCTION public.reserve_field_recording_provider_request(uuid,uuid,integer);
CREATE FUNCTION public.reserve_field_recording_provider_request(p_job uuid,p_lease uuid,p_limit integer,p_minutes_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.field_recording_jobs; r public.field_recordings; c public.field_recording_chunks; reserved public.field_recording_provider_reservations;
 today date:=(now() AT TIME ZONE 'UTC')::date; audio bigint:=0;
BEGIN
 IF (p_limit IS NOT NULL AND (p_limit<0 OR p_limit>1000000)) OR (p_minutes_limit IS NOT NULL AND (p_minutes_limit<0 OR p_minutes_limit>1000000)) THEN RAISE EXCEPTION 'Invalid provider limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.field_recording_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR p_lease IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until IS NULL OR j.lease_until<=now() OR j.stage NOT IN ('transcribe','analyze','write') THEN RAISE EXCEPTION 'Provider lease unavailable' USING ERRCODE='40001'; END IF;
 SELECT * INTO r FROM public.field_recordings WHERE id=j.recording_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=r.user_id) THEN RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO reserved FROM public.field_recording_provider_reservations WHERE lease_token=p_lease;
 IF FOUND THEN
  IF reserved.job_id<>j.id OR reserved.stage<>j.stage OR reserved.recording_id<>r.id THEN RAISE EXCEPTION 'Reservation identity changed' USING ERRCODE='40001'; END IF;
  RETURN true;
 END IF;
 IF j.stage='transcribe' THEN
  SELECT * INTO c FROM public.field_recording_chunks WHERE id=j.chunk_id AND recording_id=r.id;
  IF c.id IS NULL OR c.verified_at IS NULL OR c.measured_audio_ms IS NULL THEN RAISE EXCEPTION 'Measured audio unavailable' USING ERRCODE='40001'; END IF;
  audio:=((c.measured_audio_ms+59999)/60000)*60000;
  IF p_minutes_limit IS NOT NULL AND (SELECT coalesce(sum(reserved_audio_ms),0) FROM public.field_recording_provider_reservations WHERE workspace_id=r.workspace_id AND reserved_day=today AND stage='transcribe')+audio>p_minutes_limit::bigint*60000 THEN RETURN false; END IF;
 END IF;
 IF p_limit IS NOT NULL AND (SELECT count(*) FROM public.field_recording_provider_reservations WHERE workspace_id=r.workspace_id AND stage=j.stage AND reserved_day=today)>=p_limit THEN RETURN false; END IF;
 INSERT INTO public.field_recording_provider_reservations(lease_token,job_id,recording_id,workspace_id,stage,reserved_day,reserved_audio_ms)
 VALUES(p_lease,j.id,r.id,r.workspace_id,j.stage,today,audio);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_field_recording_provider_request(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_field_recording_provider_request(uuid,uuid,integer,integer) TO service_role;
CREATE FUNCTION public.field_recording_audio_usage(p_workspace uuid,p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE today date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_user) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('day',today,'resetAt',(today+1)::timestamp AT TIME ZONE 'UTC',
   'reservedMinutes',coalesce(sum(reserved_audio_ms),0)/60000)
   FROM public.field_recording_provider_reservations WHERE workspace_id=p_workspace AND reserved_day=today AND stage='transcribe');
END $$;
REVOKE ALL ON FUNCTION public.field_recording_audio_usage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_recording_audio_usage(uuid,uuid) TO service_role;
COMMIT;
