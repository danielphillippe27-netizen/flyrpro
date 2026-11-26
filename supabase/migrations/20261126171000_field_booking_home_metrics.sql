BEGIN;

-- A NULL result lets clients preserve their existing counters in non-pilot workspaces.
CREATE FUNCTION public.field_sales_personal_booking_count(
  p_user uuid, p_workspace uuid DEFAULT NULL, p_from timestamptz DEFAULT '-infinity',
  p_until timestamptz DEFAULT now()
) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  tracked uuid[];
  total bigint;
  older bigint;
BEGIN
  IF p_user IS NULL OR (p_user IS DISTINCT FROM auth.uid() AND current_setting('role') <> 'service_role') THEN
    RAISE EXCEPTION 'Personal booking stats require the signed-in representative' USING ERRCODE='42501';
  END IF;
  IF p_workspace IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_user
  ) THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE='42501'; END IF;

  SELECT array_agg(s.workspace_id) INTO tracked FROM public.field_sales_settings s
  WHERE s.roofing_appointments_enabled AND (p_workspace IS NULL OR s.workspace_id=p_workspace)
    AND EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=s.workspace_id AND m.user_id=p_user);
  IF tracked IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO total FROM unnest(tracked) AS w(id)
  CROSS JOIN LATERAL public.field_sales_booking_activity(w.id,jsonb_build_object('rep',p_user),
    (p_from AT TIME ZONE 'UTC')::date,(p_until AT TIME ZONE 'UTC')::date+1,'UTC') b
  WHERE b.booked_at BETWEEN p_from AND p_until;
  IF p_workspace IS NULL THEN
    -- Personal lifetime Stats also includes field meetings outside canonical workspaces.
    SELECT count(DISTINCT (a.contact_id,a.timestamp,lower(trim(coalesce(to_jsonb(a)->>'note','')))))
    INTO older FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id
    WHERE c.user_id=p_user AND c.lead_kind='field' AND a.type='meeting'
      AND (c.workspace_id IS NULL OR (c.workspace_id<>ALL(tracked) AND EXISTS (
        SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=c.workspace_id AND m.user_id=p_user)))
      AND a.created_at BETWEEN p_from AND p_until;
    total:=total+older;
  END IF;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.field_sales_personal_booking_count(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.field_sales_personal_booking_count(uuid,uuid,timestamptz,timestamptz) TO authenticated,service_role;

-- The team dashboard route checks the caller and intersects requested IDs with its roster.
CREATE FUNCTION public.field_sales_team_booking_counts(
  p_workspace uuid, p_members uuid[], p_previous timestamptz, p_start timestamptz,
  p_end timestamptz, p_lifetime boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN EXISTS (
   SELECT 1 FROM public.field_sales_settings WHERE workspace_id=p_workspace AND roofing_appointments_enabled
 ) THEN (
   SELECT jsonb_strip_nulls(jsonb_build_object(
     'current',count(*) FILTER (WHERE b.booked_at BETWEEN p_start AND p_end),
     'previous',count(*) FILTER (WHERE b.booked_at>=p_previous AND b.booked_at<p_start),
     'lifetime',CASE WHEN p_lifetime THEN count(*) END
   )) FROM public.field_sales_booking_activity(p_workspace,'{}',
     CASE WHEN p_lifetime THEN '-infinity'::date ELSE (p_previous AT TIME ZONE 'UTC')::date END,
     ((CASE WHEN p_lifetime THEN greatest(p_end,now()) ELSE p_end END) AT TIME ZONE 'UTC')::date+1,
     'UTC') b WHERE p_members IS NULL OR b.setter_id=ANY(p_members)
 ) END;
$$;
REVOKE ALL ON FUNCTION public.field_sales_team_booking_counts(uuid,uuid[],timestamptz,timestamptz,timestamptz,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_sales_team_booking_counts(uuid,uuid[],timestamptz,timestamptz,timestamptz,boolean)
 TO service_role;

-- Preserve the installed door/lead calculations and their caller's RLS context.
ALTER FUNCTION public.wolfy_home_metrics(uuid,timestamptz,timestamptz,timestamptz) RENAME TO wolfy_home_metrics_before_field_bookings;
CREATE FUNCTION public.wolfy_home_metrics(p_workspace uuid,p_day timestamptz,p_week timestamptz,p_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  result jsonb:=public.wolfy_home_metrics_before_field_bookings(p_workspace,p_day,p_week,p_until);
  bookings bigint:=public.field_sales_personal_booking_count(auth.uid(),p_workspace,p_day,p_until);
BEGIN
  IF bookings IS NOT NULL THEN
    result:=result || jsonb_build_object('appointments',bookings,'appointments_set',bookings);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.wolfy_home_metrics(uuid,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wolfy_home_metrics(uuid,timestamptz,timestamptz,timestamptz) TO authenticated;

COMMIT;
