-- Phase 1: Move from single-user ownership to workspace ownership.
-- This migration is idempotent and designed for Supabase SQL Editor.
-- Keeps legacy user_id / owner_id columns for audit semantics.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) New tenancy tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id
  ON public.workspaces(owner_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id
  ON public.workspace_members(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON public.workspace_members(user_id);

-- ---------------------------------------------------------------------------
-- 2) RLS helper functions (performance-aware)
-- ---------------------------------------------------------------------------
-- Notes:
-- - SECURITY DEFINER + STABLE + search_path hardening.
-- - current_user_workspace_ids() is no-arg and statement-stable, so it can be
--   cached once per statement and reused by per-row RLS predicates.

CREATE OR REPLACE FUNCTION public.current_user_workspace_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(wm.workspace_id), '{}'::uuid[])
  FROM public.workspace_members wm
  WHERE wm.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ws_id = ANY(public.current_user_workspace_ids())
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
  )
$$;

CREATE OR REPLACE FUNCTION public.primary_workspace_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wm.workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = p_user_id
  ORDER BY
    CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    wm.created_at ASC
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 3) Baseline RLS for workspace tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_members_can_view_their_workspaces" ON public.workspaces;
CREATE POLICY "workspace_members_can_view_their_workspaces"
ON public.workspaces
FOR SELECT
USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "workspace_owners_can_update_workspaces" ON public.workspaces;
CREATE POLICY "workspace_owners_can_update_workspaces"
ON public.workspaces
FOR UPDATE
USING (public.is_workspace_owner(id))
WITH CHECK (public.is_workspace_owner(id));

DROP POLICY IF EXISTS "workspace_members_can_view_memberships" ON public.workspace_members;
CREATE POLICY "workspace_members_can_view_memberships"
ON public.workspace_members
FOR SELECT
USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_owners_can_insert_memberships" ON public.workspace_members;
CREATE POLICY "workspace_owners_can_insert_memberships"
ON public.workspace_members
FOR INSERT
WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "workspace_owners_can_update_memberships" ON public.workspace_members;
CREATE POLICY "workspace_owners_can_update_memberships"
ON public.workspace_members
FOR UPDATE
USING (public.is_workspace_owner(workspace_id))
WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "workspace_owners_can_delete_memberships" ON public.workspace_members;
CREATE POLICY "workspace_owners_can_delete_memberships"
ON public.workspace_members
FOR DELETE
USING (public.is_workspace_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- 4) Replace signup trigger (preserve user_profile creation)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  -- Preserve existing profile creation behavior.
  INSERT INTO public.user_profiles (user_id, weekly_door_goal)
  VALUES (NEW.id, 100)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT wm.workspace_id
  INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = NEW.id
  ORDER BY
    CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    wm.created_at ASC
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('My Workspace', NEW.id)
    RETURNING id INTO v_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, NEW.id, 'owner')
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET role = 'owner', updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5) Backfill all existing users with workspace + owner membership
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_workspace_id uuid;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    INSERT INTO public.user_profiles (user_id, weekly_door_goal)
    VALUES (r.id, 100)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT wm.workspace_id
    INTO v_workspace_id
    FROM public.workspace_members wm
    WHERE wm.user_id = r.id
    ORDER BY
      CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      wm.created_at ASC
    LIMIT 1;

    IF v_workspace_id IS NULL THEN
      INSERT INTO public.workspaces (name, owner_id)
      VALUES ('My Workspace', r.id)
      RETURNING id INTO v_workspace_id;

      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (v_workspace_id, r.id, 'owner')
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET role = 'owner', updated_at = now();
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Add workspace_id to core content tables and backfill
-- ---------------------------------------------------------------------------

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

