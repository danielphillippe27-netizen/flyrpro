BEGIN;
CREATE FUNCTION public.field_recording_provider_usage(p_workspace uuid,p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE today date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_user) THEN
  RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('day',today,'resetAt',(today+1)::timestamp AT TIME ZONE 'UTC',
  'transcribe',count(*) FILTER(WHERE stage='transcribe'),
  'analyze',count(*) FILTER(WHERE stage='analyze'),
  'write',count(*) FILTER(WHERE stage='write'))
  FROM public.field_recording_provider_reservations WHERE workspace_id=p_workspace AND reserved_day=today);
END $$;
REVOKE ALL ON FUNCTION public.field_recording_provider_usage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_recording_provider_usage(uuid,uuid) TO service_role;
COMMIT;
