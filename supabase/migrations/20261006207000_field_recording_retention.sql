BEGIN;
-- Disabled until a member explicitly saves a duration and rollout enables expiry.
CREATE TABLE public.field_recording_retention_policies (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 retention_days integer CHECK(retention_days BETWEEN 1 AND 3650),
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id)
);
ALTER TABLE public.field_recording_retention_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_recording_retention_policies FROM anon,authenticated;
CREATE FUNCTION public.set_field_recording_retention(p_workspace uuid,p_user uuid,p_days integer,p_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE policy public.field_recording_retention_policies;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_user) THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 IF p_days IS NOT NULL AND (p_days<1 OR p_days>3650) THEN RAISE EXCEPTION 'Invalid retention duration' USING ERRCODE='22023'; END IF;
 -- Serializes first insert and subsequent updates for this owner and workspace.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_user::text,0));
 SELECT * INTO policy FROM public.field_recording_retention_policies WHERE workspace_id=p_workspace AND user_id=p_user FOR UPDATE;
 IF coalesce(policy.version,0) IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Retention settings changed' USING ERRCODE='40001'; END IF;
 INSERT INTO public.field_recording_retention_policies(workspace_id,user_id,retention_days) VALUES(p_workspace,p_user,p_days)
 ON CONFLICT(workspace_id,user_id) DO UPDATE SET retention_days=excluded.retention_days,version=field_recording_retention_policies.version+1,updated_at=now()
 RETURNING * INTO policy;
 RETURN jsonb_build_object('retentionDays',policy.retention_days,'version',policy.version);
END $$;
CREATE FUNCTION public.expire_field_recording(p_recording uuid,p_policy_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.field_recordings; policy public.field_recording_retention_policies; request uuid;
BEGIN
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO policy FROM public.field_recording_retention_policies WHERE workspace_id=r.workspace_id AND user_id=r.user_id FOR UPDATE;
 IF NOT FOUND OR policy.version IS DISTINCT FROM p_policy_version OR policy.retention_days IS NULL THEN RETURN NULL; END IF;
 -- Match deletion's job -> recording lock order; policy setters never lock jobs.
 PERFORM 1 FROM public.field_recording_jobs WHERE recording_id=p_recording ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.field_recordings WHERE id=p_recording FOR UPDATE;
 IF r.deleted_at IS NOT NULL OR r.capture_state<>'stopped' OR r.ended_at IS NULL OR r.ended_at>now()-make_interval(secs=>policy.retention_days::double precision*86400)
 OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=r.user_id) THEN RETURN NULL; END IF;
 request:=gen_random_uuid();
 RETURN public.request_field_recording_deletion(r.id,r.user_id,request);
END $$;
REVOKE ALL ON FUNCTION public.set_field_recording_retention(uuid,uuid,integer,bigint),public.expire_field_recording(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_field_recording_retention(uuid,uuid,integer,bigint),public.expire_field_recording(uuid,bigint) TO service_role;
COMMIT;
