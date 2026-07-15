BEGIN;

-- An accepted assignment is still active and must prevent a second active
-- assignment for the same campaign/member pair.
DROP INDEX IF EXISTS public.idx_campaign_assignments_one_active_member;
CREATE UNIQUE INDEX idx_campaign_assignments_one_active_member
  ON public.campaign_assignments(campaign_id, assigned_to_user_id)
  WHERE status IN ('assigned', 'accepted', 'in_progress');

DROP POLICY IF EXISTS "campaigns_assignees_select" ON public.campaigns;
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
      AND ca.status IN ('accepted', 'in_progress')
  )
);

COMMIT;
