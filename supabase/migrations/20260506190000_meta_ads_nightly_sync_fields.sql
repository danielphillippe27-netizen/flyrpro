ALTER TABLE public.farm_meta_campaign_links
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.meta_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NULL REFERENCES public.farms(id) ON DELETE SET NULL,
  farm_meta_campaign_link_id uuid NULL REFERENCES public.farm_meta_campaign_links(id) ON DELETE SET NULL,
  meta_campaign_id text NULL,
  user_id uuid NULL,
  team_id uuid NULL,
  status text NOT NULL,
  message text NULL,
  error_code text NULL,
  synced_from date NULL,
  synced_to date NULL,
  rows_synced integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_meta_campaign_links_last_synced_at
  ON public.farm_meta_campaign_links(last_synced_at);

CREATE INDEX IF NOT EXISTS idx_meta_sync_logs_created_at
  ON public.meta_sync_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_sync_logs_link_id
  ON public.meta_sync_logs(farm_meta_campaign_link_id);

ALTER TABLE public.meta_sync_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meta_sync_logs'
      AND policyname = 'meta_sync_logs_farm_access_select'
  ) THEN
    CREATE POLICY meta_sync_logs_farm_access_select
      ON public.meta_sync_logs
      FOR SELECT
      USING (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
           AND wm.user_id = auth.uid()
          WHERE f.id = meta_sync_logs.farm_id
            AND (f.owner_id = auth.uid() OR wm.user_id = auth.uid())
        )
      );
  END IF;
END $$;
