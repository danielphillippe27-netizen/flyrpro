BEGIN;

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.workspace_invites.accepted_by_user_id IS
  'User who accepted the invite. Allows idempotent acceptance from service-role routes.';

CREATE OR REPLACE FUNCTION public.workspace_invites_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepted_user_id uuid;
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    accepted_user_id := COALESCE(NEW.accepted_by_user_id, auth.uid());

    IF accepted_user_id IS NULL THEN
      RAISE EXCEPTION 'workspace invite acceptance requires accepted_by_user_id or auth.uid()';
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (NEW.workspace_id, accepted_user_id, NEW.role)
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = NEW.role, updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
