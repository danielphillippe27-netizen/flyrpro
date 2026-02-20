-- workspace_invites: invite-by-email with token for /join flow.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_invites_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id
  ON public.workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
  ON public.workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_token
  ON public.workspace_invites(token) WHERE status = 'pending';

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- Owners and admins of the workspace can create and view invites for that workspace
DROP POLICY IF EXISTS "workspace_owners_admins_can_manage_invites" ON public.workspace_invites;
CREATE POLICY "workspace_owners_admins_can_manage_invites"
  ON public.workspace_invites
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invites.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role IN ('owner', 'admin')
    )
  );

-- Service role / server can read by token for acceptance (validate + accept flow)
-- We allow any authenticated user to SELECT by token so the accept API can verify token then add member
DROP POLICY IF EXISTS "authenticated_can_read_invite_by_token" ON public.workspace_invites;
CREATE POLICY "authenticated_can_read_invite_by_token"
  ON public.workspace_invites
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Invited user can update their own invite (status -> accepted) when email matches and status is pending
DROP POLICY IF EXISTS "invited_user_can_accept_own_invite" ON public.workspace_invites;
CREATE POLICY "invited_user_can_accept_own_invite"
  ON public.workspace_invites
  FOR UPDATE
  USING (
    status = 'pending'
    AND expires_at > now()
    AND lower(trim(email)) = lower(trim((auth.jwt() ->> 'email')))
  )
  WITH CHECK (status = 'accepted');

COMMENT ON TABLE public.workspace_invites IS 'Pending workspace invites; token used in /join?token=... for acceptance.';

-- When an invite is accepted, add the current user to workspace_members (SECURITY DEFINER so RLS allows insert)
CREATE OR REPLACE FUNCTION public.workspace_invites_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (NEW.workspace_id, auth.uid(), NEW.role)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = NEW.role, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_invites_accept_trigger ON public.workspace_invites;
CREATE TRIGGER workspace_invites_accept_trigger
  AFTER UPDATE ON public.workspace_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.workspace_invites_on_accept();

COMMIT;
