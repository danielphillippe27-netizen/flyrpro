-- MotherDuck SQL Views for Overture Buildings Pipeline
-- Creates three progressive views: raw → clean → render_ready
-- These views process Overture building footprints for Supabase import

-- Configuration (adjust as needed)
SET s3_region='us-west-2';
-- Overture release version
SET overture_release='2025-12-17.0';
SET buildings_bucket=CONCAT('s3://overturemaps-us-west-2/release/', overture_release, '/theme=buildings/type=building/*');

-- ============================================================================
-- View 1: md_buildings_raw
-- Ingests all buildings from Overture S3, no filtering
-- Uses bbox overlap logic (not "fully inside")
-- ============================================================================

CREATE OR REPLACE VIEW md_buildings_raw AS
SELECT 
    id as source_id,
    geometry as geom_raw, -- Original geometry from Overture
    bbox.xmin as bbox_minx,
    bbox.ymin as bbox_miny,
    bbox.xmax as bbox_maxx,
    bbox.ymax as bbox_maxy,
    height,
    CASE 
        WHEN height IS NOT NULL AND height > 0 THEN CEIL(height / 3.0)::INTEGER
        ELSE 2
    END as levels,
    -- Store raw geometry as WKB for later processing
    ST_AsWKB(geometry) as geom_wkb_raw
FROM read_parquet(buildings_bucket)
WHERE 
    -- BBox overlap logic: building bbox overlaps query bbox
    -- This ensures we get buildings that intersect, not just fully contained
    -- Note: This view doesn't filter by bbox - that's done when querying the view
    geometry IS NOT NULL
    AND bbox.xmin IS NOT NULL 
    AND bbox.ymin IS NOT NULL 
    AND bbox.xmax IS NOT NULL 
    AND bbox.ymax IS NOT NULL;

-- ============================================================================
-- View 2: md_buildings_clean
-- Validates geometries, normalizes to MultiPolygon, applies heuristics
-- ============================================================================

CREATE OR REPLACE VIEW md_buildings_clean AS
SELECT 
    source_id,
    -- Normalize to MultiPolygon: wrap single Polygons, preserve existing MultiPolygons
    CASE 
        WHEN ST_GeometryType(geom_raw) = 'POLYGON' THEN
            ST_Multi(geom_raw)
        WHEN ST_GeometryType(geom_raw) = 'MULTIPOLYGON' THEN
            geom_raw
        ELSE
            -- Try to make valid and convert
            ST_Multi(ST_MakeValid(geom_raw))
    END as geom_multipolygon,
    -- Validate geometry
    ST_IsValid(
        CASE 
            WHEN ST_GeometryType(geom_raw) = 'POLYGON' THEN
                ST_Multi(geom_raw)
            WHEN ST_GeometryType(geom_raw) = 'MULTIPOLYGON' THEN
                geom_raw
            ELSE
                ST_Multi(ST_MakeValid(geom_raw))
        END
    ) as is_valid,
    -- Fix invalid geometries
    ST_MakeValid(
        CASE 
            WHEN ST_GeometryType(geom_raw) = 'POLYGON' THEN
                ST_Multi(geom_raw)
            WHEN ST_GeometryType(geom_raw) = 'MULTIPOLYGON' THEN
                geom_raw
            ELSE
                ST_Multi(ST_MakeValid(geom_raw))
        END
    ) as geom_validated,
    -- Calculate area for filtering (in square meters, approximate)
    -- Using ST_Area with 4326 gives square degrees, approximate conversion
    ST_Area(
        ST_Transform(
            CASE 
                WHEN ST_GeometryType(geom_raw) = 'POLYGON' THEN
                    ST_Multi(geom_raw)
                WHEN ST_GeometryType(geom_raw) = 'MULTIPOLYGON' THEN
                    geom_raw
                ELSE
                    ST_Multi(ST_MakeValid(geom_raw))
            END,
            3857 -- Web Mercator for area calculation
        )
    ) as area_sqm,
    -- Calculate aspect ratio (length/width) for filtering long-skinny buildings
    -- Approximate using bounding box
    CASE 
        WHEN (bbox_maxx - bbox_minx) > 0 AND (bbox_maxy - bbox_miny) > 0 THEN
            GREATEST(
                (bbox_maxx - bbox_minx) / NULLIF(bbox_maxy - bbox_miny, 0),
                (bbox_maxy - bbox_miny) / NULLIF(bbox_maxx - bbox_minx, 0)
            )
        ELSE NULL
    END as aspect_ratio,
    bbox_minx,
    bbox_miny,
    bbox_maxx,
    bbox_maxy,
    height,
    levels
