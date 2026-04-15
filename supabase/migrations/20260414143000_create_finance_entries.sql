CREATE TABLE IF NOT EXISTS public.finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  created_by uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  farm_id uuid REFERENCES public.farms(id) ON DELETE CASCADE,
  agent_user_id uuid,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  vendor text,
  postal_code text,
  quantity integer NOT NULL DEFAULT 1,
  unit_label text NOT NULL DEFAULT 'item',
  unit_cost_cents integer NOT NULL DEFAULT 0,
  total_cost_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'CAD',
  incurred_on date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_entries_single_parent_check CHECK (num_nonnulls(campaign_id, farm_id) = 1),
  CONSTRAINT finance_entries_category_check CHECK (
    category IN ('postal_drop', 'printing', 'delivery', 'materials', 'fuel', 'meals', 'software', 'ads', 'other')
  ),
  CONSTRAINT finance_entries_currency_check CHECK (currency IN ('CAD')),
  CONSTRAINT finance_entries_quantity_check CHECK (quantity >= 0),
  CONSTRAINT finance_entries_unit_cost_check CHECK (unit_cost_cents >= 0),
  CONSTRAINT finance_entries_total_cost_check CHECK (total_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_finance_entries_campaign_id ON public.finance_entries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_farm_id ON public.finance_entries(farm_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_agent_user_id ON public.finance_entries(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_workspace_id ON public.finance_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_incurred_on ON public.finance_entries(incurred_on DESC);

ALTER TABLE public.finance_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_entries'
      AND policyname = 'finance_entries_select_access'
  ) THEN
    CREATE POLICY finance_entries_select_access
      ON public.finance_entries
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.campaigns c
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = c.workspace_id
          WHERE c.id = finance_entries.campaign_id
            AND (
              c.owner_id = auth.uid()
              OR wm.user_id = auth.uid()
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = finance_entries.farm_id
            AND (
              f.owner_id = auth.uid()
              OR wm.user_id = auth.uid()
            )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_entries'
      AND policyname = 'finance_entries_insert_access'
  ) THEN
    CREATE POLICY finance_entries_insert_access
      ON public.finance_entries
      FOR INSERT
      WITH CHECK (
        created_by = auth.uid()
        AND (
          EXISTS (
            SELECT 1
            FROM public.campaigns c
            LEFT JOIN public.workspace_members wm
              ON wm.workspace_id = c.workspace_id
            WHERE c.id = finance_entries.campaign_id
              AND (
                c.owner_id = auth.uid()
                OR wm.user_id = auth.uid()
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.farms f
            LEFT JOIN public.workspace_members wm
              ON wm.workspace_id = f.workspace_id
            WHERE f.id = finance_entries.farm_id
              AND (
                f.owner_id = auth.uid()
                OR wm.user_id = auth.uid()
              )
          )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_entries'
      AND policyname = 'finance_entries_update_access'
  ) THEN
    CREATE POLICY finance_entries_update_access
      ON public.finance_entries
      FOR UPDATE
      USING (created_by = auth.uid())
      WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_entries'
      AND policyname = 'finance_entries_delete_access'
  ) THEN
    CREATE POLICY finance_entries_delete_access
      ON public.finance_entries
      FOR DELETE
      USING (created_by = auth.uid());
  END IF;
END $$;
