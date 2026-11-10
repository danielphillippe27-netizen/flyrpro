-- Run with psql -v roofing_workspace='<workspace UUID>' -f <this file>.
-- Contains UUIDs and timestamps only. Review candidates before any backfill.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

WITH sources AS (
  SELECT 'contact' AS source, c.id AS source_id, c.id AS contact_id, c.appointment_at AS starts
  FROM public.contacts c
  WHERE c.workspace_id=:'roofing_workspace'::uuid AND c.appointment_at IS NOT NULL
  UNION ALL
  SELECT 'meeting',a.id,a.contact_id,a.timestamp
  FROM public.contact_activities a
  JOIN public.contacts c ON c.id=a.contact_id AND c.workspace_id=:'roofing_workspace'::uuid
  WHERE a.type='meeting' AND a.timestamp IS NOT NULL
  UNION ALL
  SELECT 'calendar',e.id,e.contact_id,e.start_at
  FROM public.calendar_events e
  JOIN public.contacts c ON c.id=e.contact_id AND c.workspace_id=:'roofing_workspace'::uuid
  WHERE e.event_type='appointment' AND e.deleted_at IS NULL
    AND (e.workspace_id IS NULL OR e.workspace_id=c.workspace_id)
), reviewed AS (
  SELECT s.* FROM sources s WHERE NOT EXISTS (
    SELECT 1 FROM public.field_appointment_legacy_links l
    WHERE l.workspace_id=:'roofing_workspace'::uuid AND l.source_kind=s.source AND l.source_id=s.source_id
  )
)
SELECT contact_id,starts,
  CASE WHEN count(DISTINCT source)>1 AND count(*)=count(DISTINCT source) THEN 'review_exact_match'
       WHEN count(*)>count(DISTINCT source) THEN 'ambiguous'
       ELSE 'legacy_only' END AS disposition,
  jsonb_object_agg(source||':'||source_id::text,source_id ORDER BY source,source_id) AS evidence
FROM reviewed
GROUP BY contact_id,starts
ORDER BY starts,contact_id;

COMMIT;
