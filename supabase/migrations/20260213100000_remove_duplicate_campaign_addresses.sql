-- Remove duplicate campaign_addresses: same campaign_id + same logical address.
-- Keeps one row per (campaign_id, normalized address), preferring the scanned (visited) row.

-- Delete duplicate rows: keep the one we want, delete the rest.
-- Normalize address by lower(trim(formatted)) and lower(trim(postal_code)).
-- Rank: 1 = keep (prefer visited, then smallest id).
WITH normalized AS (
    SELECT
        id,
        campaign_id,
        COALESCE(LOWER(TRIM(formatted)), '') AS norm_formatted,
        COALESCE(LOWER(TRIM(postal_code)), '') AS norm_postal,
        visited
    FROM public.campaign_addresses
),
ranked AS (
    SELECT
        id,
        campaign_id,
        ROW_NUMBER() OVER (
            PARTITION BY campaign_id, norm_formatted, norm_postal
            ORDER BY (visited IS TRUE) DESC, id ASC
        ) AS rn
    FROM normalized
)
DELETE FROM public.campaign_addresses
WHERE id IN (
    SELECT id FROM ranked WHERE rn > 1
);

-- Optional: add a unique index to prevent future duplicates on (campaign_id, formatted, postal_code).
-- Only create if we want to enforce at DB level (will fail inserts of duplicates).
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_formatted_postal
-- ON public.campaign_addresses(campaign_id, LOWER(TRIM(COALESCE(formatted,''))), LOWER(TRIM(COALESCE(postal_code,''))));
