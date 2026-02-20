-- Phase 1.1: Workspace-aware RLS for campaign child tables.
-- Strategy: gate access through parent campaigns.workspace_id membership checks.

BEGIN;

-- ---------------------------------------------------------------------------
-- campaign_contacts
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Some environments use campaign_contacts; others only use contacts.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaign_contacts'
  ) THEN
    ALTER TABLE public.campaign_contacts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view contacts for their campaigns" ON public.campaign_contacts;
    DROP POLICY IF EXISTS "Users can insert contacts for their campaigns" ON public.campaign_contacts;
    DROP POLICY IF EXISTS "Users can update contacts for their campaigns" ON public.campaign_contacts;
    DROP POLICY IF EXISTS "Users can delete contacts for their campaigns" ON public.campaign_contacts;
    DROP POLICY IF EXISTS "workspace members can manage campaign_contacts" ON public.campaign_contacts;

    CREATE POLICY "workspace members can manage campaign_contacts"
    ON public.campaign_contacts
    FOR ALL
    USING (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_contacts.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_contacts.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    );
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'contacts'
  ) THEN
    -- Fallback policy for projects that store leads in contacts.
    ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "workspace members can manage contacts" ON public.contacts;

    CREATE POLICY "workspace members can manage contacts"
    ON public.contacts
    FOR ALL
    USING (
      (
        contacts.campaign_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.campaigns c
          WHERE c.id = contacts.campaign_id
            AND public.is_workspace_member(c.workspace_id)
        )
      )
      OR (
        contacts.campaign_id IS NULL
        AND contacts.user_id = auth.uid()
      )
    )
    WITH CHECK (
      (
        contacts.campaign_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.campaigns c
          WHERE c.id = contacts.campaign_id
            AND public.is_workspace_member(c.workspace_id)
        )
      )
      OR (
        contacts.campaign_id IS NULL
        AND contacts.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- campaign_recipients
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaign_recipients'
  ) THEN
    ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "recipients by owner" ON public.campaign_recipients;
    DROP POLICY IF EXISTS "workspace members can manage campaign_recipients" ON public.campaign_recipients;

    CREATE POLICY "workspace members can manage campaign_recipients"
    ON public.campaign_recipients
    FOR ALL
    USING (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_recipients.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_recipients.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- campaign_addresses
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaign_addresses'
  ) THEN
    ALTER TABLE public.campaign_addresses ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "workspace members can manage campaign_addresses" ON public.campaign_addresses;

    CREATE POLICY "workspace members can manage campaign_addresses"
    ON public.campaign_addresses
    FOR ALL
    USING (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_addresses.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_addresses.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- campaign_exports
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaign_exports'
  ) THEN
    ALTER TABLE public.campaign_exports ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view exports for their campaigns" ON public.campaign_exports;
    DROP POLICY IF EXISTS "Users can create exports for their campaigns" ON public.campaign_exports;
    DROP POLICY IF EXISTS "workspace members can manage campaign_exports" ON public.campaign_exports;

    CREATE POLICY "workspace members can manage campaign_exports"
    ON public.campaign_exports
    FOR ALL
    USING (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_exports.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_exports.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- campaign_snapshots
-- Preserve service-role-only write behavior while making read workspace-aware.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'campaign_snapshots'
  ) THEN
    ALTER TABLE public.campaign_snapshots ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view snapshots for their campaigns" ON public.campaign_snapshots;
    DROP POLICY IF EXISTS "Only admins can insert snapshots" ON public.campaign_snapshots;
    DROP POLICY IF EXISTS "Only admins can update snapshots" ON public.campaign_snapshots;
    DROP POLICY IF EXISTS "workspace members can view campaign_snapshots" ON public.campaign_snapshots;
    DROP POLICY IF EXISTS "service role can insert campaign_snapshots" ON public.campaign_snapshots;
    DROP POLICY IF EXISTS "service role can update campaign_snapshots" ON public.campaign_snapshots;

    CREATE POLICY "workspace members can view campaign_snapshots"
    ON public.campaign_snapshots
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = campaign_snapshots.campaign_id
          AND public.is_workspace_member(c.workspace_id)
      )
    );

    CREATE POLICY "service role can insert campaign_snapshots"
    ON public.campaign_snapshots
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

    CREATE POLICY "service role can update campaign_snapshots"
    ON public.campaign_snapshots
    FOR UPDATE
    USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;
