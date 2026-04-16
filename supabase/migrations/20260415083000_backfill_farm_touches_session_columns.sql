ALTER TABLE public.farm_touches
  ADD COLUMN IF NOT EXISTS scheduled_date timestamptz,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS cycle_number integer;

UPDATE public.farm_touches
SET scheduled_date = COALESCE(
  scheduled_date,
  completed_date,
  completed_at,
  CASE
    WHEN date IS NOT NULL THEN ((date::text || 'T12:00:00Z')::timestamptz)
    ELSE NULL
  END,
  created_at,
  now()
)
WHERE scheduled_date IS NULL;

UPDATE public.farm_touches
SET status = CASE
  WHEN COALESCE(completed, false) THEN 'completed'
  WHEN completed_at IS NOT NULL THEN 'completed'
  WHEN completed_date IS NOT NULL THEN 'completed'
  WHEN last_completed_at IS NOT NULL THEN 'completed'
  WHEN started_at IS NOT NULL THEN 'in_progress'
  ELSE 'scheduled'
END
WHERE status IS NULL;

WITH farm_touch_order AS (
  SELECT
    ft.id,
    GREATEST(
      1,
      CEIL(
        ROW_NUMBER() OVER (
          PARTITION BY ft.farm_id
          ORDER BY COALESCE(ft.scheduled_date, ft.completed_date, ft.completed_at, ft.created_at, now()), ft.created_at, ft.id
        )::numeric
        / GREATEST(COALESCE(f.touches_per_interval, f.frequency, 1), 1)
      )::integer
    ) AS resolved_cycle_number
  FROM public.farm_touches ft
  JOIN public.farms f
    ON f.id = ft.farm_id
)
UPDATE public.farm_touches ft
SET cycle_number = farm_touch_order.resolved_cycle_number
FROM farm_touch_order
WHERE ft.id = farm_touch_order.id
  AND ft.cycle_number IS NULL;

ALTER TABLE public.farm_touches
  ALTER COLUMN scheduled_date SET DEFAULT now(),
  ALTER COLUMN status SET DEFAULT 'scheduled',
  ALTER COLUMN cycle_number SET DEFAULT 1;

ALTER TABLE public.farm_touches
  DROP CONSTRAINT IF EXISTS farm_touches_status_check,
  DROP CONSTRAINT IF EXISTS farm_touches_status_check_v2;

DO $$
BEGIN
  ALTER TABLE public.farm_touches
    ADD CONSTRAINT farm_touches_status_check_v3
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'skipped'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
