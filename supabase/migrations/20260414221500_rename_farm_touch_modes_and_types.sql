DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'mode'
  ) THEN
    UPDATE public.farm_touches
    SET mode = CASE
      WHEN mode = 'canvassing' THEN 'doorknock'
      WHEN mode = 'flyer_drop' THEN 'flyer'
      ELSE mode
    END
    WHERE mode IN ('canvassing', 'flyer_drop');

    UPDATE public.farm_touches
    SET mode = 'doorknock'
    WHERE mode IS NULL;

    ALTER TABLE public.farm_touches
      ALTER COLUMN mode SET DEFAULT 'doorknock';
  END IF;
END $$;

ALTER TABLE public.farm_touches
  DROP CONSTRAINT IF EXISTS farm_touches_mode_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farm_touches'
      AND column_name = 'mode'
  ) THEN
    ALTER TABLE public.farm_touches
      ADD CONSTRAINT farm_touches_mode_check
      CHECK (mode IN ('doorknock', 'flyer', 'canada_post', 'pop_by', 'letter'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farms'
      AND column_name = 'touch_types'
  ) THEN
    UPDATE public.farms
    SET touch_types = ARRAY(
      SELECT CASE
        WHEN touch_type = 'mail' THEN 'letter'
        WHEN touch_type = 'event' THEN 'pop_by'
        ELSE touch_type
      END
      FROM unnest(COALESCE(touch_types, ARRAY[]::text[])) AS touch_type
    )
    WHERE touch_types IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.farms
  DROP CONSTRAINT IF EXISTS farms_touch_types_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'farms'
      AND column_name = 'touch_types'
  ) THEN
    ALTER TABLE public.farms
      ADD CONSTRAINT farms_touch_types_check
      CHECK (
        touch_types IS NULL
        OR touch_types <@ ARRAY['doorknock', 'flyer', 'canada_post', 'pop_by', 'letter']::text[]
      );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
