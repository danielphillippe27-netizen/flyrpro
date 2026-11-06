-- Prevention only: historical assignments and user-confirmed multi-address groups
-- are retained. Cleanup must be reviewed separately.
BEGIN;

CREATE OR REPLACE FUNCTION public.strict_building_key(p_id text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT regexp_replace(lower(coalesce((SELECT gers_id FROM public.buildings
    WHERE id = CASE WHEN p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_id::uuid ELSE NULL END
       OR gers_id = p_id OR gers_id = regexp_replace(p_id, '^overture:building:', '')
    LIMIT 1), p_id)), '^overture:building:', '');
$$;

-- Resolve aliases once per write, rather than looking up every campaign link's
-- identity separately. Both canonical and row-ID occupancy use indexed lookups.
CREATE OR REPLACE FUNCTION public.strict_building_aliases(p_id text)
RETURNS text[] LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH key AS (SELECT public.strict_building_key(p_id) AS id)
  SELECT array_remove(ARRAY[lower(p_id), key.id, 'overture:building:' || key.id,
    (SELECT id::text FROM public.buildings WHERE gers_id = key.id OR gers_id = 'overture:building:' || key.id LIMIT 1)], NULL)
  FROM key;
$$;
CREATE INDEX IF NOT EXISTS strict_link_building_occupancy ON public.building_address_links(campaign_id, lower(building_id));
CREATE INDEX IF NOT EXISTS strict_gold_building_occupancy ON public.campaign_addresses(campaign_id, lower(building_gers_id));
CREATE INDEX IF NOT EXISTS strict_gold_building_row_occupancy ON public.campaign_addresses(campaign_id, lower(building_id::text));

CREATE OR REPLACE FUNCTION public.guard_strict_automatic_building_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target text; aliases text[]; address_row public.campaign_addresses;
BEGIN
  -- Use the same lock as the reconciliation writer, for manual and automatic writes.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id::text, 0));
  IF NEW.match_type = 'manual' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.match_type = 'manual' OR OLD.user_confirmed IS TRUE OR OLD.locked IS TRUE THEN
      RAISE EXCEPTION 'Automatic linking cannot overwrite a confirmed assignment' USING ERRCODE = '23514';
    END IF;
    IF NEW.campaign_id <> OLD.campaign_id OR NEW.address_id <> OLD.address_id OR
       public.strict_building_key(NEW.building_id) IS DISTINCT FROM public.strict_building_key(OLD.building_id) THEN
      RAISE EXCEPTION 'Automatic linking cannot reassign an existing address' USING ERRCODE = '23514';
    END IF;
    -- Permit metadata refresh of the same historical association, including
    -- existing multi-address groups, without accepting an additional address.
    RETURN NEW;
  END IF;
  target := public.strict_building_key(NEW.building_id);
  aliases := public.strict_building_aliases(NEW.building_id);
  SELECT * INTO address_row FROM public.campaign_addresses
    WHERE campaign_id = NEW.campaign_id AND id = NEW.address_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Address does not belong to campaign' USING ERRCODE = '23514'; END IF;
  IF coalesce(address_row.match_source, '') ~* 'manual|field_' OR coalesce(address_row.source, '') ~* 'manual|field_' THEN
    RAISE EXCEPTION 'Automatic linking cannot claim a manual address' USING ERRCODE = '23514';
  END IF;
  IF (address_row.building_id IS NOT NULL AND lower(address_row.building_id::text) <> ALL(aliases))
     OR (address_row.building_gers_id IS NOT NULL AND lower(address_row.building_gers_id) <> ALL(aliases))
     OR EXISTS (SELECT 1 FROM public.building_address_links l WHERE l.campaign_id = NEW.campaign_id
       AND (l.address_id = NEW.address_id OR lower(l.building_id) = ANY(aliases)))
     OR EXISTS (SELECT 1 FROM public.campaign_addresses a WHERE a.campaign_id = NEW.campaign_id AND a.id <> NEW.address_id
       AND (lower(a.building_id::text) = ANY(aliases) OR lower(a.building_gers_id) = ANY(aliases))) THEN
    RAISE EXCEPTION 'Automatic linking requires an unlinked address and an unlinked building' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strict_automatic_building_link BEFORE INSERT OR UPDATE OF campaign_id, address_id, building_id, match_type ON public.building_address_links
