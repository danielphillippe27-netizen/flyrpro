-- Canonical address outcome write path for campaign houses.
-- Standardizes persisted house state on address_statuses + campaign_addresses.visited.

ALTER TABLE public.address_statuses
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS last_visited_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_campaign_address_outcome(
  p_campaign_id uuid,
  p_campaign_address_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL,
  p_status text DEFAULT 'none',
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_address_id uuid := COALESCE(p_campaign_address_id, p_address_id);
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_visited boolean;
  v_row public.address_statuses%ROWTYPE;
  v_session_user_id uuid;
  v_session_campaign_id uuid;
  v_session_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_campaign_address_id IS NULL THEN
    RAISE EXCEPTION 'campaign address id is required';
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
    RAISE EXCEPTION 'Unsupported address status: %', v_status;
  END IF;

  IF p_session_event_type IS NOT NULL AND p_session_event_type NOT IN (
    'completed_manual',
    'completed_auto',
    'completion_undone'
  ) THEN
    RAISE EXCEPTION 'Unsupported session event type: %', p_session_event_type;
  END IF;

  PERFORM 1
  FROM public.campaign_addresses ca
  JOIN public.campaigns c ON c.id = ca.campaign_id
  WHERE ca.id = v_campaign_address_id
    AND ca.campaign_id = p_campaign_id
    AND c.owner_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign address not found or access denied';
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT user_id, campaign_id
    INTO v_session_user_id, v_session_campaign_id
    FROM public.sessions
    WHERE id = p_session_id;

    IF v_session_user_id IS NULL OR v_session_user_id != auth.uid() THEN
      RAISE EXCEPTION 'Session not found or access denied';
    END IF;

    IF v_session_campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'Session campaign does not match campaign address outcome campaign';
    END IF;
  END IF;

  v_visited := v_status <> 'none';

  INSERT INTO public.address_statuses (
    campaign_address_id,
    status,
    notes,
    last_visited_at,
    visit_count,
    updated_at
  ) VALUES (
    v_campaign_address_id,
    v_status,
    v_notes,
    CASE WHEN v_visited THEN p_occurred_at ELSE NULL END,
    CASE WHEN v_visited THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (campaign_address_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    notes = COALESCE(EXCLUDED.notes, public.address_statuses.notes),
    last_visited_at = CASE
      WHEN EXCLUDED.status = 'none' THEN public.address_statuses.last_visited_at
      ELSE EXCLUDED.last_visited_at
    END,
    visit_count = CASE
      WHEN EXCLUDED.status = 'none' THEN public.address_statuses.visit_count
      ELSE public.address_statuses.visit_count + 1
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  UPDATE public.campaign_addresses
  SET visited = v_visited
  WHERE id = v_campaign_address_id;

  IF p_session_id IS NOT NULL AND p_session_event_type IS NOT NULL THEN
    INSERT INTO public.session_events (
      session_id,
      building_id,
      address_id,
      event_type,
      created_at,
      lat,
      lon,
      event_location,
      metadata,
      user_id
    ) VALUES (
      p_session_id,
      nullif(trim(coalesce(p_session_target_id, '')), ''),
      v_campaign_address_id,
      p_session_event_type,
      p_occurred_at,
      p_lat,
      p_lon,
      CASE
        WHEN p_lon IS NOT NULL AND p_lat IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
        ELSE NULL
      END,
      jsonb_build_object(
        'address_status', v_status,
        'source', 'record_campaign_address_outcome'
      ),
      v_session_user_id
    )
    RETURNING id INTO v_session_event_id;

    IF p_session_event_type IN ('completed_manual', 'completed_auto') THEN
      UPDATE public.sessions
      SET completed_count = completed_count + 1,
          updated_at = now()
      WHERE id = p_session_id;
    ELSIF p_session_event_type = 'completion_undone' THEN
      UPDATE public.sessions
      SET completed_count = GREATEST(0, completed_count - 1),
          updated_at = now()
      WHERE id = p_session_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'campaign_address_id', v_row.campaign_address_id,
    'status', v_row.status,
    'visited', v_visited,
    'visit_count', v_row.visit_count,
    'last_visited_at', v_row.last_visited_at,
    'updated_at', v_row.updated_at,
    'session_event_id', v_session_event_id
  );
END;
$$;

COMMENT ON FUNCTION public.record_campaign_address_outcome(uuid, uuid, uuid, text, text, timestamptz, uuid, text, text, double precision, double precision)
IS 'Canonical house outcome write path. Upserts address_statuses, syncs campaign_addresses.visited, and can atomically log session completion.';

GRANT EXECUTE ON FUNCTION public.record_campaign_address_outcome(uuid, uuid, uuid, text, text, timestamptz, uuid, text, text, double precision, double precision) TO authenticated, service_role;
