BEGIN;

ALTER TABLE public.field_appointment_reminders
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN push_claimed_at timestamptz,
  ADD COLUMN push_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN push_delivered_tokens uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN push_error text;

CREATE FUNCTION public.field_appointment_alerts(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE alerts jsonb;
BEGIN
  PERFORM public.field_sales_role(p_workspace);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'appointment_id',r.appointment_id,'kind',r.kind,
    'start_at',r.start_at,'contact_name',r.contact_name
  ) ORDER BY r.due_at DESC),'[]') INTO alerts
  FROM (
    SELECT r.id,r.appointment_id,r.kind,r.due_at,a.start_at,c.full_name AS contact_name
    FROM public.field_appointment_reminders r
    JOIN public.field_appointments a ON a.id=r.appointment_id AND a.workspace_id=r.workspace_id
    JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=a.workspace_id
    JOIN public.field_sales_settings s ON s.workspace_id=r.workspace_id
    WHERE r.workspace_id=p_workspace AND r.recipient_id=auth.uid()
      AND s.roofing_appointments_enabled AND s.roofing_reminders_enabled
      AND r.cancelled_at IS NULL AND r.due_at<=now() AND a.start_at>now()
      AND a.assignee_id=r.recipient_id AND a.schedule_version=r.schedule_version
      AND a.status IN ('scheduled','confirmed')
    ORDER BY r.due_at DESC LIMIT 50
  ) r;
  RETURN jsonb_build_object('alerts',alerts);
END
$$;

CREATE FUNCTION public.field_appointment_claim_push()
RETURNS TABLE(id uuid,workspace_id uuid,appointment_id uuid,recipient_id uuid,kind text,delivered_tokens uuid[],attempt integer)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH available AS (
    SELECT r.id FROM public.field_appointment_reminders r
    JOIN public.field_appointments a ON a.id=r.appointment_id AND a.workspace_id=r.workspace_id
    JOIN public.field_sales_settings s ON s.workspace_id=r.workspace_id
    JOIN public.workspace_members m ON m.workspace_id=r.workspace_id AND m.user_id=r.recipient_id
    WHERE s.roofing_appointments_enabled AND s.roofing_reminders_enabled
      AND r.cancelled_at IS NULL AND r.dispatched_at IS NULL AND r.due_at<=now()
      AND r.push_attempts<5 AND (r.push_claimed_at IS NULL OR r.push_claimed_at<now()-interval '2 minutes')
      AND a.assignee_id=r.recipient_id AND a.schedule_version=r.schedule_version
      AND a.status IN ('scheduled','confirmed') AND a.start_at>now()
    ORDER BY r.due_at,r.id LIMIT 8 FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE public.field_appointment_reminders r
    SET push_claimed_at=now(),push_attempts=r.push_attempts+1
    FROM available WHERE r.id=available.id
    RETURNING r.id,r.workspace_id,r.appointment_id,r.recipient_id,r.kind,r.push_delivered_tokens,r.push_attempts
$$;

CREATE FUNCTION public.field_appointment_push_current(p_id uuid,p_attempt integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.field_appointment_reminders r
    JOIN public.field_appointments a ON a.id=r.appointment_id AND a.workspace_id=r.workspace_id
    JOIN public.field_sales_settings s ON s.workspace_id=r.workspace_id
    JOIN public.workspace_members m ON m.workspace_id=r.workspace_id AND m.user_id=r.recipient_id
    WHERE r.id=p_id AND r.push_attempts=p_attempt AND r.cancelled_at IS NULL AND r.dispatched_at IS NULL
      AND s.roofing_appointments_enabled AND s.roofing_reminders_enabled
      AND a.assignee_id=r.recipient_id AND a.schedule_version=r.schedule_version
      AND a.status IN ('scheduled','confirmed') AND a.start_at>now()
  )
$$;

CREATE FUNCTION public.field_appointment_finish_push(p_id uuid,p_attempt integer,p_delivered uuid[],p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE public.field_appointment_reminders r
  SET push_delivered_tokens=p_delivered,push_error=left(p_error,300),
      dispatched_at=CASE WHEN p_error IS NULL THEN now() ELSE NULL END
  WHERE r.id=p_id AND r.push_attempts=p_attempt AND r.cancelled_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.field_appointment_alerts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_appointment_alerts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.field_appointment_claim_push(),
  public.field_appointment_push_current(uuid,integer),
  public.field_appointment_finish_push(uuid,integer,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_appointment_claim_push(),
  public.field_appointment_push_current(uuid,integer),
  public.field_appointment_finish_push(uuid,integer,uuid[],text) TO service_role;

COMMIT;
