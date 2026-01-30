-- Create View for Map Visualization
-- Standard View (recommended for dynamic data that updates frequently)
-- If buildings are mostly static, consider Materialized View with pg_cron refresh

-- Decision: Use Standard View for dynamic data
-- PostGIS standard views are fast with proper indexes on underlying table
-- Always reflects latest data (status changes, campaign assignments)
-- No refresh overhead

CREATE OR REPLACE VIEW map_buildings_viz AS
SELECT 
    id,
    gers_id,
    gers_id_uuid,  -- Support shadow column during UUID migration
    geom,
    centroid,
    height,
    height_m,
    levels,
    campaign_id,
    address_id,
    latest_status,
    is_hidden,
    is_townhome_row,
    units_count,
    divider_lines,
    unit_points,
    source,
    created_at,
    updated_at
FROM public.buildings
WHERE geom IS NOT NULL;

-- Indexes on underlying table make view queries fast
-- (These should already exist from buildings table, but ensure they're present)
CREATE INDEX IF NOT EXISTS idx_buildings_geom_viz ON public.buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_campaign_viz ON public.buildings (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_gers_id_viz ON public.buildings (gers_id);
CREATE INDEX IF NOT EXISTS idx_buildings_gers_id_uuid_viz ON public.buildings (gers_id_uuid) WHERE gers_id_uuid IS NOT NULL;

-- Grant permissions (same as buildings table)
GRANT SELECT ON map_buildings_viz TO authenticated;

-- Add comment
COMMENT ON VIEW map_buildings_viz IS 'View for map visualization (fill-extrusion). Always reflects latest data from buildings table. Use Materialized View if buildings are mostly static.';

-- Alternative: Materialized View (uncomment if buildings are mostly static)
-- Requires pg_cron or Database Webhook for auto-refresh
/*
CREATE MATERIALIZED VIEW map_buildings_viz AS
SELECT 
    id, gers_id, geom, centroid, height, height_m, levels,
    campaign_id, address_id, latest_status, is_hidden,
    is_townhome_row, units_count, divider_lines, unit_points
FROM public.buildings
WHERE geom IS NOT NULL;

CREATE INDEX ON map_buildings_viz USING GIST (geom);
CREATE INDEX ON map_buildings_viz (campaign_id);
CREATE INDEX ON map_buildings_viz (gers_id);

-- Set up pg_cron for auto-refresh (Supabase Dashboard → Database → Extensions → pg_cron)
-- Or use Database Webhook to trigger refresh on building updates
-- Example: SELECT cron.schedule('refresh-map-buildings', '0 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY map_buildings_viz;');
*/
