ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS home_limit integer DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS address_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_generated_at timestamptz;

UPDATE public.farms
SET
  home_limit = COALESCE(home_limit, 5000),
  address_count = COALESCE(address_count, 0),
  updated_at = COALESCE(updated_at, created_at, now())
WHERE home_limit IS NULL
   OR address_count IS NULL
   OR updated_at IS NULL;

ALTER TABLE public.farm_touches
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS mode text DEFAULT 'canvassing',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS homes_target integer,
  ADD COLUMN IF NOT EXISTS homes_reached integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
DECLARE
  has_completed_date boolean := false;
  has_scheduled_date boolean := false;
  has_created_at boolean := false;
  update_sql text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'completed_date'
  ) INTO has_completed_date;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'scheduled_date'
  ) INTO has_scheduled_date;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'created_at'
  ) INTO has_created_at;

  update_sql := '
    UPDATE public.farm_touches
    SET
      mode = COALESCE(mode, ''canvassing''),
      updated_at = COALESCE(updated_at';

  IF has_completed_date THEN
    update_sql := update_sql || ', completed_date';
  END IF;

  IF has_scheduled_date THEN
    update_sql := update_sql || ', scheduled_date';
  END IF;

  IF has_created_at THEN
    update_sql := update_sql || ', created_at';
  END IF;

  update_sql := update_sql || ', now()),
      last_completed_at = COALESCE(last_completed_at';

  IF has_completed_date THEN
    update_sql := update_sql || ', completed_date';
  END IF;

  update_sql := update_sql || ')
    WHERE mode IS NULL
       OR updated_at IS NULL
       OR last_completed_at IS NULL';

  EXECUTE update_sql;
END $$;

ALTER TABLE public.farm_touches
  DROP CONSTRAINT IF EXISTS farm_touches_status_check;

DO $$
DECLARE
  has_status boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'status'
  ) INTO has_status;

  IF NOT has_status THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farm_touches_mode_check'
  ) THEN
    ALTER TABLE public.farm_touches
      ADD CONSTRAINT farm_touches_mode_check
      CHECK (mode IN ('canvassing', 'flyer_drop', 'canada_post'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'status'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farm_touches_status_check_v2'
  ) THEN
    ALTER TABLE public.farm_touches
      ADD CONSTRAINT farm_touches_status_check_v2
      CHECK (status IN ('scheduled', 'in_progress', 'completed', 'skipped'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.farm_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  gers_id text,
  formatted text NOT NULL,
  house_number text,
  street_name text,
  locality text,
  region text,
  postal_code text,
  source text NOT NULL DEFAULT 'map',
  latitude double precision,
  longitude double precision,
  geom jsonb,
  visited_count integer NOT NULL DEFAULT 0,
  last_visited_at timestamptz,
  last_touch_id uuid REFERENCES public.farm_touches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_addresses_farm_id ON public.farm_addresses(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_addresses_farm_street ON public.farm_addresses(farm_id, street_name, house_number);
CREATE INDEX IF NOT EXISTS idx_farm_touches_farm_id ON public.farm_touches(farm_id);
CREATE INDEX IF NOT EXISTS idx_farms_workspace_id ON public.farms(workspace_id);

ALTER TABLE public.farm_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'farm_addresses'
      AND policyname = 'farm_addresses_owner_or_workspace_member_select'
  ) THEN
    CREATE POLICY farm_addresses_owner_or_workspace_member_select
      ON public.farm_addresses
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = farm_addresses.farm_id
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
      AND tablename = 'farm_addresses'
      AND policyname = 'farm_addresses_owner_or_workspace_member_insert'
  ) THEN
    CREATE POLICY farm_addresses_owner_or_workspace_member_insert
      ON public.farm_addresses
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = farm_addresses.farm_id
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
      AND tablename = 'farm_addresses'
      AND policyname = 'farm_addresses_owner_or_workspace_member_update'
  ) THEN
    CREATE POLICY farm_addresses_owner_or_workspace_member_update
      ON public.farm_addresses
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = farm_addresses.farm_id
            AND (
              f.owner_id = auth.uid()
              OR wm.user_id = auth.uid()
            )
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = farm_addresses.farm_id
            AND (
              f.owner_id = auth.uid()
              OR wm.user_id = auth.uid()
            )
        )
      );
  END IF;
END $$;

