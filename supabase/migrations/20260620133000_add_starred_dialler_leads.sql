ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_dialler_leads_workspace_user_starred_created
  ON public.dialler_leads(workspace_id, user_id, is_starred, created_at DESC);
