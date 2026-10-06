BEGIN;
CREATE TABLE public.field_recording_provider_reservations (
 lease_token uuid PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES public.field_recording_jobs(id),
 recording_id uuid NOT NULL REFERENCES public.field_recordings(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 stage text NOT NULL CHECK(stage IN ('transcribe','analyze','write')),
 reserved_day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_recording_provider_daily_idx ON public.field_recording_provider_reservations(workspace_id,stage,reserved_day);
ALTER TABLE public.field_recording_provider_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_recording_provider_reservations FROM anon,authenticated;
CREATE FUNCTION public.reserve_field_recording_provider_request(p_job uuid,p_lease uuid,p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.field_recording_jobs; r public.field_recordings; reserved public.field_recording_provider_reservations;
 today date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_limit IS NOT NULL AND (p_limit<0 OR p_limit>1000000) THEN RAISE EXCEPTION 'Invalid provider limit' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM public.field_recording_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_lease OR j.lease_until<=now()
    OR j.stage NOT IN ('transcribe','analyze','write') THEN RAISE EXCEPTION 'Provider lease unavailable' USING ERRCODE='40001'; END IF;
 SELECT * INTO r FROM public.field_recordings WHERE id=j.recording_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=r.user_id) THEN
  RAISE EXCEPTION 'Recording unavailable' USING ERRCODE='42501'; END IF;
 -- Serialize the shared workspace budget across its recordings and workers.
 PERFORM 1 FROM public.workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO reserved FROM public.field_recording_provider_reservations WHERE lease_token=p_lease;
 IF FOUND THEN
  IF reserved.job_id<>j.id OR reserved.stage<>j.stage OR reserved.recording_id<>r.id THEN RAISE EXCEPTION 'Reservation identity changed' USING ERRCODE='40001'; END IF;
  RETURN true;
 END IF;
 IF p_limit IS NOT NULL AND (SELECT count(*) FROM public.field_recording_provider_reservations WHERE workspace_id=r.workspace_id AND stage=j.stage AND reserved_day=today)>=p_limit THEN RETURN false; END IF;
 INSERT INTO public.field_recording_provider_reservations(lease_token,job_id,recording_id,workspace_id,stage,reserved_day)
 VALUES(p_lease,j.id,r.id,r.workspace_id,j.stage,today);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_field_recording_provider_request(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_field_recording_provider_request(uuid,uuid,integer) TO service_role;
COMMIT;
