-- Stable townhouse sub-footprints are a prerequisite for map reconciliation.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.building_units
  ADD COLUMN IF NOT EXISTS unit_index integer,
  ADD COLUMN IF NOT EXISTS stable_key text,
  ADD COLUMN IF NOT EXISTS split_version text NOT NULL DEFAULT 'townhouse-split-v1',
  ADD COLUMN IF NOT EXISTS split_signature text,
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_units'::regclass
      AND conname = 'building_units_lifecycle_state_check'
  ) THEN
    ALTER TABLE public.building_units
      ADD CONSTRAINT building_units_lifecycle_state_check
      CHECK (lifecycle_state IN ('active', 'superseded'));
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY campaign_id, parent_building_id
      ORDER BY
        COALESCE(address_id::text, ''),
        COALESCE(unit_number, ''),
        id::text
    ) - 1 AS deterministic_index
  FROM public.building_units
)
UPDATE public.building_units AS unit
SET unit_index = ranked.deterministic_index
FROM ranked
WHERE ranked.id = unit.id
  AND unit.unit_index IS NULL;

UPDATE public.building_units
SET
  stable_key = lower(parent_building_id) || ':' || split_version || ':' || unit_index::text,
  split_signature = COALESCE(
    split_signature,
    encode(
      digest(
        lower(parent_building_id) || '|' || split_version || '|' ||
        COALESCE(address_id::text, '') || '|' || unit_index::text,
        'sha256'
      ),
      'hex'
    )
  )
WHERE stable_key IS NULL OR split_signature IS NULL;

WITH legacy_group_signatures AS (
  SELECT
    campaign_id,
    parent_building_id,
    encode(
      digest(
        lower(campaign_id::text) || '|' ||
        lower(parent_building_id) || '|' ||
        max(split_version) || '|legacy|' ||
        string_agg(
          COALESCE(address_id::text, '') || ':' || unit_index::text,
          ';'
          ORDER BY unit_index
        ),
        'sha256'
      ),
      'hex'
    ) AS signature
  FROM public.building_units
  GROUP BY campaign_id, parent_building_id
)
UPDATE public.building_units AS unit
SET split_signature = grouped.signature
FROM legacy_group_signatures AS grouped
WHERE grouped.campaign_id = unit.campaign_id
  AND grouped.parent_building_id = unit.parent_building_id;

CREATE TABLE IF NOT EXISTS public.building_unit_id_aliases (
  old_id uuid PRIMARY KEY,
  stable_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  parent_building_id text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_unit_id_aliases_stable_idx
  ON public.building_unit_id_aliases(stable_id);

ALTER TABLE public.building_unit_id_aliases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.resolve_building_unit_id(p_unit_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT alias.stable_id
      FROM public.building_unit_id_aliases AS alias
      WHERE alias.old_id = p_unit_id
    ),
    p_unit_id
  );
$$;

REVOKE ALL ON FUNCTION public.resolve_building_unit_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_building_unit_id(uuid) TO authenticated, service_role;

-- 7d8f65c2-0e52-5b70-ae4f-1ba17fdb2c1f is the fixed application namespace
-- also used by TownhouseUnitIdentity.ts.
INSERT INTO public.building_unit_id_aliases (
  old_id,
  stable_id,
  campaign_id,
  parent_building_id
)
SELECT
  unit.id,
  uuid_generate_v5(
    '7d8f65c2-0e52-5b70-ae4f-1ba17fdb2c1f'::uuid,
    lower(unit.campaign_id::text) || ':' ||
    lower(unit.parent_building_id) || ':' ||
    unit.split_version || ':' ||
    unit.unit_index::text
  ),
  unit.campaign_id,
  unit.parent_building_id
FROM public.building_units AS unit
ON CONFLICT (old_id) DO UPDATE
SET stable_id = EXCLUDED.stable_id;

DO $$
BEGIN
  IF to_regclass('public.building_split_errors') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'building_split_errors'
         AND column_name = 'created_unit_ids'
     ) THEN
    UPDATE public.building_split_errors AS split_error
    SET created_unit_ids = (
      SELECT array_agg(COALESCE(alias.stable_id, item.unit_id) ORDER BY item.ordinality)
      FROM unnest(split_error.created_unit_ids) WITH ORDINALITY AS item(unit_id, ordinality)
      LEFT JOIN public.building_unit_id_aliases AS alias
        ON alias.old_id = item.unit_id
    )
    WHERE split_error.created_unit_ids IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.session_events') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'session_events'
         AND column_name = 'payload'
     ) THEN
    UPDATE public.session_events AS event
    SET payload = jsonb_set(event.payload, '{unit_id}', to_jsonb(alias.stable_id::text), true)
    FROM public.building_unit_id_aliases AS alias
    WHERE event.payload->>'unit_id' = alias.old_id::text;
  END IF;
END $$;

UPDATE public.building_units AS unit
SET id = alias.stable_id
FROM public.building_unit_id_aliases AS alias
WHERE unit.id = alias.old_id
  AND unit.id <> alias.stable_id;

ALTER TABLE public.building_units
  ALTER COLUMN unit_index SET NOT NULL,
  ALTER COLUMN stable_key SET NOT NULL,
  ALTER COLUMN split_signature SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS building_units_stable_key_unique
  ON public.building_units(campaign_id, stable_key);

DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.building_units'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ~* '\(campaign_id, address_id\)'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.building_units DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END $$;

-- Legacy splitters could leave the same address active in more than one random
-- unit row. Preserve every row, but retain only the deterministic first row as
-- active before adding the partial uniqueness invariant.
WITH duplicate_addresses AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY campaign_id, address_id
      ORDER BY stable_key, id
    ) AS duplicate_rank
  FROM public.building_units
  WHERE lifecycle_state = 'active'
    AND address_id IS NOT NULL
)
UPDATE public.building_units AS unit
SET
  lifecycle_state = 'superseded',
  superseded_at = COALESCE(unit.superseded_at, now())
FROM duplicate_addresses AS duplicate
WHERE duplicate.id = unit.id
  AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS building_units_active_address_unique
  ON public.building_units(campaign_id, address_id)
  WHERE lifecycle_state = 'active' AND address_id IS NOT NULL;

COMMENT ON COLUMN public.building_units.stable_key IS
  'Deterministic parent footprint + split version + unit index identity.';
COMMENT ON COLUMN public.building_units.split_signature IS
  'Hash of canonical split inputs; decisions must become stale when it changes.';

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

  -- Serialize split replacement for one parent. The deterministic unique keys
  -- prevent duplicate rows; this lock also prevents interleaved supersession
  -- when two workers split the same footprint concurrently.
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
      item->'unit_geometry',
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

  -- Reconciliation evidence is bound to both the deterministic unit and the
  -- exact split inputs. A changed split must be reviewed again.
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
  'Atomically upserts deterministic active units and supersedes obsolete units without erasing visit history.';
