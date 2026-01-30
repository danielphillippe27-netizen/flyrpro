-- Stable Linker Architecture: Schema and indexes for building_address_links and campaign_map_features_v
-- Part 1: Spatial indexes, link table, unified view for map

-- 1. Spatial indexes for nearest-neighbor and bbox queries (create only if not present)
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_geom ON public.campaign_addresses USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_geom ON public.buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_centroid ON public.buildings USING GIST (centroid);

-- 2. Link table: one row per (campaign, address) with building match and provenance
CREATE TABLE IF NOT EXISTS public.building_address_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
    building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    method text, -- 'COVERS', 'BUFFER', 'NEAREST'
    confidence float,
    distance_m float,
    is_primary boolean DEFAULT true,
    created_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (campaign_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_building_address_links_campaign_id ON public.building_address_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_building_address_links_building_id ON public.building_address_links(building_id);
CREATE INDEX IF NOT EXISTS idx_building_address_links_address_id ON public.building_address_links(address_id);

-- Partial unique index: one primary link per address per campaign
CREATE UNIQUE INDEX IF NOT EXISTS uniq_primary_link
ON public.building_address_links (campaign_id, address_id)
WHERE is_primary;

COMMENT ON TABLE public.building_address_links IS 'Stable linker: records how each address was matched to a building (COVERS/NEAREST) with confidence and distance. One primary link per address per campaign.';

-- 3. Unified map view: buildings + optional link + address for Mapbox
CREATE OR REPLACE VIEW public.campaign_map_features_v AS
SELECT
    b.id AS feature_id,
    b.campaign_id,
    b.geom AS display_geom,
    b.height_m,
    b.gers_id,
    ca.formatted AS address_text,
    ca.house_number,
    l.method AS match_method,
    l.confidence,
    CASE
        WHEN l.id IS NOT NULL THEN 'matched'
        ELSE 'orphan_building'
    END AS feature_status
FROM public.buildings b
LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id;

COMMENT ON VIEW public.campaign_map_features_v IS 'Unified map view: buildings with optional link and address. feature_status: matched (red) vs orphan_building (grey). Used by rpc_get_campaign_map_features for GeoJSON.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
