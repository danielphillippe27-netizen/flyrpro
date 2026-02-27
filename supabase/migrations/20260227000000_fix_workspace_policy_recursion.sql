-- Fix infinite recursion between workspaces/workspace_members RLS policies.
-- Previous policies could recurse:
--   workspaces SELECT -> is_workspace_member(...) -> workspace_members
--   workspace_members SELECT -> is_workspace_member(...) -> workspaces
-- which can trigger 42P17 ("infinite recursion detected in policy").

BEGIN;

-- Workspaces should be readable by owners or explicit members.
DROP POLICY IF EXISTS "workspace_members_can_view_their_workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "workspace_members_can_select" ON public.workspaces;
CREATE POLICY "workspace_members_can_view_their_workspaces"
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (
        owner_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = workspaces.id
              AND wm.user_id = auth.uid()
        )
    );

-- Workspace members table should only expose rows for the current user.
-- Owner visibility of all members should be handled by server-side/admin flows.
DROP POLICY IF EXISTS "workspace_members_can_view_memberships" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_select_own" ON public.workspace_members;
CREATE POLICY "workspace_members_can_view_memberships"
    ON public.workspace_members
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Ensure each workspace owner has an explicit owner membership row.
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT
    w.id,
    w.owner_id,
    'owner'
FROM public.workspaces w
LEFT JOIN public.workspace_members wm
    ON wm.workspace_id = w.id
   AND wm.user_id = w.owner_id
WHERE w.owner_id IS NOT NULL
  AND wm.id IS NULL;

COMMIT;
