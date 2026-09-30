BEGIN;

-- A live session code enrolls the user in session_participants. Let that
-- enrollment grant campaign map access only while the session is active.
CREATE OR REPLACE FUNCTION public.can_view_campaign(
  p_campaign_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_campaign(p_campaign_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.campaign_assignments ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.assigned_to_user_id = p_user_id
        AND ca.status IN ('accepted', 'in_progress', 'completed')
    )
    OR EXISTS (
      SELECT 1
      FROM public.session_participants sp
      JOIN public.sessions s ON s.id = sp.session_id
      WHERE sp.campaign_id = p_campaign_id
        AND sp.user_id = p_user_id
        AND sp.left_at IS NULL
        AND s.campaign_id = p_campaign_id
        AND s.end_time IS NULL
    );
$$;

-- Live participants need to record outcomes on the homes they share with
-- the host. The grant ends as soon as they leave or the host ends the session.
CREATE OR REPLACE FUNCTION public.can_mutate_campaign_address(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_campaign(p_campaign_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.campaign_assignments ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.assigned_to_user_id = p_user_id
        AND ca.status IN ('accepted', 'in_progress')
        AND (
          ca.mode = 'whole_team'
          OR (
            ca.mode = 'zone_split'
            AND EXISTS (
              SELECT 1
              FROM public.campaign_assignment_homes cah
              WHERE cah.assignment_id = ca.id
                AND cah.campaign_address_id = p_campaign_address_id
            )
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.session_participants sp
      JOIN public.sessions s ON s.id = sp.session_id
      WHERE sp.campaign_id = p_campaign_id
        AND sp.user_id = p_user_id
        AND sp.left_at IS NULL
        AND s.campaign_id = p_campaign_id
        AND s.end_time IS NULL
    );
$$;

COMMIT;