ALTER TABLE public.crm_connections
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaigns_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_workspace_id_fkey
      FOREIGN KEY (workspace_id)
      REFERENCES public.workspaces(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_connections_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.crm_connections
      ADD CONSTRAINT crm_connections_workspace_id_fkey
      FOREIGN KEY (workspace_id)
      REFERENCES public.workspaces(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'buildings_workspace_id_fkey'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_workspace_id_fkey
      FOREIGN KEY (workspace_id)
      REFERENCES public.workspaces(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id
  ON public.campaigns(workspace_id);

CREATE INDEX IF NOT EXISTS idx_crm_connections_workspace_id
  ON public.crm_connections(workspace_id);

CREATE INDEX IF NOT EXISTS idx_buildings_workspace_id
  ON public.buildings(workspace_id);

-- campaigns: prefer owner_id, fallback to user_id when present.
UPDATE public.campaigns c
SET workspace_id = public.primary_workspace_id(c.owner_id)
WHERE c.workspace_id IS NULL
  AND c.owner_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.campaigns c
    SET workspace_id = public.primary_workspace_id(c.user_id)
    WHERE c.workspace_id IS NULL
      AND c.user_id IS NOT NULL;
  END IF;
END $$;

-- crm_connections: map by user_id.
UPDATE public.crm_connections cc
SET workspace_id = public.primary_workspace_id(cc.user_id)
WHERE cc.workspace_id IS NULL
  AND cc.user_id IS NOT NULL;

-- buildings: map through campaign parent first.
UPDATE public.buildings b
SET workspace_id = c.workspace_id
FROM public.campaigns c
WHERE b.workspace_id IS NULL
  AND b.campaign_id = c.id
  AND c.workspace_id IS NOT NULL;

-- Optional fallback: buildings.user_id if that column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'buildings'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.buildings b
    SET workspace_id = public.primary_workspace_id(b.user_id)
    WHERE b.workspace_id IS NULL
      AND b.user_id IS NOT NULL;
  END IF;
END $$;

-- Enforce NOT NULL only after successful backfill.
DO $$
DECLARE
  v_campaigns_null bigint;
  v_crm_null bigint;
  v_buildings_null bigint;
BEGIN
  SELECT COUNT(*) INTO v_campaigns_null
  FROM public.campaigns
  WHERE workspace_id IS NULL;

  SELECT COUNT(*) INTO v_crm_null
  FROM public.crm_connections
  WHERE workspace_id IS NULL;

  SELECT COUNT(*) INTO v_buildings_null
  FROM public.buildings
  WHERE workspace_id IS NULL;

  IF v_campaigns_null > 0 THEN
    RAISE EXCEPTION 'campaigns.workspace_id backfill incomplete: % NULL rows', v_campaigns_null;
  END IF;

  IF v_crm_null > 0 THEN
    RAISE EXCEPTION 'crm_connections.workspace_id backfill incomplete: % NULL rows', v_crm_null;
  END IF;

  IF v_buildings_null > 0 THEN
    RAISE EXCEPTION 'buildings.workspace_id backfill incomplete: % NULL rows', v_buildings_null;
  END IF;

  ALTER TABLE public.campaigns
    ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.crm_connections
    ALTER COLUMN workspace_id SET NOT NULL;
  ALTER TABLE public.buildings
    ALTER COLUMN workspace_id SET NOT NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 7) RLS policy updates for migrated core tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "workspace members can manage campaigns" ON public.campaigns;
CREATE POLICY "workspace members can manage campaigns"
ON public.campaigns
FOR ALL
USING (public.is_workspace_member(workspace_id))
WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "own crm_connections" ON public.crm_connections;
DROP POLICY IF EXISTS "workspace members can manage crm_connections" ON public.crm_connections;
CREATE POLICY "workspace members can manage crm_connections"
ON public.crm_connections
FOR ALL
USING (public.is_workspace_member(workspace_id))
WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Authenticated users can view buildings" ON public.buildings;
DROP POLICY IF EXISTS "Users can view buildings for their campaigns" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can insert buildings" ON public.buildings;
DROP POLICY IF EXISTS "Users can insert buildings for their campaigns" ON public.buildings;
DROP POLICY IF EXISTS "Authenticated users can update buildings" ON public.buildings;
DROP POLICY IF EXISTS "Users can update buildings for their campaigns" ON public.buildings;
DROP POLICY IF EXISTS "workspace members can manage buildings" ON public.buildings;
CREATE POLICY "workspace members can manage buildings"
ON public.buildings
FOR ALL
USING (public.is_workspace_member(workspace_id))
WITH CHECK (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- 8) RLS templates for remaining tables
-- ---------------------------------------------------------------------------

-- Template A: table has workspace_id directly.
-- DROP POLICY IF EXISTS "<old_policy_name>" ON public.<table_name>;
-- CREATE POLICY "<table_name>_workspace_members_all"
-- ON public.<table_name>
-- FOR ALL
-- USING (public.is_workspace_member(workspace_id))
-- WITH CHECK (public.is_workspace_member(workspace_id));

-- Template B: child table gated through campaigns.workspace_id.
-- DROP POLICY IF EXISTS "<old_policy_name>" ON public.<child_table>;
-- CREATE POLICY "<child_table>_workspace_members_all"
-- ON public.<child_table>
-- FOR ALL
-- USING (
--   EXISTS (
--     SELECT 1
--     FROM public.campaigns c
--     WHERE c.id = <child_table>.campaign_id
--       AND public.is_workspace_member(c.workspace_id)
--   )
-- )
-- WITH CHECK (
--   EXISTS (
--     SELECT 1
--     FROM public.campaigns c
--     WHERE c.id = <child_table>.campaign_id
--       AND public.is_workspace_member(c.workspace_id)
--   )
-- );

COMMIT;
