-- Gold Standard: address_orphans coordinate, suggested_street, and extended status
-- For map display without joining campaign_addresses; suggested_street for reverse geocode; ambiguous_match for tie/conflict orphans.

-- Add coordinate (Point) for map display
ALTER TABLE address_orphans
  ADD COLUMN IF NOT EXISTS coordinate geometry(Point, 4326);

-- Add suggested_street (reverse geocode or address.street_name initially)
ALTER TABLE address_orphans
  ADD COLUMN IF NOT EXISTS suggested_street text;

-- Extend status to include pending_review and ambiguous_match
ALTER TABLE address_orphans
  DROP CONSTRAINT IF EXISTS address_orphans_status_check;

ALTER TABLE address_orphans
  ADD CONSTRAINT address_orphans_status_check
  CHECK (status IN ('pending', 'pending_review', 'assigned', 'dismissed', 'ambiguous_match'));

COMMENT ON COLUMN address_orphans.coordinate IS 'Point geometry for map display (lon, lat)';
COMMENT ON COLUMN address_orphans.suggested_street IS 'Reverse-geocoded or address street name for reviewer context';

-- RPC to batch-insert orphans with coordinate (PostGIS Point from lon/lat)
CREATE OR REPLACE FUNCTION public.insert_address_orphans_batch(
  p_campaign_id uuid,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO public.address_orphans (
      campaign_id,
      address_id,
      nearest_building_id,
      nearest_distance,
      nearest_building_street,
      address_street,
      street_match_score,
      suggested_buildings,
      status,
      suggested_street,
      coordinate
    )
    VALUES (
      p_campaign_id,
      (r->>'address_id')::uuid,
      nullif(r->>'nearest_building_id', ''),
      (r->>'nearest_distance')::float,
      nullif(r->>'nearest_building_street', ''),
      nullif(r->>'address_street', ''),
      (r->>'street_match_score')::float,
      COALESCE(r->'suggested_buildings', '[]'::jsonb),
      COALESCE(nullif(r->>'status', ''), 'pending_review'),
      nullif(r->>'suggested_street', ''),
      CASE
        WHEN r ? 'lon' AND r ? 'lat' THEN ST_SetSRID(ST_MakePoint((r->>'lon')::double precision, (r->>'lat')::double precision), 4326)
        ELSE NULL
      END
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.insert_address_orphans_batch IS 'Batch insert address_orphans with coordinate from lon/lat (Gold Standard spatial join)';