FOR EACH ROW EXECUTE FUNCTION public.guard_strict_automatic_building_link();

CREATE OR REPLACE FUNCTION public.guard_strict_automatic_gold_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target text; aliases text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id::text, 0));
  -- Unlinking remains available to the existing manual editing workflow.
  IF NEW.building_id IS NULL AND NEW.building_gers_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.match_source, '') ~* 'manual|field_' THEN RETURN NEW; END IF;
  IF coalesce(NEW.source, '') ~* 'manual|field_' THEN
    RAISE EXCEPTION 'Automatic linking cannot claim a manual address' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF coalesce(OLD.match_source, '') ~* 'manual|field_' AND NEW.match_source IS DISTINCT FROM OLD.match_source THEN
      RAISE EXCEPTION 'Automatic linking cannot overwrite a manual assignment' USING ERRCODE = '23514';
    END IF;
    IF NEW.building_id IS NOT DISTINCT FROM OLD.building_id AND NEW.building_gers_id IS NOT DISTINCT FROM OLD.building_gers_id THEN RETURN NEW; END IF;
    IF OLD.building_id IS NOT NULL OR OLD.building_gers_id IS NOT NULL OR
       coalesce(OLD.match_source, '') ~* 'manual|field_' THEN
      RAISE EXCEPTION 'Automatic linking cannot reassign an existing address' USING ERRCODE = '23514';
    END IF;
  END IF;
  target := public.strict_building_key(coalesce(NEW.building_gers_id, NEW.building_id::text));
  aliases := public.strict_building_aliases(coalesce(NEW.building_gers_id, NEW.building_id::text));
  IF EXISTS (SELECT 1 FROM public.building_address_links l WHERE l.campaign_id = NEW.campaign_id
       AND ((l.address_id <> NEW.id AND lower(l.building_id) = ANY(aliases))
         OR (l.address_id = NEW.id AND lower(l.building_id) <> ALL(aliases))))
     OR EXISTS (SELECT 1 FROM public.campaign_addresses a WHERE a.campaign_id = NEW.campaign_id AND a.id <> NEW.id
       AND (lower(a.building_id::text) = ANY(aliases) OR lower(a.building_gers_id) = ANY(aliases))) THEN
    RAISE EXCEPTION 'Automatic linking cannot add an address to an occupied building' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER strict_automatic_gold_link BEFORE INSERT OR UPDATE OF building_id, building_gers_id ON public.campaign_addresses
FOR EACH ROW EXECUTE FUNCTION public.guard_strict_automatic_gold_link();

-- Save the link table and Gold mirrors together. No fallback to nontransactional
-- persistence is allowed if this RPC is unavailable.
CREATE OR REPLACE FUNCTION public.save_strict_automatic_links(p_campaign_id uuid, p_records jsonb, p_write_gold boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item jsonb; record public.building_address_links; saved integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  IF jsonb_typeof(p_records) <> 'array' THEN RAISE EXCEPTION 'Expected an array of links'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_records) e GROUP BY e->>'address_id' HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_records) e GROUP BY public.strict_building_key(e->>'building_id') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Automatic link batch must be one-to-one' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    record := jsonb_populate_record(NULL::public.building_address_links, item);
    IF record.campaign_id IS DISTINCT FROM p_campaign_id OR record.match_type IS NULL OR record.match_type NOT IN
       ('containment_verified','containment_suspect','parcel_verified','proximity_verified','point_on_surface') THEN
      RAISE EXCEPTION 'Invalid automatic link record' USING ERRCODE = '23514';
    END IF;
    -- Retries may repeat the same pair, but never overwrite its metadata or
    -- choose a different house. Triggers validate all genuinely new claims.
    IF EXISTS (SELECT 1 FROM public.building_address_links l WHERE l.campaign_id = p_campaign_id
      AND l.address_id = record.address_id AND public.strict_building_key(l.building_id) = public.strict_building_key(record.building_id)) THEN CONTINUE; END IF;
    INSERT INTO public.building_address_links (campaign_id, building_id, address_id, match_type, confidence,
      distance_meters, street_match_score, building_area_sqm, building_class, building_height,
      is_multi_unit, unit_count, unit_arrangement, overture_release, linker_version)
    VALUES (p_campaign_id, record.building_id, record.address_id, record.match_type, record.confidence,
      record.distance_meters, record.street_match_score, record.building_area_sqm, record.building_class,
      record.building_height, false, 1, 'single', record.overture_release, 3);
    IF NOT FOUND THEN RAISE EXCEPTION 'Automatic link rejected by a quality guard' USING ERRCODE = '23514'; END IF;
    IF p_write_gold THEN
      UPDATE public.campaign_addresses SET
        building_id = CASE WHEN record.building_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN record.building_id::uuid ELSE NULL END,
        building_gers_id = record.building_id,
        match_source = CASE record.match_type WHEN 'parcel_verified' THEN 'gold_parcel'
          WHEN 'containment_verified' THEN 'gold_exact' WHEN 'containment_suspect' THEN 'gold_exact' ELSE 'strict_proximity' END,
        confidence = record.confidence
      WHERE campaign_id = p_campaign_id AND id = record.address_id;
    END IF;
    DELETE FROM public.address_orphans WHERE campaign_id = p_campaign_id AND address_id = record.address_id;
    saved := saved + 1;
  END LOOP;
  RETURN saved;
