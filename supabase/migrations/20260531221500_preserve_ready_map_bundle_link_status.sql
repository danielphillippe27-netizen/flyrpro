ALTER TABLE public.campaign_map_bundles
  DROP CONSTRAINT IF EXISTS campaign_map_bundles_links_status_check;

ALTER TABLE public.campaign_map_bundles
  ADD CONSTRAINT campaign_map_bundles_links_status_check
  CHECK (
    links_status IN (
      'ok',
      'fresh',
      'ready',
      'stale_reused',
      'pending_provision',
      'client_fallback_required',
      'linking_failed'
    )
  );

DO $$
DECLARE
  v_function RECORD;
  v_definition TEXT;
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rpc_upsert_campaign_map_bundle'
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);

    v_definition := replace(
      v_definition,
      $$WHEN p_links_status = 'fresh' THEN 'ok'
      WHEN p_links_status IN ('ok', 'stale_reused', 'pending_provision', 'client_fallback_required') THEN p_links_status
      ELSE 'pending_provision'$$,
      $$WHEN p_links_status IN ('ok', 'ready', 'fresh', 'stale_reused', 'pending_provision', 'client_fallback_required', 'linking_failed') THEN p_links_status
      ELSE 'pending_provision'$$
    );

    v_definition := replace(
      v_definition,
      $$WHEN p_links_status IN ('fresh', 'stale_reused', 'client_fallback_required') THEN p_links_status
      ELSE 'fresh'$$,
      $$WHEN p_links_status IN ('ok', 'ready', 'fresh', 'stale_reused', 'pending_provision', 'client_fallback_required', 'linking_failed') THEN p_links_status
      ELSE 'fresh'$$
    );

    v_definition := replace(
      v_definition,
      $$WHEN p_links_status IN ('ok', 'ready', 'fresh') THEN 'fresh'
      WHEN p_links_status IN ('stale_reused', 'pending_provision', 'client_fallback_required') THEN p_links_status
      ELSE 'fresh'$$,
      $$WHEN p_links_status IN ('ok', 'ready', 'fresh', 'stale_reused', 'pending_provision', 'client_fallback_required', 'linking_failed') THEN p_links_status
      ELSE 'fresh'$$
    );

    EXECUTE v_definition;
  END LOOP;
END
$$;
