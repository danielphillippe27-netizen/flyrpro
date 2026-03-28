BEGIN;

ALTER TABLE IF EXISTS public.sessions
  ADD COLUMN IF NOT EXISTS leads_created integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sessions.leads_created IS
  'Per-session lead count captured from mobile/web session completion.';

CREATE INDEX IF NOT EXISTS idx_sessions_workspace_leads_created
  ON public.sessions(workspace_id, leads_created);

COMMIT;
