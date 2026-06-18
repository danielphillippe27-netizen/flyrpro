ALTER TABLE public.dialer_session_leads
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.dialer_calls
  ALTER COLUMN contact_id DROP NOT NULL;

DROP INDEX IF EXISTS public.idx_dialer_calls_workspace_contact_created;
CREATE INDEX IF NOT EXISTS idx_dialer_calls_workspace_contact_created
  ON public.dialer_calls(workspace_id, contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;
