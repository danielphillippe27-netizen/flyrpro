BEGIN;

-- Teammates are included at every plan level. Workspace monetization is based
-- on campaign and feature entitlements, not membership count.
DROP TRIGGER IF EXISTS workspace_members_paid_seat_capacity_trigger
  ON public.workspace_members;
DROP TRIGGER IF EXISTS workspace_invites_paid_seat_capacity_trigger
  ON public.workspace_invites;

DROP FUNCTION IF EXISTS public.enforce_workspace_members_paid_seat_capacity();
DROP FUNCTION IF EXISTS public.enforce_workspace_invites_paid_seat_capacity();
DROP FUNCTION IF EXISTS public.assert_workspace_paid_seat_capacity(uuid);

COMMIT;
