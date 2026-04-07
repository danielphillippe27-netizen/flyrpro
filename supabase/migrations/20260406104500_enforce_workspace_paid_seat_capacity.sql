BEGIN;

CREATE OR REPLACE FUNCTION public.assert_workspace_paid_seat_capacity(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_seats integer;
  v_active_paid_members integer;
  v_pending_paid_invites integer;
BEGIN
  SELECT GREATEST(COALESCE(w.max_seats, 1), 1)
  INTO v_max_seats
  FROM public.workspaces w
  WHERE w.id = p_workspace_id
  FOR UPDATE;

  IF v_max_seats IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_paid_members
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.role <> 'admin';

  SELECT COUNT(*)
  INTO v_pending_paid_invites
  FROM public.workspace_invites wi
  WHERE wi.workspace_id = p_workspace_id
    AND wi.status = 'pending'
    AND wi.role <> 'admin'
    AND wi.expires_at > now();

  IF (v_active_paid_members + v_pending_paid_invites) >= v_max_seats THEN
    RAISE EXCEPTION 'workspace paid seat limit reached'
      USING ERRCODE = 'P0001',
            DETAIL = format(
              'workspace_id=%s, max_seats=%s, active_paid_members=%s, pending_paid_invites=%s',
              p_workspace_id,
              v_max_seats,
              v_active_paid_members,
              v_pending_paid_invites
            ),
            HINT = 'Increase max_seats before adding another paid member or pending member invite.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_workspace_members_paid_seat_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'admin' THEN
      PERFORM public.assert_workspace_paid_seat_capacity(NEW.workspace_id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.role <> 'admin' AND (
      OLD.role = 'admin'
      OR OLD.workspace_id <> NEW.workspace_id
    ) THEN
      PERFORM public.assert_workspace_paid_seat_capacity(NEW.workspace_id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_members_paid_seat_capacity_trigger ON public.workspace_members;
CREATE TRIGGER workspace_members_paid_seat_capacity_trigger
  BEFORE INSERT OR UPDATE OF role, workspace_id
  ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_members_paid_seat_capacity();

CREATE OR REPLACE FUNCTION public.enforce_workspace_invites_paid_seat_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_consumes boolean;
  old_consumes boolean;
BEGIN
  new_consumes :=
    NEW.status = 'pending'
    AND NEW.role <> 'admin'
    AND NEW.expires_at > now();

  IF TG_OP = 'INSERT' THEN
    IF new_consumes THEN
      PERFORM public.assert_workspace_paid_seat_capacity(NEW.workspace_id);
    END IF;
    RETURN NEW;
  END IF;

  old_consumes :=
    OLD.status = 'pending'
    AND OLD.role <> 'admin'
    AND OLD.expires_at > now();

  IF new_consumes THEN
    IF NOT old_consumes OR OLD.workspace_id <> NEW.workspace_id THEN
      PERFORM public.assert_workspace_paid_seat_capacity(NEW.workspace_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_invites_paid_seat_capacity_trigger ON public.workspace_invites;
CREATE TRIGGER workspace_invites_paid_seat_capacity_trigger
  BEFORE INSERT OR UPDATE OF status, role, expires_at, workspace_id
  ON public.workspace_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_workspace_invites_paid_seat_capacity();

COMMIT;
