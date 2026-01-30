-- GERS ID Mapping Table for Handling Overture ID Churn
-- Overture occasionally "churns" IDs (reassigns new ID if source data changes significantly)
-- Bridge files map old GERS IDs to new GERS IDs

CREATE TABLE IF NOT EXISTS public.gers_id_mapping (
    old_gers_id uuid NOT NULL,
    new_gers_id uuid NOT NULL,
    release_date date NOT NULL,
    mapping_type text CHECK (mapping_type IN ('1:1', 'Many:1', '1:Many')), -- Track mapping complexity
    created_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (old_gers_id, release_date)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_gers_mapping_new_id ON public.gers_id_mapping(new_gers_id);
CREATE INDEX IF NOT EXISTS idx_gers_mapping_release_date ON public.gers_id_mapping(release_date);
CREATE INDEX IF NOT EXISTS idx_gers_mapping_type ON public.gers_id_mapping(mapping_type);

-- Composite index for common query pattern: find new ID for old ID in specific release
CREATE INDEX IF NOT EXISTS idx_gers_mapping_old_release ON public.gers_id_mapping(old_gers_id, release_date);

-- Add comments for documentation
COMMENT ON TABLE public.gers_id_mapping IS 'Maps old Overture GERS IDs to new GERS IDs when Overture churns IDs. Populated from Overture bridge files.';
COMMENT ON COLUMN public.gers_id_mapping.old_gers_id IS 'Previous GERS ID (before churn)';
COMMENT ON COLUMN public.gers_id_mapping.new_gers_id IS 'New GERS ID (after churn)';
COMMENT ON COLUMN public.gers_id_mapping.release_date IS 'Overture release date when the mapping was created';
COMMENT ON COLUMN public.gers_id_mapping.mapping_type IS 'Type of mapping: 1:1 (simple rename), Many:1 (merge), 1:Many (split)';

-- Function to update GERS IDs from mapping table
CREATE OR REPLACE FUNCTION update_gers_ids_from_mapping()
RETURNS TABLE(updated_buildings int, updated_addresses int, total_updated int) AS $$
DECLARE
    v_buildings_count int;
    v_addresses_count int;
BEGIN
    -- Update buildings table
    UPDATE buildings b
    SET gers_id = m.new_gers_id,
        updated_at = now()
    FROM gers_id_mapping m
    WHERE b.gers_id = m.old_gers_id
      AND NOT EXISTS (
        -- Prevent updating if new_gers_id already exists (would cause unique constraint violation)
        SELECT 1 FROM buildings b2 WHERE b2.gers_id = m.new_gers_id AND b2.id != b.id
      );
    
    GET DIAGNOSTICS v_buildings_count = ROW_COUNT;
    
    -- Update campaign_addresses table
    UPDATE campaign_addresses ca
    SET source_id = m.new_gers_id
    FROM gers_id_mapping m
    WHERE ca.source_id = m.old_gers_id;
    
    GET DIAGNOSTICS v_addresses_count = ROW_COUNT;
    
    -- Update map_buildings table if it still exists
    -- Note: This will be removed after table consolidation
    UPDATE map_buildings mb
    SET source_id = m.new_gers_id
    FROM gers_id_mapping m
    WHERE mb.source_id = m.old_gers_id;
    
    RETURN QUERY SELECT v_buildings_count, v_addresses_count, v_buildings_count + v_addresses_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_gers_ids_from_mapping() IS 'Updates all buildings and campaign_addresses with new GERS IDs from mapping table. Returns counts of updated records.';

-- Note: Updating primary keys (gers_id) in Postgres is essentially DELETE + INSERT
-- Ensure autovacuum is tuned for high-volume updates (see autovacuum tuning migration)
