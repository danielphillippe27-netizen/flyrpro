BEGIN;

-- Remove broad authenticated read access to workspace_invites.
DROP POLICY IF EXISTS "authenticated_can_read_invite_by_token" ON public.workspace_invites;

-- Keep service-role token validation/accept flows working while preventing
-- non-manager authenticated users from querying invite rows directly.
DROP POLICY IF EXISTS "service_role_can_read_invites" ON public.workspace_invites;
CREATE POLICY "service_role_can_read_invites"
  ON public.workspace_invites
  FOR SELECT
  USING (auth.role() = 'service_role');

COMMIT;
