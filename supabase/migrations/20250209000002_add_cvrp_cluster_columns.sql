-- Add CVRP cluster columns to campaign_addresses
-- Stores optimized routing assignments for fair territory splitting

-- Add cluster assignment columns (one per statement for compatibility)
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS cluster_id integer;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS sequence integer;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS walk_time_sec integer;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS distance_m integer;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS route_polyline text;

-- Create index for efficient cluster queries
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_cluster 
ON public.campaign_addresses(campaign_id, cluster_id, sequence);

-- View for campaign route clusters
CREATE OR REPLACE VIEW campaign_route_clusters AS
SELECT 
    campaign_id,
    cluster_id,
    COUNT(*) as n_addresses,
    MIN(sequence) as start_sequence,
    MAX(sequence) as end_sequence,
    SUM(distance_m) as total_distance_m,
    MAX(walk_time_sec) as total_walk_time_sec,
    ARRAY_AGG(
        jsonb_build_object(
            'id', id,
            'sequence', sequence,
            'formatted', formatted,
            'house_number', house_number,
            'street_name', street_name
        ) ORDER BY sequence
    ) as addresses
FROM campaign_addresses
WHERE cluster_id IS NOT NULL
GROUP BY campaign_id, cluster_id
ORDER BY campaign_id, cluster_id;

-- Function to get route for a specific cluster
CREATE OR REPLACE FUNCTION get_cluster_route(
    p_campaign_id uuid,
    p_cluster_id integer
)
RETURNS TABLE (
    address_id uuid,
    sequence integer,
    formatted text,
    house_number text,
    street_name text,
    walk_time_sec integer,
    distance_m integer
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ca.id,
        ca.sequence,
        ca.formatted,
        ca.house_number,
        ca.street_name,
        ca.walk_time_sec,
        ca.distance_m
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.cluster_id = p_cluster_id
    ORDER BY ca.sequence;
END;
$$ LANGUAGE plpgsql;

-- Function to clear existing routes (before re-optimization)
CREATE OR REPLACE FUNCTION clear_campaign_routes(
    p_campaign_id uuid
)
RETURNS void AS $$
BEGIN
    UPDATE campaign_addresses
    SET cluster_id = NULL,
        sequence = NULL,
        walk_time_sec = NULL,
        distance_m = NULL,
        route_polyline = NULL
    WHERE campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON COLUMN campaign_addresses.cluster_id IS 'CVRP cluster assignment (agent_id)';
COMMENT ON COLUMN campaign_addresses.sequence IS 'Stop sequence within cluster route';
COMMENT ON COLUMN campaign_addresses.walk_time_sec IS 'Cumulative walking time from depot';
COMMENT ON COLUMN campaign_addresses.distance_m IS 'Cumulative walking distance from depot';
COMMENT ON VIEW campaign_route_clusters IS 'Summary of CVRP-optimized route clusters';
