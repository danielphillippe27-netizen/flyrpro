BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS current_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_current_workspace_id
  ON public.user_profiles(current_workspace_id);

COMMENT ON COLUMN public.user_profiles.current_workspace_id IS 'The workspace the user last selected in the app. Used to override implicit owner-first workspace selection.';

COMMIT;
