-- Campaign Stats RPC for Surgical Intelligence Dashboard
-- Returns aggregated metrics from campaign_addresses and buildings tables

-- Add scans column to campaign_addresses if it doesn't exist
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS scans INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION rpc_get_campaign_stats(p_campaign_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_addr_count INTEGER;
  v_build_count INTEGER;
  v_visited_count INTEGER;
  v_scanned_count INTEGER;
BEGIN
  -- 1. Total Addresses (Human Leads)
  SELECT count(*) INTO v_addr_count 
  FROM public.campaign_addresses 
  WHERE campaign_id = p_campaign_id;
  
  -- 2. Total Buildings (Physical Targets)
  SELECT count(*) INTO v_build_count 
  FROM public.buildings 
  WHERE campaign_id = p_campaign_id;
  
  -- 3. Visited (any status change from available/default)
  SELECT count(*) INTO v_visited_count 
  FROM public.buildings 
  WHERE campaign_id = p_campaign_id 
    AND latest_status NOT IN ('available', 'default');
  
  -- 4. Scanned Addresses (addresses with scans > 0)
  SELECT count(*) INTO v_scanned_count 
  FROM public.campaign_addresses 
  WHERE campaign_id = p_campaign_id 
    AND COALESCE(scans, 0) > 0;

  RETURN jsonb_build_object(
    'addresses', COALESCE(v_addr_count, 0),
    'buildings', COALESCE(v_build_count, 0),
    'visited', COALESCE(v_visited_count, 0),
    'scanned', COALESCE(v_scanned_count, 0),
    'scan_rate', CASE 
      WHEN COALESCE(v_addr_count, 0) > 0 
      THEN round((COALESCE(v_scanned_count, 0)::numeric / v_addr_count::numeric) * 100, 1)
      ELSE 0 
    END,
    'progress_pct', CASE 
      WHEN COALESCE(v_build_count, 0) > 0 
      THEN round((COALESCE(v_visited_count, 0)::numeric / v_build_count::numeric) * 100, 1)
      ELSE 0 
    END
  );
END;
$$;

COMMENT ON FUNCTION rpc_get_campaign_stats(UUID) IS 
'Returns surgical campaign metrics: addresses (human leads), buildings (physical targets), visited, scanned (QR scans), scan_rate (%), and progress_pct (%).';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION rpc_get_campaign_stats(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
