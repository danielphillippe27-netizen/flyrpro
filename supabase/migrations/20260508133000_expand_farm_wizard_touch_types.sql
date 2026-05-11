ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS include_social_ads_in_spend boolean NOT NULL DEFAULT false;

UPDATE public.farms
SET include_social_ads_in_spend = false
WHERE include_social_ads_in_spend IS NULL;

ALTER TABLE public.farms
  ALTER COLUMN include_social_ads_in_spend SET DEFAULT false,
  ALTER COLUMN include_social_ads_in_spend SET NOT NULL;

ALTER TABLE public.farms
  DROP CONSTRAINT IF EXISTS farms_touch_types_check;

UPDATE public.farms
SET touch_types = ARRAY(
  SELECT DISTINCT normalized_touch_type
  FROM unnest(COALESCE(touch_types, ARRAY[]::text[])) AS touch_type
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN touch_type = 'mail' THEN 'letter'
      WHEN touch_type = 'canvassing' THEN 'doorknock'
      WHEN touch_type = 'flyer_drop' THEN 'flyer'
      ELSE touch_type
    END AS normalized_touch_type
  ) normalized
  WHERE normalized_touch_type IN (
    'doorknock',
    'flyer',
    'canada_post',
    'pop_by',
    'letter',
    'phone_call',
    'social_ad',
    'event'
  )
)
WHERE touch_types IS NOT NULL;

ALTER TABLE public.farms
  ADD CONSTRAINT farms_touch_types_check
  CHECK (
    touch_types IS NULL
    OR touch_types <@ ARRAY[
      'doorknock',
      'flyer',
      'canada_post',
      'pop_by',
      'letter',
      'phone_call',
      'social_ad',
      'event'
    ]::text[]
  );

ALTER TABLE public.farm_touches
  DROP CONSTRAINT IF EXISTS farm_touches_mode_check;

UPDATE public.farm_touches
SET mode = CASE
  WHEN mode = 'canvassing' THEN 'doorknock'
  WHEN mode = 'flyer_drop' THEN 'flyer'
  WHEN mode = 'mail' THEN 'letter'
  WHEN mode IS NULL THEN 'doorknock'
  WHEN mode IN (
    'doorknock',
    'flyer',
    'canada_post',
    'pop_by',
    'letter',
    'phone_call',
    'social_ad',
    'event'
  ) THEN mode
  ELSE 'doorknock'
END
WHERE mode IS NULL
  OR mode IN ('canvassing', 'flyer_drop', 'mail')
  OR mode NOT IN (
    'doorknock',
    'flyer',
    'canada_post',
    'pop_by',
    'letter',
    'phone_call',
    'social_ad',
    'event'
  );

ALTER TABLE public.farm_touches
  ALTER COLUMN mode SET DEFAULT 'doorknock',
  ALTER COLUMN mode SET NOT NULL,
  ADD CONSTRAINT farm_touches_mode_check
  CHECK (
    mode IN (
      'doorknock',
      'flyer',
      'canada_post',
      'pop_by',
      'letter',
      'phone_call',
      'social_ad',
      'event'
    )
  );
