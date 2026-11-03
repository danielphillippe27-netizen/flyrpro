-- Protect new assignments without deleting or arbitrarily repairing historical conflicts.
BEGIN;
CREATE INDEX IF NOT EXISTS campaign_parcel_owner_external_lookup ON public.campaign_parcels(campaign_id,lower(external_id));
CREATE INDEX IF NOT EXISTS campaign_parcel_owner_id_lookup ON public.campaign_parcels(campaign_id,lower(id::text));
CREATE INDEX IF NOT EXISTS campaign_parcel_owner_link_lookup ON public.campaign_address_parcel_links(campaign_id,lower(parcel_id));
CREATE OR REPLACE FUNCTION public.campaign_parcel_owner_key(p_campaign uuid, p_parcel text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT lower(external_id) FROM public.campaign_parcels
    WHERE campaign_id=p_campaign AND (lower(id::text)=lower(p_parcel) OR lower(external_id)=lower(p_parcel))
    ORDER BY id LIMIT 1), lower(p_parcel));
$$;
CREATE OR REPLACE FUNCTION public.guard_single_canonical_parcel_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE target text; aliases text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id::text, 731));
  target := public.campaign_parcel_owner_key(NEW.campaign_id, NEW.parcel_id);
  SELECT array_append(coalesce(array_agg(lower(id::text)), '{}'::text[]), target) INTO aliases
    FROM public.campaign_parcels WHERE campaign_id=NEW.campaign_id AND lower(external_id)=target;
  IF TG_OP='UPDATE' THEN
    IF NEW.campaign_id=OLD.campaign_id AND NEW.address_id=OLD.address_id
       AND target=public.campaign_parcel_owner_key(OLD.campaign_id, OLD.parcel_id) THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.campaign_address_parcel_links l
      WHERE l.campaign_id=NEW.campaign_id AND l.address_id<>NEW.address_id
        AND lower(l.parcel_id)=ANY(aliases))
     OR EXISTS (SELECT 1 FROM public.campaign_map_edit_states s, jsonb_each(s.features) e
      WHERE s.campaign_id=NEW.campaign_id AND e.key LIKE 'address:%'
        AND e.key<>'address:'||lower(NEW.address_id::text)
        AND coalesce((e.value->>'hidden')::boolean,false)=false
        AND (e.value->>'parcelLinkSet')::boolean=true
        AND public.campaign_parcel_owner_key(NEW.campaign_id,e.value->>'parcelId')=target) THEN
    RAISE EXCEPTION 'This parcel already has an address. Unlink it before assigning another.' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER single_canonical_parcel_owner BEFORE INSERT OR UPDATE ON public.campaign_address_parcel_links
FOR EACH ROW EXECUTE FUNCTION public.guard_single_canonical_parcel_owner();

CREATE OR REPLACE FUNCTION public.guard_single_overlay_parcel_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE previous jsonb; item text; v jsonb; target text; address_key text; aliases text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id::text, 731));
  previous := CASE WHEN TG_OP='UPDATE' THEN OLD.features ELSE '{}'::jsonb END;
  FOR item IN SELECT key FROM jsonb_object_keys(previous || NEW.features) AS keys(key)
      WHERE key LIKE 'address:%' AND previous->key IS DISTINCT FROM NEW.features->key LOOP
    address_key := substring(item FROM 9);
    v := NEW.features->item;
    IF coalesce((v->>'hidden')::boolean,false) THEN CONTINUE; END IF;
    IF coalesce((v->>'parcelLinkSet')::boolean,false) THEN target := v->>'parcelId';
    ELSE SELECT parcel_id INTO target FROM public.campaign_address_parcel_links
      WHERE campaign_id=NEW.campaign_id AND lower(address_id::text)=address_key; END IF;
    target := public.campaign_parcel_owner_key(NEW.campaign_id,target);
    IF target IS NULL THEN CONTINUE; END IF;
    SELECT array_append(coalesce(array_agg(lower(id::text)), '{}'::text[]), target) INTO aliases
      FROM public.campaign_parcels WHERE campaign_id=NEW.campaign_id AND lower(external_id)=target;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT lower(l.address_id::text) AS address_id,
          CASE WHEN coalesce((e.v->>'hidden')::boolean,false) THEN NULL
            WHEN coalesce((e.v->>'parcelLinkSet')::boolean,false) THEN e.v->>'parcelId'
            ELSE l.parcel_id END AS parcel_id
        FROM public.campaign_address_parcel_links l
        CROSS JOIN LATERAL (SELECT NEW.features->('address:'||lower(l.address_id::text)) AS v) e
        WHERE l.campaign_id=NEW.campaign_id AND lower(l.parcel_id)=ANY(aliases)
        UNION ALL
        SELECT substring(e.key FROM 9), e.value->>'parcelId' FROM jsonb_each(NEW.features) e
          WHERE e.key LIKE 'address:%' AND (e.value->>'parcelLinkSet')::boolean=true
            AND NOT coalesce((e.value->>'hidden')::boolean,false)
      ) owners WHERE owners.address_id<>address_key
        AND public.campaign_parcel_owner_key(NEW.campaign_id,owners.parcel_id)=target
    ) THEN
      RAISE EXCEPTION 'This parcel already has an address. Unlink it before assigning another.' USING ERRCODE='23505';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER single_overlay_parcel_owner BEFORE INSERT OR UPDATE ON public.campaign_map_edit_states
FOR EACH ROW EXECUTE FUNCTION public.guard_single_overlay_parcel_owner();
REVOKE ALL ON FUNCTION public.campaign_parcel_owner_key(uuid,text), public.guard_single_canonical_parcel_owner(), public.guard_single_overlay_parcel_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_parcel_owner_key(uuid,text), public.guard_single_canonical_parcel_owner(), public.guard_single_overlay_parcel_owner() TO service_role;
COMMIT;
