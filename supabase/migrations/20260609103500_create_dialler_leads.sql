CREATE TABLE IF NOT EXISTS public.dialler_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  company text,
  email text,
  follow_up_name text,
  follow_up_at timestamptz,
  disposition text CHECK (
    disposition IS NULL OR disposition IN ('interested', 'callback', 'not_now', 'dnc')
  ),
  notes text,
  called_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dialler_leads_workspace_created_idx
  ON public.dialler_leads(workspace_id, created_at);

CREATE OR REPLACE FUNCTION public.set_dialler_leads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_dialler_leads_updated_at ON public.dialler_leads;
CREATE TRIGGER set_dialler_leads_updated_at
BEFORE UPDATE ON public.dialler_leads
FOR EACH ROW
EXECUTE FUNCTION public.set_dialler_leads_updated_at();

ALTER TABLE public.dialler_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialler_leads_workspace_members_select ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_select
ON public.dialler_leads
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialler_leads_workspace_members_insert ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_insert
ON public.dialler_leads
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialler_leads_workspace_members_update ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_update
ON public.dialler_leads
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);
