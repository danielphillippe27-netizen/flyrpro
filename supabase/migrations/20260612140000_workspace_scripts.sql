BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(trim(name)) > 0 AND char_length(name) <= 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_scripts_workspace_updated
  ON public.workspace_scripts(workspace_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_scripts_workspace_name_unique
  ON public.workspace_scripts(workspace_id, lower(name));

CREATE OR REPLACE FUNCTION public.workspace_scripts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_scripts_set_updated_at ON public.workspace_scripts;
CREATE TRIGGER workspace_scripts_set_updated_at
BEFORE UPDATE ON public.workspace_scripts
FOR EACH ROW
EXECUTE FUNCTION public.workspace_scripts_set_updated_at();

ALTER TABLE public.workspace_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_members_can_view_scripts" ON public.workspace_scripts;
CREATE POLICY "workspace_members_can_view_scripts"
ON public.workspace_scripts
FOR SELECT
USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_members_can_create_scripts" ON public.workspace_scripts;
CREATE POLICY "workspace_members_can_create_scripts"
ON public.workspace_scripts
FOR INSERT
WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_members_can_update_scripts" ON public.workspace_scripts;
CREATE POLICY "workspace_members_can_update_scripts"
ON public.workspace_scripts
FOR UPDATE
USING (public.is_workspace_member(workspace_id))
WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_members_can_delete_scripts" ON public.workspace_scripts;
CREATE POLICY "workspace_members_can_delete_scripts"
ON public.workspace_scripts
FOR DELETE
USING (public.is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_scripts TO authenticated;

COMMENT ON TABLE public.workspace_scripts IS 'Workspace-scoped calling and sales scripts.';

COMMIT;
