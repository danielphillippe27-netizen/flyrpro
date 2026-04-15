ALTER TABLE public.farm_touches
  ADD COLUMN IF NOT EXISTS cycle_number integer;

WITH farm_touch_order AS (
  SELECT
    ft.id,
    GREATEST(
      1,
      CEIL(
        ROW_NUMBER() OVER (
          PARTITION BY ft.farm_id
          ORDER BY COALESCE(ft.scheduled_date, ft.completed_date, ft.created_at, now()), ft.created_at, ft.id
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
  ALTER COLUMN cycle_number SET DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_farm_touches_farm_cycle_number
  ON public.farm_touches(farm_id, cycle_number DESC, scheduled_date DESC);
