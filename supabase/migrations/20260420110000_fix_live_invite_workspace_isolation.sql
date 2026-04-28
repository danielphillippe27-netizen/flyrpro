BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_members_campaign_id
  ON public.campaign_members(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_members_user_id
  ON public.campaign_members(user_id);

ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_campaign_member(
  p_campaign_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND (
        c.owner_id = p_user_id
        OR (c.workspace_id IS NOT NULL AND public.is_workspace_member(c.workspace_id, p_user_id))
        OR EXISTS (
          SELECT 1
          FROM public.campaign_members cm
          WHERE cm.campaign_id = p_campaign_id
            AND cm.user_id = p_user_id
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_campaign_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "campaign_members_select_member" ON public.campaign_members;
CREATE POLICY "campaign_members_select_member"
  ON public.campaign_members
  FOR SELECT
  TO authenticated
  USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "campaign_members_insert_owner" ON public.campaign_members;
CREATE POLICY "campaign_members_insert_owner"
  ON public.campaign_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_members.campaign_id
        AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "campaign_members_update_owner" ON public.campaign_members;
CREATE POLICY "campaign_members_update_owner"
  ON public.campaign_members
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_members.campaign_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_members.campaign_id
        AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "campaign_members_delete_owner" ON public.campaign_members;
CREATE POLICY "campaign_members_delete_owner"
  ON public.campaign_members
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      WHERE c.id = campaign_members.campaign_id
        AND c.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_members TO authenticated;
GRANT ALL ON public.campaign_members TO service_role;

INSERT INTO public.campaign_members (campaign_id, user_id, role)
SELECT c.id, c.owner_id, 'owner'
FROM public.campaigns c
JOIN auth.users au
  ON au.id = c.owner_id
ON CONFLICT (campaign_id, user_id) DO UPDATE
SET role = 'owner';

INSERT INTO public.campaign_members (campaign_id, user_id, role)
SELECT
  c.id,
  wm.user_id,
  CASE
    WHEN wm.role = 'owner' THEN 'owner'
    WHEN wm.role = 'admin' THEN 'admin'
    ELSE 'member'
  END
FROM public.campaigns c
JOIN public.workspace_members wm
  ON wm.workspace_id = c.workspace_id
JOIN auth.users au
  ON au.id = wm.user_id
WHERE c.workspace_id IS NOT NULL
ON CONFLICT (campaign_id, user_id) DO UPDATE
SET role = CASE
  WHEN public.campaign_members.role = 'owner' THEN public.campaign_members.role
  ELSE EXCLUDED.role
END;

CREATE OR REPLACE FUNCTION public.sync_campaign_members_from_campaign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM auth.users au
       WHERE au.id = NEW.owner_id
     ) THEN
    INSERT INTO public.campaign_members (campaign_id, user_id, role)
    VALUES (NEW.id, NEW.owner_id, 'owner')
    ON CONFLICT (campaign_id, user_id) DO UPDATE
    SET role = 'owner';
  END IF;

  IF NEW.workspace_id IS NOT NULL THEN
    INSERT INTO public.campaign_members (campaign_id, user_id, role)
    SELECT
      NEW.id,
      wm.user_id,
      CASE
        WHEN wm.role = 'owner' THEN 'owner'
        WHEN wm.role = 'admin' THEN 'admin'
        ELSE 'member'
      END
    FROM public.workspace_members wm
    JOIN auth.users au
      ON au.id = wm.user_id
    WHERE wm.workspace_id = NEW.workspace_id
    ON CONFLICT (campaign_id, user_id) DO UPDATE
    SET role = CASE
      WHEN public.campaign_members.role = 'owner' THEN public.campaign_members.role
      ELSE EXCLUDED.role
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_campaign_members_from_campaign ON public.campaigns;
CREATE TRIGGER sync_campaign_members_from_campaign
  AFTER INSERT ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_campaign_members_from_campaign();

CREATE OR REPLACE FUNCTION public.sync_campaign_members_from_workspace_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = NEW.user_id
  ) THEN
    INSERT INTO public.campaign_members (campaign_id, user_id, role)
    SELECT
      c.id,
      NEW.user_id,
      CASE
        WHEN NEW.role = 'owner' THEN 'owner'
        WHEN NEW.role = 'admin' THEN 'admin'
        ELSE 'member'
      END
    FROM public.campaigns c
    WHERE c.workspace_id = NEW.workspace_id
    ON CONFLICT (campaign_id, user_id) DO UPDATE
    SET role = CASE
      WHEN public.campaign_members.role = 'owner' THEN public.campaign_members.role
      ELSE EXCLUDED.role
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_campaign_members_from_workspace_member ON public.workspace_members;
CREATE TRIGGER sync_campaign_members_from_workspace_member
  AFTER INSERT ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_campaign_members_from_workspace_member();

DROP POLICY IF EXISTS "campaigns_select_campaign_members" ON public.campaigns;
CREATE POLICY "campaigns_select_campaign_members"
  ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (public.is_campaign_member(id));

DROP POLICY IF EXISTS "sessions_select_campaign_members" ON public.sessions;
CREATE POLICY "sessions_select_campaign_members"
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (campaign_id IS NOT NULL AND public.is_campaign_member(campaign_id))
    OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  );

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS access_scope text;

UPDATE public.workspace_invites
SET access_scope = CASE
  WHEN campaign_id IS NOT NULL OR session_id IS NOT NULL THEN 'campaign'
  ELSE 'workspace'
END
WHERE access_scope IS NULL;

ALTER TABLE public.workspace_invites
  ALTER COLUMN access_scope SET DEFAULT 'workspace';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invites_access_scope_check'
      AND conrelid = 'public.workspace_invites'::regclass
  ) THEN
    ALTER TABLE public.workspace_invites
      DROP CONSTRAINT workspace_invites_access_scope_check;
  END IF;
END $$;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_access_scope_check
  CHECK (access_scope IN ('workspace', 'campaign'));

COMMENT ON COLUMN public.workspace_invites.access_scope IS
  'workspace grants workspace membership; campaign grants campaign/session access only.';

CREATE OR REPLACE FUNCTION public.workspace_invites_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepted_user_id uuid;
  resolved_access_scope text;
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    accepted_user_id := COALESCE(NEW.accepted_by_user_id, auth.uid());
    resolved_access_scope := COALESCE(
      NEW.access_scope,
      CASE
        WHEN NEW.campaign_id IS NOT NULL OR NEW.session_id IS NOT NULL THEN 'campaign'
        ELSE 'workspace'
      END
    );

    IF accepted_user_id IS NULL THEN
      RAISE EXCEPTION 'workspace invite acceptance requires accepted_by_user_id or auth.uid()';
    END IF;

    IF resolved_access_scope = 'workspace' THEN
      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (NEW.workspace_id, accepted_user_id, NEW.role)
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET role = NEW.role, updated_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
