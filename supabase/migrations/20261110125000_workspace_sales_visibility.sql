BEGIN;

ALTER TABLE public.field_sales_settings ADD COLUMN workspace_sales_override boolean;

CREATE FUNCTION public.field_sales_is_roofing(p_industry text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(p_industry ~* '(^|[^[:alnum:]])roof',false);
$$;

-- Keep existing Sales opt-ins, including workspaces outside the roofing rollout.
UPDATE public.field_sales_settings SET workspace_sales_override=true WHERE enabled;

INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
SELECT w.id,true,t.name
FROM public.workspaces w LEFT JOIN pg_timezone_names t ON t.name=w.timezone
WHERE public.field_sales_is_roofing(w.industry)
ON CONFLICT (workspace_id) DO UPDATE
 SET enabled=coalesce(field_sales_settings.workspace_sales_override,true),
     timezone=coalesce(field_sales_settings.timezone,excluded.timezone);

CREATE OR REPLACE FUNCTION public.field_sales_initialize_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
 VALUES(NEW.id,public.field_sales_is_roofing(NEW.industry),
        (SELECT name FROM pg_timezone_names WHERE name=NEW.timezone))
 ON CONFLICT(workspace_id) DO NOTHING;
 RETURN NEW;
END $$;

CREATE FUNCTION public.field_sales_apply_industry_default() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.field_sales_settings(workspace_id,enabled,timezone)
 VALUES(NEW.id,public.field_sales_is_roofing(NEW.industry),
        (SELECT name FROM pg_timezone_names WHERE name=NEW.timezone))
 ON CONFLICT(workspace_id) DO UPDATE
 SET enabled=coalesce(field_sales_settings.workspace_sales_override,excluded.enabled);
 RETURN NEW;
END $$;

CREATE TRIGGER field_sales_industry_default AFTER UPDATE OF industry ON public.workspaces
 FOR EACH ROW WHEN (OLD.industry IS DISTINCT FROM NEW.industry)
 EXECUTE FUNCTION public.field_sales_apply_industry_default();

CREATE FUNCTION public.field_sales_workspace_command(p_workspace uuid,p_enabled boolean DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings;
 w public.workspaces; can_manage boolean:=r IN ('owner','admin');
BEGIN
 IF p_enabled IS NOT NULL THEN
  IF NOT can_manage THEN
   RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501';
  END IF;
  -- Serialize with industry changes and take locks in the same order as the trigger.
  SELECT * INTO STRICT w FROM public.workspaces WHERE id=p_workspace FOR NO KEY UPDATE;
  INSERT INTO public.field_sales_settings(workspace_id,enabled,workspace_sales_override,timezone)
  VALUES(p_workspace,p_enabled,p_enabled,(SELECT name FROM pg_timezone_names WHERE name=w.timezone))
  ON CONFLICT(workspace_id) DO UPDATE SET enabled=excluded.enabled,workspace_sales_override=excluded.workspace_sales_override
  RETURNING * INTO cfg;
 ELSE
  SELECT * INTO w FROM public.workspaces WHERE id=p_workspace;
  SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 END IF;
 RETURN jsonb_build_object('enabled',coalesce(cfg.enabled,false),'can_manage',can_manage,
  'roofing_default',public.field_sales_is_roofing(w.industry),
  'needs_setup',coalesce(cfg.enabled,false) AND (cfg.currency IS NULL OR cfg.timezone IS NULL));
END $$;

ALTER TABLE public.field_sales
 ADD COLUMN source_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;

-- Existing sales already carrying a source event have explicit session evidence.
UPDATE public.field_sales s SET source_session_id=sn.id
FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id
WHERE e.id=s.original_event_id AND sn.workspace_id=s.workspace_id;

CREATE INDEX field_sales_verified_session_idx ON public.field_sales(workspace_id,source_session_id)
 WHERE source_session_id IS NOT NULL AND status='verified';

ALTER TABLE public.field_appointments
 ADD COLUMN source_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;
CREATE INDEX field_appointments_source_session_idx ON public.field_appointments(workspace_id,source_session_id)
 WHERE source_session_id IS NOT NULL;

CREATE FUNCTION public.field_appointment_capture_source_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 SELECT sn.id INTO NEW.source_session_id FROM public.contacts c
 JOIN public.sessions sn ON sn.id::text=to_jsonb(c)->>'session_id' AND sn.workspace_id=c.workspace_id
 WHERE c.id=NEW.contact_id AND c.workspace_id=NEW.workspace_id AND sn.user_id=NEW.created_by
   AND sn.campaign_id IS NOT DISTINCT FROM NEW.campaign_id
   AND c.created_at>=sn.start_time AND NEW.created_at>=c.created_at
   AND NEW.created_at<=coalesce(sn.end_time,now());
 RETURN NEW;
END $$;

CREATE TRIGGER field_appointment_capture_source_session BEFORE INSERT ON public.field_appointments
 FOR EACH ROW EXECUTE FUNCTION public.field_appointment_capture_source_session();

CREATE FUNCTION public.field_sales_capture_source_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.original_event_id IS NOT DISTINCT FROM OLD.original_event_id THEN RETURN NEW; END IF;
 END IF;
 NEW.source_session_id:=NULL;
 IF NEW.original_event_id IS NOT NULL THEN
  SELECT sn.id INTO NEW.source_session_id
  FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id
  WHERE e.id=NEW.original_event_id AND sn.workspace_id=NEW.workspace_id;
 ELSIF NEW.field_appointment_id IS NOT NULL THEN
  SELECT a.source_session_id INTO NEW.source_session_id FROM public.field_appointments a
  WHERE a.id=NEW.field_appointment_id AND a.workspace_id=NEW.workspace_id;
 ELSIF TG_OP='INSERT' AND NEW.sale_source IN ('door','legacy') AND NEW.appointment_id IS NULL THEN
  -- A same-day door sale can use its contact's recorded session when the
  -- closer ran that session. Later jobs need an explicit source event.
  SELECT sn.id INTO NEW.source_session_id
  FROM public.contacts c
  JOIN public.sessions sn ON sn.id::text=to_jsonb(c)->>'session_id' AND sn.workspace_id=c.workspace_id
  JOIN public.field_sales_settings cfg ON cfg.workspace_id=c.workspace_id
  WHERE c.id=NEW.contact_id AND c.workspace_id=NEW.workspace_id AND sn.user_id=NEW.closer_id
    AND sn.campaign_id IS NOT DISTINCT FROM NEW.campaign_id
    AND (sn.start_time AT TIME ZONE cfg.timezone)::date=NEW.sold_on
    AND (c.created_at AT TIME ZONE cfg.timezone)::date=NEW.sold_on
    AND c.created_at>=sn.start_time;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER field_sales_capture_source_session BEFORE INSERT OR UPDATE OF original_event_id ON public.field_sales
 FOR EACH ROW EXECUTE FUNCTION public.field_sales_capture_source_session();

CREATE FUNCTION public.field_sales_session_summary(p_workspace uuid,p_session uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r text:=public.field_sales_role(p_workspace); cfg public.field_sales_settings;
 viewer uuid:=auth.uid(); session_owner uuid; full_value boolean; show_value boolean;
BEGIN
 SELECT * INTO cfg FROM public.field_sales_settings WHERE workspace_id=p_workspace;
 IF NOT coalesce(cfg.enabled,false) THEN RETURN jsonb_build_object('enabled',false); END IF;
 SELECT sn.user_id INTO session_owner FROM public.sessions sn WHERE sn.id=p_session AND sn.workspace_id=p_workspace;
 IF NOT FOUND OR (session_owner IS DISTINCT FROM viewer AND NOT public.field_sales_permission(p_workspace,'team_details')) THEN
  RAISE EXCEPTION 'Session is unavailable' USING ERRCODE='42501';
 END IF;
 full_value:=public.field_sales_permission(p_workspace,'team_revenue');
 show_value:=full_value OR (session_owner=viewer AND public.field_sales_permission(p_workspace,'own_revenue'));
 RETURN (
  SELECT jsonb_strip_nulls(jsonb_build_object('enabled',true,'verified_sales',count(*),'currency',cfg.currency,
   'appointments_set',(SELECT count(*) FROM public.field_appointments a
     WHERE a.workspace_id=p_workspace AND a.source_session_id=p_session),
   'appointments_closed',count(DISTINCT coalesce(s.field_appointment_id,s.appointment_id)),
   'value_scope',CASE WHEN show_value THEN CASE WHEN full_value THEN 'session' ELSE 'self' END END,
   'value_minor',CASE WHEN show_value AND cfg.currency IS NOT NULL THEN
    coalesce(sum(public.field_sales_credit_amount(s.id,CASE WHEN NOT full_value THEN viewer END,s.value_minor)),0)::text END))
  FROM public.field_sales s
  WHERE s.workspace_id=p_workspace AND s.source_session_id=p_session AND s.status='verified'
 );
END $$;

CREATE FUNCTION public.field_sales_appointment_bookings(w uuid,f jsonb,first_day date,last_day date,zone text)
RETURNS TABLE (appointment_id uuid,setter_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH bookings AS (
  SELECT a.id,a.setter_id,a.campaign_id,a.created_at
  FROM public.field_appointments a
  WHERE a.workspace_id=w AND a.created_by IS NOT NULL
  UNION ALL
  SELECT a.id,(to_jsonb(a)->>'created_by')::uuid,c.campaign_id,a.created_at
  FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=w
  WHERE a.type='meeting' AND NOT EXISTS (
   SELECT 1 FROM public.field_appointment_legacy_links link
   JOIN public.field_appointments canonical ON canonical.workspace_id=w AND canonical.id=link.appointment_id
   WHERE link.workspace_id=w AND link.source_kind='meeting' AND link.source_id=a.id
     AND canonical.created_by IS NOT NULL)
 )
 SELECT b.id,b.setter_id FROM bookings b LEFT JOIN public.campaigns cp ON cp.id=b.campaign_id AND cp.workspace_id=w
 WHERE b.created_at>=first_day::timestamp AT TIME ZONE zone AND b.created_at<last_day::timestamp AT TIME ZONE zone AND b.created_at<=now()
   AND nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL
   AND (nullif(f->>'rep','') IS NULL OR b.setter_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR b.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND (nullif(f->>'team','') IS NULL OR EXISTS (
    SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=b.setter_id
      AND m.team_id=(f->>'team')::uuid AND m.starts_at<=b.created_at AND (m.ends_at IS NULL OR m.ends_at>b.created_at)));
$$;

CREATE FUNCTION public.field_sales_appointment_closings(w uuid,f jsonb,first_day date,last_day date,zone text)
RETURNS TABLE (appointment_id uuid,closer_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(s.field_appointment_id,l.appointment_id,s.appointment_id),coalesce(s.closer_id,s.rep_id)
 FROM public.field_sales_report_scope(w,f) s LEFT JOIN public.field_appointment_legacy_links l
 ON l.workspace_id=w AND l.source_kind='meeting' AND l.source_id=s.appointment_id
 WHERE s.status='verified' AND coalesce(s.field_appointment_id,s.appointment_id) IS NOT NULL
   AND s.sold_on>=first_day AND s.sold_on<last_day AND s.sold_on<=(now() AT TIME ZONE zone)::date
   AND (nullif(f->>'rep','') IS NULL OR coalesce(s.closer_id,s.rep_id)=(f->>'rep')::uuid);
$$;

ALTER FUNCTION public.field_sales_home(uuid) RENAME TO field_sales_home_base;
CREATE FUNCTION public.field_sales_home(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb:=public.field_sales_home_base(p_workspace); n bigint; bookings bigint; f jsonb;
BEGIN
 IF NOT (d ? 'activity') THEN RETURN d; END IF;
 f:=CASE WHEN d->>'scope'='workspace' THEN '{}' ELSE jsonb_build_object('rep',auth.uid()) END;
 SELECT count(DISTINCT appointment_id) INTO n FROM public.field_sales_appointment_closings(
  p_workspace,f,(d->>'week_start')::date,(d->>'through')::date+1,d->>'timezone');
 SELECT count(DISTINCT appointment_id) INTO bookings FROM public.field_sales_appointment_bookings(
  p_workspace,f,(d->>'week_start')::date,(d->>'through')::date+1,d->>'timezone');
 RETURN jsonb_set(d,'{activity}',d->'activity'||jsonb_build_object('appointments_closed',n,'appointments_set',bookings));
END $$;

ALTER FUNCTION public.field_sales_report(uuid,jsonb) RENAME TO field_sales_report_base;
CREATE FUNCTION public.field_sales_report(p_workspace uuid,p_filter jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb:=public.field_sales_report_base(p_workspace,p_filter); n bigint; bookings bigint;
BEGIN
 IF NOT (d ? 'metrics') THEN RETURN d; END IF;
 SELECT count(DISTINCT appointment_id) INTO n FROM public.field_sales_appointment_closings(
  p_workspace,d->'filter',(d->>'period_start')::date,(d->>'period_end')::date+1,d->>'timezone');
 IF (d->'metrics'->>'available')::boolean THEN
  SELECT count(DISTINCT appointment_id) INTO bookings FROM public.field_sales_appointment_bookings(
   p_workspace,d->'filter',(d->>'period_start')::date,(d->>'period_end')::date+1,d->>'timezone');
 END IF;
 RETURN jsonb_set(d,'{metrics}',d->'metrics'||jsonb_strip_nulls(jsonb_build_object('appointments_closed',n,'appointments_set',bookings)));
END $$;

ALTER FUNCTION public.field_sales_leaderboard(uuid,jsonb,text) RENAME TO field_sales_leaderboard_base;
CREATE FUNCTION public.field_sales_leaderboard(p_workspace uuid,p_filter jsonb DEFAULT '{}',p_metric text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb:=public.field_sales_leaderboard_base(p_workspace,p_filter,p_metric); entries jsonb;
BEGIN
 IF NOT (d ? 'period_start') OR NOT (d->'categories' ? 'appointments') THEN RETURN d; END IF;
 WITH closed AS (
  SELECT closer_id,count(DISTINCT appointment_id) n FROM public.field_sales_appointment_closings(
   p_workspace,p_filter,(d->>'period_start')::date,(d->>'period_end')::date+1,d->>'timezone')
  GROUP BY closer_id
 ), booked AS (
  SELECT setter_id,count(DISTINCT appointment_id) n FROM public.field_sales_appointment_bookings(
   p_workspace,p_filter,(d->>'period_start')::date,(d->>'period_end')::date+1,d->>'timezone')
  GROUP BY setter_id
 )
 SELECT coalesce(jsonb_agg(jsonb_set(row,'{metrics}',row->'metrics'||jsonb_build_object(
  'appointments_closed',coalesce(closed.n,0)::text,'appointments_set',coalesce(booked.n,0)::text)) ORDER BY ord),'[]')
 INTO entries FROM jsonb_array_elements(d->'rows') WITH ORDINALITY AS page(row,ord)
 LEFT JOIN closed ON closer_id=(row->>'rep_id')::uuid LEFT JOIN booked ON setter_id=(row->>'rep_id')::uuid;
 RETURN jsonb_set(d,'{rows}',entries);
END $$;

REVOKE ALL ON FUNCTION public.field_appointment_capture_source_session(),
 public.field_sales_appointment_bookings(uuid,jsonb,date,date,text),public.field_sales_appointment_closings(uuid,jsonb,date,date,text),public.field_sales_home_base(uuid),
 public.field_sales_report_base(uuid,jsonb),public.field_sales_leaderboard_base(uuid,jsonb,text),
 public.field_sales_home(uuid),public.field_sales_report(uuid,jsonb),public.field_sales_leaderboard(uuid,jsonb,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_sales_home(uuid),public.field_sales_report(uuid,jsonb),
 public.field_sales_leaderboard(uuid,jsonb,text) TO authenticated;

REVOKE ALL ON FUNCTION public.field_sales_is_roofing(text),public.field_sales_apply_industry_default(),
 public.field_sales_capture_source_session(),public.field_sales_workspace_command(uuid,boolean),
 public.field_sales_session_summary(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.field_sales_workspace_command(uuid,boolean),
 public.field_sales_session_summary(uuid,uuid) TO authenticated;

COMMIT;
