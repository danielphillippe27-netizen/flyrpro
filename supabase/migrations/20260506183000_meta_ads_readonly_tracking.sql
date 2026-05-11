CREATE TABLE IF NOT EXISTS public.meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  team_id uuid NULL,
  meta_user_id text,
  access_token_encrypted text NOT NULL,
  token_expires_at timestamptz NULL,
  scopes text[] NULL,
  connected_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  team_id uuid NULL,
  meta_connection_id uuid REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  meta_ad_account_id text NOT NULL,
  name text,
  currency text,
  account_status text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farm_meta_campaign_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  team_id uuid NULL,
  meta_connection_id uuid REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  meta_ad_account_id text NOT NULL,
  meta_campaign_id text NOT NULL,
  meta_campaign_name text,
  status text DEFAULT 'active',
  linked_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farm_meta_ad_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  farm_meta_campaign_link_id uuid REFERENCES public.farm_meta_campaign_links(id) ON DELETE CASCADE,
  meta_campaign_id text NOT NULL,
  date date NOT NULL,
  spend numeric DEFAULT 0,
  impressions integer DEFAULT 0,
  reach integer DEFAULT 0,
  clicks integer DEFAULT 0,
  leads integer DEFAULT 0,
  actions jsonb NULL,
  raw_payload jsonb NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(farm_meta_campaign_link_id, date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_connections_user_id
  ON public.meta_connections(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ad_accounts_user_account
  ON public.meta_ad_accounts(user_id, meta_ad_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_meta_campaign_links_farm_campaign
  ON public.farm_meta_campaign_links(farm_id, meta_campaign_id);

CREATE INDEX IF NOT EXISTS idx_farm_meta_campaign_links_farm_id
  ON public.farm_meta_campaign_links(farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_meta_ad_daily_metrics_farm_id
  ON public.farm_meta_ad_daily_metrics(farm_id);

CREATE OR REPLACE FUNCTION public.set_meta_ads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_meta_connections_updated_at ON public.meta_connections;
CREATE TRIGGER set_meta_connections_updated_at
  BEFORE UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_meta_ads_updated_at();

DROP TRIGGER IF EXISTS set_meta_ad_accounts_updated_at ON public.meta_ad_accounts;
CREATE TRIGGER set_meta_ad_accounts_updated_at
  BEFORE UPDATE ON public.meta_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_meta_ads_updated_at();

DROP TRIGGER IF EXISTS set_farm_meta_campaign_links_updated_at ON public.farm_meta_campaign_links;
CREATE TRIGGER set_farm_meta_campaign_links_updated_at
  BEFORE UPDATE ON public.farm_meta_campaign_links
  FOR EACH ROW EXECUTE FUNCTION public.set_meta_ads_updated_at();

DROP TRIGGER IF EXISTS set_farm_meta_ad_daily_metrics_updated_at ON public.farm_meta_ad_daily_metrics;
CREATE TRIGGER set_farm_meta_ad_daily_metrics_updated_at
  BEFORE UPDATE ON public.farm_meta_ad_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_meta_ads_updated_at();

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_meta_campaign_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_meta_ad_daily_metrics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_connections'
      AND policyname = 'meta_connections_user_select'
  ) THEN
    CREATE POLICY meta_connections_user_select
      ON public.meta_connections
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_connections'
      AND policyname = 'meta_connections_user_insert'
  ) THEN
    CREATE POLICY meta_connections_user_insert
      ON public.meta_connections
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_connections'
      AND policyname = 'meta_connections_user_update'
  ) THEN
    CREATE POLICY meta_connections_user_update
      ON public.meta_connections
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_connections'
      AND policyname = 'meta_connections_user_delete'
  ) THEN
    CREATE POLICY meta_connections_user_delete
      ON public.meta_connections
      FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_ad_accounts'
      AND policyname = 'meta_ad_accounts_user_all'
  ) THEN
    CREATE POLICY meta_ad_accounts_user_all
      ON public.meta_ad_accounts
      FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'farm_meta_campaign_links'
      AND policyname = 'farm_meta_campaign_links_farm_access_all'
  ) THEN
    CREATE POLICY farm_meta_campaign_links_farm_access_all
      ON public.farm_meta_campaign_links
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
           AND wm.user_id = auth.uid()
          WHERE f.id = farm_meta_campaign_links.farm_id
            AND (f.owner_id = auth.uid() OR wm.user_id = auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
           AND wm.user_id = auth.uid()
          WHERE f.id = farm_meta_campaign_links.farm_id
            AND (f.owner_id = auth.uid() OR wm.user_id = auth.uid())
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'farm_meta_ad_daily_metrics'
      AND policyname = 'farm_meta_ad_daily_metrics_farm_access_all'
  ) THEN
    CREATE POLICY farm_meta_ad_daily_metrics_farm_access_all
      ON public.farm_meta_ad_daily_metrics
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
           AND wm.user_id = auth.uid()
          WHERE f.id = farm_meta_ad_daily_metrics.farm_id
            AND (f.owner_id = auth.uid() OR wm.user_id = auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
           AND wm.user_id = auth.uid()
          WHERE f.id = farm_meta_ad_daily_metrics.farm_id
            AND (f.owner_id = auth.uid() OR wm.user_id = auth.uid())
        )
      );
  END IF;
END $$;
