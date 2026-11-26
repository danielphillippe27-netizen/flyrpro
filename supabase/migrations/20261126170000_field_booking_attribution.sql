BEGIN;

-- A booking receipt is written once, in the same transaction as the appointment
-- and any new contact. A replay returns the existing receipt without firing this trigger.
ALTER TABLE public.field_appointments ADD COLUMN field_recorded_at timestamptz;
CREATE INDEX field_booking_session_request_idx ON public.field_sales_requests
  (workspace_id, ((payload->>'source_session_id')::uuid))
  WHERE action='appointment.book' AND payload ? 'source_session_id';

CREATE FUNCTION public.field_appointment_apply_session(receipt public.field_sales_requests) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  captured timestamptz := (receipt.payload->>'recorded_at')::timestamptz;
  booking public.field_appointments;
  source_id uuid;
BEGIN
  SELECT * INTO STRICT booking FROM public.field_appointments
  WHERE id=(receipt.result->>'id')::uuid AND workspace_id=receipt.workspace_id AND created_by=receipt.actor_id;

  SELECT s.id INTO source_id FROM public.sessions s
  WHERE s.id=(receipt.payload->>'source_session_id')::uuid AND s.workspace_id=booking.workspace_id
    AND s.campaign_id=booking.campaign_id AND booking.campaign_address_id IS NOT NULL
    AND captured BETWEEN s.start_time AND coalesce(s.end_time,now())
    AND captured <= booking.created_at
    AND (s.user_id=receipt.actor_id OR EXISTS (
      SELECT 1 FROM public.session_participants sp WHERE sp.session_id=s.id
        AND sp.campaign_id=s.campaign_id AND sp.user_id=receipt.actor_id
        AND captured BETWEEN sp.joined_at AND coalesce(sp.left_at,now())
    ));

  UPDATE public.field_appointments SET source_session_id=source_id,
    field_recorded_at=CASE WHEN source_id IS NOT NULL THEN captured END
    WHERE id=booking.id;
  IF source_id IS NOT NULL THEN
    IF nullif(trim(receipt.payload->>'new_contact_name'),'') IS NOT NULL THEN
      UPDATE public.contacts SET session_id=source_id
      WHERE id=booking.contact_id AND workspace_id=booking.workspace_id AND session_id IS NULL;
    END IF;
    UPDATE public.field_sales SET source_session_id=source_id
      WHERE field_appointment_id=booking.id AND original_event_id IS NULL
        AND source_session_id IS DISTINCT FROM source_id;
  END IF;
END $$;

CREATE FUNCTION public.field_appointment_link_recorded_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt public.field_sales_requests;
BEGIN
  -- A session start and a booking are independent outbox operations. Whichever
  -- arrives second can link them, including concurrent retries on two connections.
  IF TG_TABLE_NAME='field_sales_requests' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('booking-session:'||(NEW.payload->>'source_session_id')::uuid::text,0));
    PERFORM public.field_appointment_apply_session(NEW);
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('booking-session:'||NEW.id::text,0));
    FOR receipt IN SELECT * FROM public.field_sales_requests r WHERE r.workspace_id=NEW.workspace_id
      AND r.action='appointment.book' AND r.payload ? 'source_session_id'
      AND (r.payload->>'source_session_id')::uuid=NEW.id
    LOOP
      PERFORM public.field_appointment_apply_session(receipt);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.field_appointment_link_recorded_session(),
  public.field_appointment_apply_session(public.field_sales_requests) FROM PUBLIC,anon,authenticated;
CREATE TRIGGER field_appointment_link_recorded_session AFTER INSERT ON public.field_sales_requests
  FOR EACH ROW WHEN (NEW.action='appointment.book' AND NEW.payload ? 'source_session_id')
  EXECUTE FUNCTION public.field_appointment_link_recorded_session();
CREATE TRIGGER field_session_reconcile_bookings AFTER INSERT ON public.sessions
  FOR EACH ROW WHEN (NEW.workspace_id IS NOT NULL AND NEW.campaign_id IS NOT NULL)
  EXECUTE FUNCTION public.field_appointment_link_recorded_session();

