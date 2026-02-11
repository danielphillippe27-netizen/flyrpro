-- Gold Standard: Enhanced Building-Address Link Schema
-- 4-Tier Spatial Matching with Quality Assurance

-- Drop and recreate building_address_links with enhanced schema
DROP TABLE IF EXISTS address_orphans CASCADE;
DROP TABLE IF EXISTS building_address_links CASCADE;

CREATE TABLE building_address_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  building_id text NOT NULL,  -- Overture GERS ID
  address_id uuid REFERENCES campaign_addresses(id) ON DELETE CASCADE,
  
  -- Match quality
  match_type text CHECK (match_type IN (
    'containment_verified',    -- Tier 1: Containment + street match
    'containment_suspect',     -- Tier 1b: Containment, street mismatch
    'point_on_surface',        -- Tier 2: Point on building boundary
    'proximity_verified',      -- Tier 3: Close + street match
    'proximity_fallback',      -- Tier 4: Close only
    'manual',                  -- User-assigned
    'orphan'                   -- No match found
  )),
  confidence float CHECK (confidence >= 0 AND confidence <= 1),
  distance_meters float,
  street_match_score float,  -- 0-1 similarity
  
  -- Building metadata at time of match
  building_area_sqm float,
  building_class text,
  building_height float,
  is_multi_unit boolean DEFAULT false,
  unit_count integer DEFAULT 1,
  unit_arrangement text CHECK (unit_arrangement IN ('single', 'horizontal', 'vertical')),
  
  -- Provenance
  overture_release text,
  matched_at timestamp DEFAULT now(),
  modified_at timestamp,
  
  UNIQUE(campaign_id, address_id)  -- One match per address
);

-- Indexes for performance
CREATE INDEX idx_links_campaign ON building_address_links(campaign_id);
CREATE INDEX idx_links_building ON building_address_links(building_id);
CREATE INDEX idx_links_address ON building_address_links(address_id);
CREATE INDEX idx_links_match_type ON building_address_links(match_type);
CREATE INDEX idx_links_confidence ON building_address_links(confidence);

-- Orphan Queue for manual review
CREATE TABLE address_orphans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  address_id uuid UNIQUE REFERENCES campaign_addresses(id) ON DELETE CASCADE,
  
  -- Context for reviewer
  nearest_building_id text,
  nearest_distance float,
  nearest_building_street text,
  address_street text,
  street_match_score float,
  
  -- Suggestions (top 3 candidates)
  suggested_buildings jsonb DEFAULT '[]',  -- [{building_id, distance, street_score, confidence}, ...]
  
  -- Resolution
  status text CHECK (status IN ('pending', 'assigned', 'dismissed')) DEFAULT 'pending',
  assigned_building_id text,
  assigned_by uuid,
  assigned_at timestamp,
  
  created_at timestamp DEFAULT now()
);

CREATE INDEX idx_orphans_campaign ON address_orphans(campaign_id, status);
CREATE INDEX idx_orphans_address ON address_orphans(address_id);

-- Trigger to update modified_at on link changes
CREATE OR REPLACE FUNCTION update_link_modified_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modified_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_link_modified_at
  BEFORE UPDATE ON building_address_links
  FOR EACH ROW
  EXECUTE FUNCTION update_link_modified_at();

-- View for campaign matching quality report
CREATE OR REPLACE VIEW campaign_match_quality AS
SELECT 
  campaign_id,
  COUNT(*) FILTER (WHERE match_type = 'containment_verified') as containment_verified,
  COUNT(*) FILTER (WHERE match_type = 'containment_suspect') as containment_suspect,
  COUNT(*) FILTER (WHERE match_type = 'point_on_surface') as point_on_surface,
  COUNT(*) FILTER (WHERE match_type = 'proximity_verified') as proximity_verified,
  COUNT(*) FILTER (WHERE match_type = 'proximity_fallback') as proximity_fallback,
  COUNT(*) FILTER (WHERE match_type = 'manual') as manual,
  COUNT(*) FILTER (WHERE match_type = 'orphan') as orphan,
  COUNT(*) as total,
  AVG(confidence) FILTER (WHERE match_type != 'orphan') as avg_confidence,
  AVG(distance_meters) FILTER (WHERE match_type != 'orphan') as avg_distance
FROM building_address_links
GROUP BY campaign_id;

-- Function to get matches with building details
CREATE OR REPLACE FUNCTION get_campaign_matches(p_campaign_id uuid)
RETURNS TABLE (
  link_id uuid,
  address_id uuid,
  building_id text,
  match_type text,
  confidence float,
  distance_meters float,
  building_area_sqm float,
  is_multi_unit boolean,
  unit_count integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id,
    l.address_id,
    l.building_id,
    l.match_type,
    l.confidence,
    l.distance_meters,
    l.building_area_sqm,
    l.is_multi_unit,
    l.unit_count
  FROM building_address_links l
  WHERE l.campaign_id = p_campaign_id
  ORDER BY l.confidence DESC, l.distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get orphans for manual review
CREATE OR REPLACE FUNCTION get_campaign_orphans(p_campaign_id uuid)
RETURNS TABLE (
  orphan_id uuid,
  address_id uuid,
  nearest_building_id text,
  nearest_distance float,
  street_match_score float,
  suggested_buildings jsonb,
  status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.address_id,
    o.nearest_building_id,
    o.nearest_distance,
    o.street_match_score,
    o.suggested_buildings,
    o.status
  FROM address_orphans o
  WHERE o.campaign_id = p_campaign_id
    AND o.status = 'pending'
  ORDER BY o.nearest_distance ASC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE building_address_links IS 'Junction table linking addresses to buildings with match quality metrics';
COMMENT ON TABLE address_orphans IS 'Queue for addresses that could not be automatically matched to buildings';
