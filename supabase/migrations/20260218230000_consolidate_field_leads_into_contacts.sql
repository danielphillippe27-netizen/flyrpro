-- Phase 1.1b: Consolidate lead tables into public.contacts.
-- Handles environments that still have public.field_leads and/or missing public.campaign_contacts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Make contacts workspace-aware (if contacts table exists)
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS workspace_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contacts'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'contacts_workspace_id_fkey'
    ) THEN
      ALTER TABLE public.contacts
        ADD CONSTRAINT contacts_workspace_id_fkey
        FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id)
        ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id
  ON public.contacts(workspace_id);

-- Backfill contacts.workspace_id from campaign first, then user ownership fallback.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contacts'
  ) THEN
    UPDATE public.contacts ct
    SET workspace_id = c.workspace_id
    FROM public.campaigns c
    WHERE ct.workspace_id IS NULL
      AND ct.campaign_id = c.id
      AND c.workspace_id IS NOT NULL;

    UPDATE public.contacts ct
    SET workspace_id = public.primary_workspace_id(ct.user_id)
    WHERE ct.workspace_id IS NULL
      AND ct.user_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contacts'
  ) THEN
    DROP POLICY IF EXISTS "workspace members can manage contacts" ON public.contacts;
    DROP POLICY IF EXISTS "own contacts" ON public.contacts;

    CREATE POLICY "workspace members can manage contacts"
    ON public.contacts
    FOR ALL
    USING (
      (contacts.workspace_id IS NOT NULL AND public.is_workspace_member(contacts.workspace_id))
      OR (contacts.workspace_id IS NULL AND contacts.user_id = auth.uid())
    )
    WITH CHECK (
      (contacts.workspace_id IS NOT NULL AND public.is_workspace_member(contacts.workspace_id))
      OR (contacts.workspace_id IS NULL AND contacts.user_id = auth.uid())
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Copy legacy field_leads data into contacts (best-effort)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  has_fl_user_id boolean;
  has_fl_full_name boolean;
  has_fl_name boolean;
  has_fl_phone boolean;
  has_fl_email boolean;
  has_fl_address boolean;
  has_fl_campaign_id boolean;
  has_fl_status boolean;
  has_fl_notes boolean;
  has_fl_created_at boolean;
  has_fl_updated_at boolean;
  has_fl_workspace_id boolean;
  expr_user_id text;
  expr_full_name text;
  expr_phone text;
  expr_email text;
  expr_address text;
  expr_campaign_id text;
  expr_status text;
  expr_notes text;
  expr_created_at text;
  expr_updated_at text;
  expr_workspace_id text;
  sql_insert text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contacts'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'field_leads'
  ) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'user_id'
  ) INTO has_fl_user_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'full_name'
  ) INTO has_fl_full_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'name'
  ) INTO has_fl_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'phone'
  ) INTO has_fl_phone;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'email'
  ) INTO has_fl_email;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'address'
  ) INTO has_fl_address;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'campaign_id'
  ) INTO has_fl_campaign_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'status'
  ) INTO has_fl_status;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'notes'
  ) INTO has_fl_notes;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'created_at'
  ) INTO has_fl_created_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'updated_at'
  ) INTO has_fl_updated_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'field_leads' AND column_name = 'workspace_id'
  ) INTO has_fl_workspace_id;

  IF NOT has_fl_user_id THEN
    RAISE NOTICE 'Skipping field_leads -> contacts copy: field_leads.user_id not found.';
    RETURN;
  END IF;

  expr_user_id := 'fl.user_id';
  expr_full_name := CASE
    WHEN has_fl_full_name THEN 'COALESCE(NULLIF(fl.full_name, ''''), ''Lead'')'
    WHEN has_fl_name THEN 'COALESCE(NULLIF(fl.name, ''''), ''Lead'')'
    ELSE '''Lead'''
  END;
  expr_phone := CASE WHEN has_fl_phone THEN 'fl.phone' ELSE 'NULL::text' END;
  expr_email := CASE WHEN has_fl_email THEN 'fl.email' ELSE 'NULL::text' END;
  expr_address := CASE WHEN has_fl_address THEN 'COALESCE(fl.address, '''')' ELSE '''''' END;
  expr_campaign_id := CASE WHEN has_fl_campaign_id THEN 'fl.campaign_id' ELSE 'NULL::uuid' END;
  expr_status := CASE
    WHEN has_fl_status THEN
      'CASE
         WHEN fl.status IS NULL OR btrim(fl.status) = '''' THEN ''new''
         WHEN lower(btrim(fl.status)) IN (''new'', ''hot'', ''warm'', ''cold'') THEN lower(btrim(fl.status))
         WHEN lower(btrim(fl.status)) IN (''interested'', ''appointment'', ''talked'', ''converted'') THEN ''hot''
         WHEN lower(btrim(fl.status)) IN (''delivered'', ''contacted'', ''follow_up'', ''follow-up'') THEN ''warm''
         WHEN lower(btrim(fl.status)) IN (''not_interested'', ''uninterested'', ''dnc'', ''do_not_knock'', ''do-not-knock'') THEN ''cold''
         ELSE ''new''
       END'
    ELSE '''new'''
  END;
  expr_notes := CASE WHEN has_fl_notes THEN 'fl.notes' ELSE 'NULL::text' END;
  expr_created_at := CASE WHEN has_fl_created_at THEN 'fl.created_at' ELSE 'now()' END;
  expr_updated_at := CASE WHEN has_fl_updated_at THEN 'fl.updated_at' ELSE 'now()' END;
  expr_workspace_id := CASE
    WHEN has_fl_workspace_id THEN 'COALESCE(fl.workspace_id, public.primary_workspace_id(fl.user_id))'
    ELSE 'public.primary_workspace_id(fl.user_id)'
  END;

  sql_insert := format($fmt$
    INSERT INTO public.contacts (
      user_id, full_name, phone, email, address, campaign_id, status, notes, created_at, updated_at, workspace_id
    )
    SELECT
      %1$s AS user_id,
      %2$s AS full_name,
      %3$s AS phone,
      %4$s AS email,
      %5$s AS address,
      %6$s AS campaign_id,
      %7$s AS status,
      %8$s AS notes,
      %9$s AS created_at,
      %10$s AS updated_at,
      %11$s AS workspace_id
    FROM public.field_leads fl
    WHERE fl.user_id IS NOT NULL
    ON CONFLICT DO NOTHING
  $fmt$,
    expr_user_id,
    expr_full_name,
    expr_phone,
    expr_email,
    expr_address,
    expr_campaign_id,
    expr_status,
    expr_notes,
    expr_created_at,
    expr_updated_at,
    expr_workspace_id
  );

  EXECUTE sql_insert;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Compatibility layer: expose campaign_contacts view from contacts