CREATE FUNCTION public.field_sales_booking_activity(w uuid,f jsonb,first_day date,last_day date,zone text)
RETURNS TABLE (appointment_id uuid,setter_id uuid,contact_id uuid,campaign_id uuid,booked_at timestamptz,canonical boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH bookings AS (
  SELECT a.id,a.setter_id,a.contact_id,a.campaign_id,coalesce(a.field_recorded_at,a.created_at) AS created_at,true AS canonical
  FROM public.field_appointments a
  WHERE a.workspace_id=w AND a.created_by IS NOT NULL
  UNION ALL
  SELECT a.id,(to_jsonb(a)->>'created_by')::uuid,c.id,c.campaign_id,a.created_at,false
  FROM public.contact_activities a JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=w
  WHERE a.type='meeting' AND NOT EXISTS (
   SELECT 1 FROM public.field_appointment_legacy_links link
   JOIN public.field_appointments canonical ON canonical.workspace_id=w AND canonical.id=link.appointment_id
   WHERE link.workspace_id=w AND link.source_kind='meeting' AND link.source_id=a.id
     AND canonical.created_by IS NOT NULL)
 )
 SELECT b.id,b.setter_id,b.contact_id,b.campaign_id,b.created_at,b.canonical FROM bookings b LEFT JOIN public.campaigns cp ON cp.id=b.campaign_id AND cp.workspace_id=w
 WHERE b.created_at>=first_day::timestamp AT TIME ZONE zone AND b.created_at<last_day::timestamp AT TIME ZONE zone AND b.created_at<=now()
   AND nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL
   AND (nullif(f->>'rep','') IS NULL OR b.setter_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR b.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND (nullif(f->>'team','') IS NULL OR EXISTS (
    SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=b.setter_id
      AND m.team_id=(f->>'team')::uuid AND m.starts_at<=b.created_at AND (m.ends_at IS NULL OR m.ends_at>b.created_at)));
$$;

REVOKE ALL ON FUNCTION public.field_sales_booking_activity(uuid,jsonb,date,date,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.field_sales_appointment_bookings(w uuid,f jsonb,first_day date,last_day date,zone text)
RETURNS TABLE (appointment_id uuid,setter_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT b.appointment_id,b.setter_id FROM public.field_sales_booking_activity(w,f,first_day,last_day,zone) b;
$$;

CREATE OR REPLACE FUNCTION public.field_sales_activity_rows(w uuid,f jsonb,first_day date,last_day date,zone text,p_kind text DEFAULT 'all')
RETURNS TABLE(id uuid,contact_id uuid,rep_id uuid,campaign_id uuid,occurred_at timestamptz,kind text,label text,converted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH contacts AS MATERIALIZED (
  SELECT c.* FROM public.contacts c LEFT JOIN public.campaigns cp ON cp.id=c.campaign_id AND cp.workspace_id=w
  WHERE c.workspace_id=w AND (nullif(f->>'rep','') IS NULL OR c.user_id=(f->>'rep')::uuid)
   AND coalesce(to_jsonb(c)->>'lead_kind','field')='field'
   AND (nullif(f->>'campaign','') IS NULL OR c.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
 ), visits AS (
  SELECT DISTINCT ON(e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text))
   e.id,e.session_id,e.building_id,e.address_id,e.created_at,e.event_type,e.metadata,e.outcome,
   sn.user_id,sn.campaign_id
  FROM public.session_events e JOIN public.sessions sn ON sn.id=e.session_id
  LEFT JOIN public.campaigns cp ON cp.id=sn.campaign_id AND cp.workspace_id=w
  WHERE p_kind IN ('all','doors','conversations') AND sn.workspace_id=w
   AND (nullif(f->>'rep','') IS NULL OR sn.user_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR sn.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND e.created_at>=(first_day::timestamp AT TIME ZONE zone) AND e.created_at<(last_day::timestamp AT TIME ZONE zone) AND e.created_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=sn.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=e.created_at AND (m.ends_at IS NULL OR m.ends_at>e.created_at)))
   AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
  ORDER BY e.session_id,coalesce(e.building_id::text,e.address_id::text,e.id::text),e.created_at DESC,e.id DESC
 ), records AS (
  SELECT v.id,NULL::uuid contact_id,v.user_id rep_id,v.campaign_id,v.created_at occurred_at,k.kind,
   coalesce(nullif(v.metadata->>'address',''),'Field visit') label,false converted
  FROM visits v CROSS JOIN LATERAL (SELECT 'doors'::text kind UNION ALL SELECT 'conversations' WHERE v.event_type='conversation' AND coalesce(v.metadata->>'address_status',v.outcome,'') NOT IN ('no_answer','noAnswer','do_not_knock','doNotKnock')) k
  WHERE v.event_type<>'completion_undone' AND (p_kind='all' OR k.kind=p_kind)
  UNION ALL
  SELECT c.id,c.id,c.user_id,c.campaign_id,c.created_at,'leads',c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.contact_id=c.id AND s.status='verified')
  FROM contacts c WHERE p_kind IN ('all','leads') AND c.created_at>=(first_day::timestamp AT TIME ZONE zone) AND c.created_at<(last_day::timestamp AT TIME ZONE zone) AND c.created_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=c.created_at AND (m.ends_at IS NULL OR m.ends_at>c.created_at)))
  UNION ALL
  SELECT b.appointment_id,b.contact_id,b.setter_id,b.campaign_id,b.booked_at,'appointments',c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.status='verified' AND
     (CASE WHEN b.canonical THEN s.field_appointment_id ELSE s.appointment_id END)=b.appointment_id)
  FROM public.field_sales_booking_activity(w,f,first_day,last_day,zone) b
  JOIN public.contacts c ON c.id=b.contact_id AND c.workspace_id=w
  WHERE p_kind IN ('all','appointments')
  UNION ALL
  SELECT a.id,c.id,c.user_id,c.campaign_id,a.timestamp,'appointments_completed',c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.appointment_id=a.id AND s.status='verified')
  FROM contacts c JOIN public.contact_activities a ON a.contact_id=c.id
  WHERE p_kind IN ('all','appointments_completed') AND a.type='meeting'
   AND coalesce(to_jsonb(a)->>'status','') IN ('completed','attended')
   AND a.timestamp>=(first_day::timestamp AT TIME ZONE zone) AND a.timestamp<(last_day::timestamp AT TIME ZONE zone)
   AND coalesce(to_jsonb(a)->>'status','') NOT IN ('cancelled','canceled')
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=a.timestamp AND (m.ends_at IS NULL OR m.ends_at>a.timestamp)))
  UNION ALL
  SELECT a.id,c.id,k.rep_id,a.campaign_id,k.occurred_at,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.field_appointment_id=a.id AND s.status='verified')
  FROM public.field_appointments a JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=w
  LEFT JOIN public.campaigns cp ON cp.id=a.campaign_id AND cp.workspace_id=w
  CROSS JOIN LATERAL (
    SELECT 'appointments_scheduled'::text AS kind,a.assignee_id AS rep_id,a.start_at AS occurred_at WHERE a.status NOT IN ('cancelled','legacy_unknown')
    UNION ALL SELECT 'appointments_completed',a.assignee_id,a.outcome_at WHERE a.status='held'
    UNION ALL SELECT 'appointments_no_show',a.assignee_id,a.outcome_at WHERE a.status='no_show'
  ) k
  WHERE a.workspace_id=w AND (p_kind='all' OR k.kind=p_kind)
   AND k.occurred_at>=(first_day::timestamp AT TIME ZONE zone) AND k.occurred_at<(last_day::timestamp AT TIME ZONE zone)
   AND (nullif(f->>'rep','') IS NULL OR k.rep_id=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR a.campaign_id=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND (nullif(f->>'team','') IS NULL OR EXISTS(
     SELECT 1 FROM public.field_sales_team_memberships m
     WHERE m.workspace_id=w AND m.user_id=k.rep_id AND m.team_id=(f->>'team')::uuid
       AND m.starts_at<=k.occurred_at AND (m.ends_at IS NULL OR m.ends_at>k.occurred_at)
   ))
  UNION ALL
  SELECT o.id,c.id,CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END,coalesce(o.campaign_id,c.campaign_id),k.occurred_at,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.opportunity_id=o.id AND s.status='verified')
  FROM public.contacts c JOIN public.field_sales_opportunities o ON o.contact_id=c.id AND o.workspace_id=w
  LEFT JOIN public.campaigns cp ON cp.id=coalesce(o.campaign_id,c.campaign_id) AND cp.workspace_id=w
  CROSS JOIN LATERAL (
    SELECT 'opportunities'::text AS kind,o.created_at AS occurred_at
    UNION ALL SELECT 'estimates_sent',o.estimate_sent_at
  ) k
  WHERE c.workspace_id=w AND coalesce(to_jsonb(c)->>'lead_kind','field')='field' AND (p_kind='all' OR k.kind=p_kind)
   AND (nullif(f->>'rep','') IS NULL OR (CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END)=(f->>'rep')::uuid)
   AND (nullif(f->>'campaign','') IS NULL OR coalesce(o.campaign_id,c.campaign_id)=(f->>'campaign')::uuid)
   AND (nullif(f->>'territory','') IS NULL OR to_jsonb(cp)->>'territory_id'=f->>'territory')
   AND k.occurred_at>=(first_day::timestamp AT TIME ZONE zone) AND k.occurred_at<(last_day::timestamp AT TIME ZONE zone) AND k.occurred_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=(CASE WHEN o.legacy_slot THEN c.user_id ELSE o.user_id END) AND m.team_id=(f->>'team')::uuid AND m.starts_at<=k.occurred_at AND (m.ends_at IS NULL OR m.ends_at>k.occurred_at)))
 ) SELECT * FROM records WHERE nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL;
$$;

COMMIT;
