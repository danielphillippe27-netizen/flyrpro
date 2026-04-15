ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS goal_type text,
  ADD COLUMN IF NOT EXISTS goal_target integer,
  ADD COLUMN IF NOT EXISTS cycle_completion_window_days integer;

UPDATE public.farms
SET
  goal_type = COALESCE(
    goal_type,
    CASE
      WHEN COALESCE(touches_interval, 'month') = 'year' THEN 'touches_per_year'
      ELSE 'touches_per_cycle'
    END
  ),
  goal_target = COALESCE(goal_target, touches_per_interval, frequency, 2)
WHERE goal_type IS NULL
   OR goal_target IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_goal_type_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_goal_type_check
      CHECK (
        goal_type IS NULL
        OR goal_type IN ('touches_per_year', 'touches_per_cycle', 'homes_per_cycle')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_goal_target_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_goal_target_check
      CHECK (goal_target IS NULL OR goal_target >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_cycle_completion_window_days_check'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_cycle_completion_window_days_check
      CHECK (
        cycle_completion_window_days IS NULL
        OR cycle_completion_window_days >= 1
      );
  END IF;
END $$;
