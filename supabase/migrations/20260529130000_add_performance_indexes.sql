-- Performance indexes for dashboard, activity, and leads queries.
-- All additions only — no existing indexes modified or dropped.

-- sessions: weekly dashboard query (workspace + user + time range)
-- Better than existing (workspace_id, start_time DESC, user_id) for
-- equality filters on workspace_id and user_id before range on start_time
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_workspace_user_start
  ON public.sessions (workspace_id, user_id, start_time DESC);

-- sessions: lifetime fallback (user + completed only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_completed
  ON public.sessions (user_id, doors_hit, conversations)
  WHERE end_time IS NOT NULL;

-- contacts: weekly metrics query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_workspace_user_created
  ON public.contacts (workspace_id, user_id, created_at DESC);

-- crm_events: weekly appointments query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_events_user_created_appt
  ON public.crm_events (user_id, created_at DESC)
  WHERE fub_appointment_id IS NOT NULL;

-- scan_events: weekly count by campaign
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_events_campaign_scanned
  ON public.scan_events (campaign_id, scanned_at DESC);

-- campaigns: recent list per workspace
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaigns_workspace_created
  ON public.campaigns (workspace_id, created_at DESC);

-- Note: session_events composite index skipped because schema.current.sql
-- does not show workspace_id or event_time columns — those may exist in
-- production but we cannot verify safely from the schema export.