-- ---------------------------------------------------------------------------
-- This keeps existing app code working while storage is consolidated in contacts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contacts'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'campaign_contacts'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'campaign_contacts'
  ) THEN
    EXECUTE $sql$
      CREATE VIEW public.campaign_contacts AS
      SELECT
        c.id,
        c.campaign_id,
        c.address_id,
        c.full_name AS name,
        c.phone,
        c.email,
        c.address,
        c.last_contacted AS last_contacted_at,
        c.status AS interest_level,
        c.created_at,
        c.updated_at
      FROM public.contacts c
      WHERE c.campaign_id IS NOT NULL
    $sql$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.campaign_contacts_view_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contacts (
      id,
      user_id,
      campaign_id,
      address_id,
      full_name,
      phone,
      email,
      address,
      last_contacted,
      status,
      created_at,
      updated_at,
      workspace_id
    )
    VALUES (
      COALESCE(NEW.id, gen_random_uuid()),
      auth.uid(),
      NEW.campaign_id,
      NEW.address_id,
      COALESCE(NEW.name, 'Lead'),
      NEW.phone,
      NEW.email,
      COALESCE(NEW.address, ''),
      NEW.last_contacted_at,
      COALESCE(NEW.interest_level, 'new'),
      COALESCE(NEW.created_at, now()),
      COALESCE(NEW.updated_at, now()),
      (
        SELECT c.workspace_id
        FROM public.campaigns c
        WHERE c.id = NEW.campaign_id
      )
    )
    RETURNING
      id, campaign_id, address_id, full_name, phone, email, address, last_contacted, status, created_at, updated_at
    INTO v_row;

    NEW.id := v_row.id;
    NEW.campaign_id := v_row.campaign_id;
    NEW.address_id := v_row.address_id;
    NEW.name := v_row.full_name;
    NEW.phone := v_row.phone;
    NEW.email := v_row.email;
    NEW.address := v_row.address;
    NEW.last_contacted_at := v_row.last_contacted;
    NEW.interest_level := v_row.status;
    NEW.created_at := v_row.created_at;
    NEW.updated_at := v_row.updated_at;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.contacts c
    SET
      campaign_id = NEW.campaign_id,
      address_id = NEW.address_id,
      full_name = COALESCE(NEW.name, c.full_name),
      phone = NEW.phone,
      email = NEW.email,
      address = COALESCE(NEW.address, c.address),
      last_contacted = NEW.last_contacted_at,
      status = COALESCE(NEW.interest_level, c.status),
      updated_at = COALESCE(NEW.updated_at, now()),
      workspace_id = (
        SELECT cp.workspace_id
        FROM public.campaigns cp
        WHERE cp.id = NEW.campaign_id
      )
    WHERE c.id = OLD.id
    RETURNING
      c.id, c.campaign_id, c.address_id, c.full_name, c.phone, c.email, c.address, c.last_contacted, c.status, c.created_at, c.updated_at
    INTO v_row;

    NEW.id := v_row.id;
    NEW.campaign_id := v_row.campaign_id;
    NEW.address_id := v_row.address_id;
    NEW.name := v_row.full_name;
    NEW.phone := v_row.phone;
    NEW.email := v_row.email;
    NEW.address := v_row.address;
    NEW.last_contacted_at := v_row.last_contacted;
    NEW.interest_level := v_row.status;
    NEW.created_at := v_row.created_at;
    NEW.updated_at := v_row.updated_at;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.contacts c
    WHERE c.id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'campaign_contacts'
  ) THEN
    DROP TRIGGER IF EXISTS campaign_contacts_view_mutation_trg ON public.campaign_contacts;
    CREATE TRIGGER campaign_contacts_view_mutation_trg
    INSTEAD OF INSERT OR UPDATE OR DELETE ON public.campaign_contacts
    FOR EACH ROW
    EXECUTE FUNCTION public.campaign_contacts_view_mutation();

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_contacts TO authenticated;
  END IF;
END $$;

COMMIT;
