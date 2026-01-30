-- Autovacuum Tuning for High-Volume Updates
-- Critical for Phase 4 (Bridge Files) which involves bulk updates to primary key columns
-- Updating primary keys (gers_id) in Postgres is essentially DELETE + INSERT
-- Aggressive autovacuum prevents table bloat from bridge file updates

-- Tune autovacuum for buildings table (high-volume updates from bridge files)
ALTER TABLE public.buildings SET (
    autovacuum_vacuum_scale_factor = 0.05,  -- More aggressive (default 0.2)
    autovacuum_analyze_scale_factor = 0.02, -- More frequent analysis (default 0.1)
    autovacuum_vacuum_cost_delay = 10       -- Lower delay (default 20ms)
);

-- Tune for gers_id_mapping table (frequent inserts)
ALTER TABLE public.gers_id_mapping SET (
    autovacuum_vacuum_scale_factor = 0.1,
    autovacuum_analyze_scale_factor = 0.05
);

-- Tune for campaign_addresses table (updates from bridge files)
ALTER TABLE public.campaign_addresses SET (
    autovacuum_vacuum_scale_factor = 0.1,
    autovacuum_analyze_scale_factor = 0.05
);

-- Tune for map_buildings table (if still exists before consolidation)
ALTER TABLE IF EXISTS public.map_buildings SET (
    autovacuum_vacuum_scale_factor = 0.1,
    autovacuum_analyze_scale_factor = 0.05
);

-- Add comments for documentation
COMMENT ON TABLE public.buildings IS 'Autovacuum tuned for high-volume updates from GERS ID bridge files. Updating primary keys causes DELETE + INSERT operations.';
COMMENT ON TABLE public.gers_id_mapping IS 'Autovacuum tuned for frequent inserts from bridge file imports.';