END $$;

-- Older SQL linkers call this destructive reset before matching. Fail closed
-- before they can erase assignments or run their permissive matching passes.
CREATE OR REPLACE FUNCTION public.clear_campaign_building_links(p_campaign_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Legacy resetting linker disabled; use the strict additive backend linker';
END $$;

-- The global reconciliation core used to delete and rebuild existing claims.
-- Preserve its proven write/audit machinery, but require genuinely empty pairs.
ALTER FUNCTION public.apply_global_reverse_assignment_core(uuid,uuid,jsonb,text) RENAME TO apply_global_reverse_assignment_unlinked_core;
CREATE FUNCTION public.apply_global_reverse_assignment_core(p_campaign_id uuid, p_run_id uuid, p_assignments jsonb, p_algorithm_version text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) e
      JOIN public.building_address_links l ON l.campaign_id = p_campaign_id
        AND (l.address_id = (e->>'address_id')::uuid OR public.strict_building_key(l.building_id) = public.strict_building_key(e->>'building_id')))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_assignments) e
      JOIN public.campaign_addresses a ON a.campaign_id = p_campaign_id
        AND ((a.id = (e->>'address_id')::uuid AND (a.building_id IS NOT NULL OR a.building_gers_id IS NOT NULL))
          OR public.strict_building_key(a.building_id::text) = public.strict_building_key(e->>'building_id')
          OR public.strict_building_key(a.building_gers_id) = public.strict_building_key(e->>'building_id'))) THEN
    RAISE EXCEPTION 'Reconciliation requires unlinked pairs; existing assignments require reviewed cleanup' USING ERRCODE = '23514';
  END IF;
  RETURN public.apply_global_reverse_assignment_unlinked_core(p_campaign_id, p_run_id, p_assignments, p_algorithm_version);
END $$;
-- Recreate the public entrypoint too, invalidating cached calls to the renamed core.
CREATE OR REPLACE FUNCTION public.apply_global_reverse_assignment(p_campaign_id uuid, p_run_id uuid, p_assignments jsonb, p_algorithm_version text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE applied integer;
BEGIN
  applied := public.apply_global_reverse_assignment_core(p_campaign_id,p_run_id,p_assignments,p_algorithm_version);
  PERFORM public.sync_campaign_address_orphans(p_campaign_id);
  RETURN applied;
END $$;
REVOKE ALL ON FUNCTION public.apply_global_reverse_assignment(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_global_reverse_assignment(uuid,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_global_reverse_assignment_unlinked_core(uuid,uuid,jsonb,text) FROM PUBLIC, authenticated, service_role;
REVOKE ALL ON FUNCTION public.strict_building_key(text), public.strict_building_aliases(text), public.guard_strict_automatic_building_link(), public.guard_strict_automatic_gold_link(), public.save_strict_automatic_links(uuid,jsonb,boolean), public.apply_global_reverse_assignment_core(uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.strict_building_key(text), public.strict_building_aliases(text), public.save_strict_automatic_links(uuid,jsonb,boolean), public.apply_global_reverse_assignment_core(uuid,uuid,jsonb,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
