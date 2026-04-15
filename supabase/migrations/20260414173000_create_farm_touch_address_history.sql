ALTER TABLE public.farm_addresses
  ADD COLUMN IF NOT EXISTS campaign_address_id uuid,
  ADD COLUMN IF NOT EXISTS last_outcome_status text;

CREATE INDEX IF NOT EXISTS idx_farm_addresses_campaign_address_id
  ON public.farm_addresses(campaign_address_id);

UPDATE public.farm_addresses fa
SET campaign_address_id = ca.id
FROM public.farms f,
     public.campaign_addresses ca
WHERE fa.farm_id = f.id
  AND ca.campaign_id = f.linked_campaign_id
  AND (
    ca.formatted IS NOT DISTINCT FROM fa.formatted
    OR (
      ca.gers_id IS NOT NULL
      AND fa.gers_id IS NOT NULL
      AND ca.gers_id = fa.gers_id
    )
  )
  AND fa.campaign_address_id IS NULL;

CREATE TABLE IF NOT EXISTS public.farm_touch_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  farm_touch_id uuid NOT NULL REFERENCES public.farm_touches(id) ON DELETE CASCADE,
  farm_address_id uuid NOT NULL REFERENCES public.farm_addresses(id) ON DELETE CASCADE,
  campaign_address_id uuid,
  status text NOT NULL DEFAULT 'delivered',
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_touch_addresses_status_check CHECK (
    status IN (
      'none',
      'no_answer',
      'delivered',
      'talked',
      'appointment',
      'do_not_knock',
      'future_seller',
      'hot_lead'
    )
  ),
  CONSTRAINT farm_touch_addresses_touch_address_unique UNIQUE (farm_touch_id, farm_address_id)
);

