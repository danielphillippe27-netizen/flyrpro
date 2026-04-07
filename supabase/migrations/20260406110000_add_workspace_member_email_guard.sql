BEGIN;

CREATE OR REPLACE FUNCTION public.workspace_has_member_email(
  p_workspace_id uuid,
  p_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    INNER JOIN auth.users u
      ON u.id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
      AND lower(trim(u.email)) = lower(trim(p_email))
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_has_member_email(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_has_member_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public.workspace_has_member_email(uuid, text) IS
  'Returns true when the provided email already belongs to a member in the workspace.';

COMMIT;