FROM md_buildings_raw
WHERE 
    -- Basic validity check on raw geometry
    geom_raw IS NOT NULL
    AND ST_IsValid(geom_raw) = TRUE
    -- Heuristic filters: drop tiny buildings and extremely long-skinny ones
    -- Minimum area: ~10 square meters (approximate, in Web Mercator units)
    AND ST_Area(
        ST_Transform(geom_raw, 3857)
    ) > 10
    -- Maximum aspect ratio: drop buildings with aspect ratio > 50 (very long and skinny)
    AND (
        (bbox_maxx - bbox_minx) = 0 OR (bbox_maxy - bbox_miny) = 0 OR
        GREATEST(
            (bbox_maxx - bbox_minx) / NULLIF(bbox_maxy - bbox_miny, 0),
            (bbox_maxy - bbox_miny) / NULLIF(bbox_maxx - bbox_minx, 0)
        ) < 50
    );

-- ============================================================================
-- View 3: md_buildings_render_ready
-- Light simplification for mobile performance, outputs WKB for Supabase
-- ============================================================================

CREATE OR REPLACE VIEW md_buildings_render_ready AS
SELECT 
    source_id,
    -- Light simplification: reduce vertex count but keep shape recognizable
    -- Tolerance: 0.00001 degrees (~1 meter at equator)
    -- This is very light - just removes redundant vertices
    ST_Simplify(geom_validated, 0.00001) as geom_simplified,
    -- Output as WKB for efficient Supabase import
    ST_AsWKB(ST_Simplify(geom_validated, 0.00001)) as geom_wkb,
    -- Recompute bbox after simplification
    ST_XMin(ST_Envelope(ST_Simplify(geom_validated, 0.00001))) as bbox_minx,
    ST_YMin(ST_Envelope(ST_Simplify(geom_validated, 0.00001))) as bbox_miny,
    ST_XMax(ST_Envelope(ST_Simplify(geom_validated, 0.00001))) as bbox_maxx,
    ST_YMax(ST_Envelope(ST_Simplify(geom_validated, 0.00001))) as bbox_maxy,
    height,
    levels,
    -- Store original area for reference
    area_sqm
FROM md_buildings_clean
WHERE 
    -- Ensure geometry is still valid after simplification
    ST_IsValid(ST_Simplify(geom_validated, 0.00001)) = TRUE
    -- Ensure it's still a MultiPolygon
    AND ST_GeometryType(ST_Simplify(geom_validated, 0.00001)) IN ('MULTIPOLYGON', 'POLYGON');

-- ============================================================================
-- Usage Examples:
-- ============================================================================

-- Query buildings in a bounding box (bbox overlap logic):
-- SELECT * FROM md_buildings_render_ready
-- WHERE bbox_maxx >= -79.4 AND bbox_minx <= -79.3
--   AND bbox_maxy >= 43.6 AND bbox_miny <= 43.7;

-- Get WKB for Supabase import:
-- SELECT source_id, geom_wkb, height, levels, bbox_minx, bbox_miny, bbox_maxx, bbox_maxy
-- FROM md_buildings_render_ready
-- WHERE bbox_maxx >= ? AND bbox_minx <= ?
--   AND bbox_maxy >= ? AND bbox_miny <= ?;
