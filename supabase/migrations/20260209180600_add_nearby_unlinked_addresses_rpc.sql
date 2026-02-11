-- RPC function to get nearby unlinked addresses for manual building assignment
-- Used when user wants to add an address to a building that wasn't auto-linked

CREATE OR REPLACE FUNCTION get_nearby_unlinked_addresses(
  p_campaign_id uuid,
  p_building_id text,
  p_radius_meters float DEFAULT 50.0,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  address_id uuid,
  formatted text,
  house_number text,
  street_name text,
  distance_meters float,
  geom jsonb
) AS $$
BEGIN
  RETURN QUERY
  WITH building_location AS (
    -- Get approximate building location from existing linked addresses
    -- or from campaign_addresses if no links exist yet
    SELECT 
      ca.geom as building_geom,
      ST_X(ca.geom::geometry) as lon,
      ST_Y(ca.geom::geometry) as lat
    FROM building_address_links l
    JOIN campaign_addresses ca ON l.address_id = ca.id
    WHERE l.campaign_id = p_campaign_id
      AND l.building_id = p_building_id
    LIMIT 1
  ),
  unlinked AS (
    SELECT 
      ca.id as addr_id,
      ca.formatted as addr_formatted,
      ca.house_number as addr_house_number,
      ca.street_name as addr_street_name,
      ca.geom as addr_geom,
      -- Calculate approximate distance in meters (very rough estimation)
      -- For production, use PostGIS ST_Distance with proper SRID
      (
        ABS(ST_X(ca.geom::geometry) - (SELECT lon FROM building_location)) * 111320 * 
        COS(RADIANS(ST_Y(ca.geom::geometry)))
      ) + (
        ABS(ST_Y(ca.geom::geometry) - (SELECT lat FROM building_location)) * 111320
      ) as approx_distance
    FROM campaign_addresses ca
    LEFT JOIN building_address_links l 
      ON l.address_id = ca.id 
      AND l.campaign_id = p_campaign_id
    WHERE ca.campaign_id = p_campaign_id
      AND l.id IS NULL  -- Not linked to any building
  )
  SELECT 
    addr_id,
    addr_formatted,
    addr_house_number,
    addr_street_name,
    approx_distance,
    addr_geom
  FROM unlinked
  WHERE approx_distance <= p_radius_meters
  ORDER BY approx_distance ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_nearby_unlinked_addresses IS 
  'Find addresses near a building that are not yet linked to any building. Used for manual address assignment.';
