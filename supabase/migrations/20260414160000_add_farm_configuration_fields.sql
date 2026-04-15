ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS touches_per_interval integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS touches_interval text DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS touch_types text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS annual_budget_cents integer;

UPDATE public.farms
SET
  touches_per_interval = COALESCE(touches_per_interval, frequency, 2),
  touches_interval = COALESCE(touches_interval, 'month'),
  touch_types = COALESCE(touch_types, ARRAY[]::text[])
WHERE touches_per_interval IS NULL
   OR touches_interval IS NULL
   OR touch_types IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_touches_per_interval_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_touches_per_interval_check
      CHECK (touches_per_interval IS NULL OR touches_per_interval >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_touches_interval_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_touches_interval_check
      CHECK (touches_interval IN ('month', 'year'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_touch_types_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_touch_types_check
      CHECK (
        touch_types IS NULL
        OR touch_types <@ ARRAY['doorknock', 'flyer', 'mail', 'event', 'pop_by']::text[]
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_annual_budget_cents_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_annual_budget_cents_check
      CHECK (annual_budget_cents IS NULL OR annual_budget_cents >= 0);
  END IF;
END $$;
