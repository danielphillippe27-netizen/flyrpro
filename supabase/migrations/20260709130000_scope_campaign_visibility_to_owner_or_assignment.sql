BEGIN;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "workspace members can manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_select_campaign_members" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_service_role_all" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_owner_all" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_workspace_managers_all" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_assignees_select" ON public.campaigns;

CREATE POLICY "campaigns_service_role_all"
ON public.campaigns
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "campaigns_owner_all"
ON public.campaigns
FOR ALL
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (
  owner_id = auth.uid()
  AND (
    workspace_id IS NULL
    OR public.is_workspace_member(workspace_id)
  )
);

CREATE POLICY "campaigns_workspace_managers_all"
ON public.campaigns
FOR ALL
TO authenticated
USING (
  workspace_id IS NOT NULL
  AND public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
)
WITH CHECK (
  workspace_id IS NOT NULL
  AND public.has_workspace_role(workspace_id, auth.uid(), ARRAY['owner', 'admin'])
);

CREATE POLICY "campaigns_assignees_select"
ON public.campaigns
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.campaign_assignments ca
    WHERE ca.campaign_id = campaigns.id
      AND ca.assigned_to_user_id = auth.uid()
      AND ca.status <> 'cancelled'
  )
);

COMMIT;
