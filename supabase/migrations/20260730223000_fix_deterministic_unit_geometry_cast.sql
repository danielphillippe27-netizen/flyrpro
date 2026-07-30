-- Production stores building_units.unit_geometry as PostGIS geometry. The
-- deterministic upsert receives GeoJSON in p_units, so convert it explicitly
-- instead of relying on an invalid jsonb-to-geometry assignment.
CREATE OR REPLACE FUNCTION public.upsert_building_units_deterministic(
  p_campaign_id uuid,
  p_parent_building_id text,
  p_units jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_parent_building_id IS NULL OR jsonb_typeof(p_units) <> 'array' THEN
    RAISE EXCEPTION 'campaign, parent building, and unit array are required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(lower(p_campaign_id::text) || ':' || lower(p_parent_building_id), 0)
  );

  UPDATE public.building_units
  SET
    lifecycle_state = 'superseded',
    superseded_at = now()
  WHERE campaign_id = p_campaign_id
    AND parent_building_id = p_parent_building_id
    AND lifecycle_state = 'active'
    AND NOT (
      id = ANY (
        ARRAY(
          SELECT (item->>'id')::uuid
          FROM jsonb_array_elements(p_units) AS item
        )
      )
    );

  INSERT INTO public.building_units (
    id,
    campaign_id,
    parent_building_id,
    address_id,
    unit_number,
    unit_index,
    stable_key,
    split_version,
    split_signature,
    lifecycle_state,
    superseded_at,
    unit_geometry,
    parent_building_area,
    split_method,
    parent_type,
    validation_status
  )
  SELECT
    (item->>'id')::uuid,
    p_campaign_id,
    p_parent_building_id,
    NULLIF(item->>'address_id', '')::uuid,
    item->>'unit_number',
    (item->>'unit_index')::integer,
    item->>'stable_key',
    item->>'split_version',
    item->>'split_signature',
    'active',
    NULL,
    ST_SetSRID(
      ST_GeomFromGeoJSON((item->'unit_geometry')::text),
      4326
    )::geometry(Polygon, 4326),
    NULLIF(item->>'parent_building_area', '')::double precision,
    item->>'split_method',
    item->>'parent_type',
    item->>'validation_status'
  FROM jsonb_array_elements(p_units) AS item
  ON CONFLICT (id) DO UPDATE
  SET
    address_id = EXCLUDED.address_id,
    unit_number = EXCLUDED.unit_number,
    unit_index = EXCLUDED.unit_index,
    stable_key = EXCLUDED.stable_key,
    split_version = EXCLUDED.split_version,
    split_signature = EXCLUDED.split_signature,
    lifecycle_state = 'active',
    superseded_at = NULL,
    unit_geometry = EXCLUDED.unit_geometry,
    parent_building_area = EXCLUDED.parent_building_area,
    split_method = EXCLUDED.split_method,
    parent_type = EXCLUDED.parent_type,
    validation_status = EXCLUDED.validation_status;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF to_regclass('public.map_reconciliation_decisions') IS NOT NULL THEN
    EXECUTE
      'UPDATE public.map_reconciliation_decisions
       SET status = ''stale'',
           review_reason = ''Townhouse split signature changed''
       WHERE campaign_id = $1
         AND parent_building_id = $2
         AND split_signature IS NOT NULL
         AND split_signature IS DISTINCT FROM (
           SELECT item->>''split_signature''
           FROM jsonb_array_elements($3) AS item
           LIMIT 1
         )
         AND status IN (''proposed'', ''requires_review'', ''applied'')'
    USING p_campaign_id, p_parent_building_id, p_units;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_building_units_deterministic(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_building_units_deterministic(uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.upsert_building_units_deterministic(uuid, text, jsonb) IS
  'Atomically upserts deterministic units, converts GeoJSON to PostGIS geometry, and supersedes obsolete units.';