CREATE INDEX IF NOT EXISTS idx_farm_touch_addresses_farm_id
  ON public.farm_touch_addresses(farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_touch_addresses_touch_id
  ON public.farm_touch_addresses(farm_touch_id);

CREATE INDEX IF NOT EXISTS idx_farm_touch_addresses_address_id
  ON public.farm_touch_addresses(farm_address_id);

ALTER TABLE public.farm_touch_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'farm_touch_addresses'
      AND policyname = 'farm_touch_addresses_owner_or_workspace_member_select'
  ) THEN
    CREATE POLICY farm_touch_addresses_owner_or_workspace_member_select
      ON public.farm_touch_addresses
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.farms f
          LEFT JOIN public.workspace_members wm
            ON wm.workspace_id = f.workspace_id
          WHERE f.id = farm_touch_addresses.farm_id
            AND (
              f.owner_id = auth.uid()
              OR wm.user_id = auth.uid()
            )
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_farm_address_outcome(
  p_farm_id uuid,
  p_farm_touch_id uuid,
  p_farm_address_id uuid DEFAULT NULL,
  p_campaign_address_id uuid DEFAULT NULL,
  p_status text DEFAULT 'delivered',
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(trim(coalesce(p_status, 'delivered')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_farm_address_id uuid := p_farm_address_id;
  v_visit_count integer := 0;
  v_latest_visit record;
  v_touch_farm_id uuid;
  v_address_farm_id uuid;
  v_touch_homes_reached integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_farm_id IS NULL THEN
    RAISE EXCEPTION 'farm id is required';
  END IF;

  IF p_farm_touch_id IS NULL THEN
    RAISE EXCEPTION 'farm touch id is required';
  END IF;

  IF v_status NOT IN (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  ) THEN
    RAISE EXCEPTION 'Unsupported farm address status: %', v_status;
  END IF;

  PERFORM 1
  FROM public.farms f
  LEFT JOIN public.workspace_members wm
    ON wm.workspace_id = f.workspace_id
  WHERE f.id = p_farm_id
    AND (
      f.owner_id = auth.uid()
      OR wm.user_id = auth.uid()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Farm not found or access denied';
  END IF;

  SELECT farm_id
  INTO v_touch_farm_id
  FROM public.farm_touches
  WHERE id = p_farm_touch_id;

  IF v_touch_farm_id IS NULL OR v_touch_farm_id IS DISTINCT FROM p_farm_id THEN
    RAISE EXCEPTION 'Farm touch not found or does not belong to the farm';
  END IF;

  IF v_farm_address_id IS NULL AND p_campaign_address_id IS NOT NULL THEN
    SELECT id
    INTO v_farm_address_id
    FROM public.farm_addresses
    WHERE farm_id = p_farm_id
      AND campaign_address_id = p_campaign_address_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_farm_address_id IS NULL THEN
    RAISE EXCEPTION 'farm address id or campaign address id is required';
  END IF;

  SELECT farm_id
  INTO v_address_farm_id
  FROM public.farm_addresses
  WHERE id = v_farm_address_id;

  IF v_address_farm_id IS NULL OR v_address_farm_id IS DISTINCT FROM p_farm_id THEN
    RAISE EXCEPTION 'Farm address not found or does not belong to the farm';
  END IF;

  INSERT INTO public.farm_touch_addresses (
    farm_id,
    farm_touch_id,
    farm_address_id,
    campaign_address_id,
    status,
    notes,
    occurred_at,
    created_by,
    updated_at
  )
  SELECT
    p_farm_id,
    p_farm_touch_id,
    fa.id,
    COALESCE(p_campaign_address_id, fa.campaign_address_id),
    v_status,
    v_notes,
    p_occurred_at,
    auth.uid(),
    now()
  FROM public.farm_addresses fa
  WHERE fa.id = v_farm_address_id
  ON CONFLICT (farm_touch_id, farm_address_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    notes = COALESCE(EXCLUDED.notes, public.farm_touch_addresses.notes),
    occurred_at = EXCLUDED.occurred_at,
    campaign_address_id = COALESCE(EXCLUDED.campaign_address_id, public.farm_touch_addresses.campaign_address_id),
    updated_at = now();

  SELECT COUNT(*)
  INTO v_visit_count
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_address_id = v_farm_address_id
    AND fta.status <> 'none';

  SELECT
    fta.occurred_at,
    fta.farm_touch_id,
    fta.status
  INTO v_latest_visit
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_address_id = v_farm_address_id
    AND fta.status <> 'none'
  ORDER BY fta.occurred_at DESC, fta.updated_at DESC
  LIMIT 1;

  UPDATE public.farm_addresses
  SET
    visited_count = COALESCE(v_visit_count, 0),
    last_visited_at = CASE
      WHEN v_visit_count > 0 THEN v_latest_visit.occurred_at
      ELSE NULL
    END,
    last_touch_id = CASE
      WHEN v_visit_count > 0 THEN v_latest_visit.farm_touch_id
      ELSE NULL
    END,
    last_outcome_status = CASE
      WHEN v_visit_count > 0 THEN v_latest_visit.status
      ELSE NULL
    END
  WHERE id = v_farm_address_id;

  SELECT COUNT(*)
  INTO v_touch_homes_reached
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_touch_id = p_farm_touch_id
    AND fta.status <> 'none';

  UPDATE public.farm_touches
  SET
    homes_reached = v_touch_homes_reached,
    updated_at = now()
  WHERE id = p_farm_touch_id;

  RETURN jsonb_build_object(
    'farm_id', p_farm_id,
    'farm_touch_id', p_farm_touch_id,
    'farm_address_id', v_farm_address_id,
    'status', v_status,
    'visited_count', v_visit_count,
    'homes_reached', v_touch_homes_reached,
    'last_touch_id', CASE
      WHEN v_visit_count > 0 THEN v_latest_visit.farm_touch_id
      ELSE NULL
    END,
    'last_outcome_status', CASE
      WHEN v_visit_count > 0 THEN v_latest_visit.status
      ELSE NULL
    END
  );
END;
$$;

COMMENT ON FUNCTION public.record_farm_address_outcome(uuid, uuid, uuid, uuid, text, text, timestamptz)
IS 'Canonical farm session address outcome write path. Upserts per-touch house outcomes and keeps farm address/touch aggregates in sync.';

GRANT EXECUTE ON FUNCTION public.record_farm_address_outcome(uuid, uuid, uuid, uuid, text, text, timestamptz)
  TO authenticated, service_role;
