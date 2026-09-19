-- One source-record definition for report counts, conversion cohorts and drilldowns.
BEGIN;
CREATE FUNCTION public.field_sales_activity_rows(w uuid,f jsonb,first_day date,last_day date,zone text,p_kind text DEFAULT 'all')
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
  SELECT a.id,c.id,c.user_id,c.campaign_id,a.timestamp,k.kind,c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.appointment_id=a.id AND s.status='verified')
  FROM contacts c JOIN public.contact_activities a ON a.contact_id=c.id
  CROSS JOIN LATERAL (SELECT 'appointments'::text kind UNION ALL SELECT 'appointments_completed' WHERE a.timestamp<=now() AND coalesce(to_jsonb(a)->>'status','') IN ('completed','attended')) k
  WHERE p_kind IN ('all','appointments','appointments_completed') AND (p_kind='all' OR k.kind=p_kind) AND a.type='meeting'
   AND a.timestamp>=(first_day::timestamp AT TIME ZONE zone) AND a.timestamp<(last_day::timestamp AT TIME ZONE zone)
   AND coalesce(to_jsonb(a)->>'status','') NOT IN ('cancelled','canceled')
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=a.timestamp AND (m.ends_at IS NULL OR m.ends_at>a.timestamp)))
  UNION ALL
  SELECT o.id,c.id,c.user_id,c.campaign_id,o.created_at,'opportunities',c.full_name,
   EXISTS(SELECT 1 FROM public.field_sales s WHERE s.workspace_id=w AND s.opportunity_id=o.id AND s.status='verified')
  FROM contacts c JOIN public.field_sales_opportunities o ON o.contact_id=c.id AND o.workspace_id=w
  WHERE p_kind IN ('all','opportunities') AND o.created_at>=(first_day::timestamp AT TIME ZONE zone) AND o.created_at<(last_day::timestamp AT TIME ZONE zone) AND o.created_at<=now()
   AND (nullif(f->>'team','') IS NULL OR EXISTS(SELECT 1 FROM public.field_sales_team_memberships m WHERE m.workspace_id=w AND m.user_id=c.user_id AND m.team_id=(f->>'team')::uuid AND m.starts_at<=o.created_at AND (m.ends_at IS NULL OR m.ends_at>o.created_at)))
 ) SELECT * FROM records WHERE nullif(f->>'product','') IS NULL AND nullif(f->>'source','') IS NULL AND nullif(f->>'status','') IS NULL;
$$;
REVOKE ALL ON FUNCTION public.field_sales_activity_rows(uuid,jsonb,date,date,text,text) FROM PUBLIC,anon,authenticated;
COMMIT;
