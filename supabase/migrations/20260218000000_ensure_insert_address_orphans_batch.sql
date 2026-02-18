-- Ensure insert_address_orphans_batch exists (idempotent)
-- Fixes: "Could not find the function public.insert_address_orphans_batch(p_campaign_id, p_rows) in the schema cache"
-- Required by StableLinkerService when saving address orphans from spatial join.

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

COMMENT ON FUNCTION public.insert_address_orphans_batch IS 'Batch insert address_orphans with coordinate from lon/lat (Gold Standard spatial join). Used by StableLinkerService.';
