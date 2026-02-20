-- Backfill workspace + owner membership for any user who has none.
-- Fixes "No workspace found" for users who signed up before the workspace trigger or whose backfill missed.

DO $$
DECLARE
  r record;
  v_workspace_id uuid;
BEGIN
  FOR r IN
    SELECT u.id
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.user_id = u.id
        AND wm.role = 'owner'
    )
  LOOP
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('My Workspace', r.id)
    RETURNING id INTO v_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, r.id, 'owner')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();
  END LOOP;
END $$;
