BEGIN;
CREATE TABLE IF NOT EXISTS public.storm_intelligence_rollout (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 discovery_enabled boolean NOT NULL DEFAULT true,
 geometry_enabled boolean NOT NULL DEFAULT false,
 exposure_enabled boolean NOT NULL DEFAULT false,
 targeting_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.storm_events (
 event_key text PRIMARY KEY, provider_event_id text NOT NULL, hazard text NOT NULL CHECK(hazard IN ('hail','wind','tornado','hurricane')),
 source text NOT NULL, event_start timestamptz NOT NULL, event_end timestamptz NOT NULL,
 source_updated_at timestamptz NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 CHECK(event_end>=event_start)
);
CREATE TABLE IF NOT EXISTS public.storm_severity_zones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text NOT NULL REFERENCES public.storm_events(event_key) ON DELETE CASCADE,
 minimum_mm numeric NOT NULL CHECK(minimum_mm>=0),geometry jsonb NOT NULL,
 geom geometry(MultiPolygon,4326) GENERATED ALWAYS AS (ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(geometry::text),4326))) STORED,
 source_resolution_m numeric NOT NULL CHECK(source_resolution_m>0),estimation_method text NOT NULL,
 source_updated_at timestamptz NOT NULL,validated boolean NOT NULL DEFAULT false,license_verified boolean NOT NULL DEFAULT false,
 CHECK(ST_IsValid(geom)), UNIQUE(event_key,minimum_mm)
);
CREATE INDEX IF NOT EXISTS storm_severity_zones_geom_idx ON public.storm_severity_zones USING gist(geom);
CREATE TABLE IF NOT EXISTS public.storm_address_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_version text NOT NULL,
 geom geometry(MultiPolygon,4326) NOT NULL CHECK(ST_IsValid(geom)),verified_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS storm_address_coverage_geom_idx ON public.storm_address_coverage USING gist(geom);
ALTER TABLE public.storm_territories DROP CONSTRAINT IF EXISTS storm_territories_boundary_check;
ALTER TABLE public.storm_territories ADD CONSTRAINT storm_territories_boundary_check CHECK(boundary->>'type' IN ('Polygon','MultiPolygon'));
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS event_key text REFERENCES public.storm_events(event_key);
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.storm_severity_zones(id);
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS include_outside_zone boolean NOT NULL DEFAULT false;
ALTER TABLE public.storm_territories ADD COLUMN IF NOT EXISTS effective_geometry jsonb;
CREATE TABLE IF NOT EXISTS public.storm_territory_revisions (
 territory_id uuid REFERENCES public.storm_territories(id) ON DELETE CASCADE,revision integer NOT NULL,
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(territory_id,revision)
);
-- AFTER trigger allows the parent foreign key to exist before its snapshot.
CREATE OR REPLACE FUNCTION public.record_storm_territory_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO public.storm_territory_revisions(territory_id,revision,snapshot) VALUES(NEW.id,NEW.revision,to_jsonb(NEW));RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION public.bump_storm_territory_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.revision=OLD.revision+1;NEW.updated_at=now();RETURN NEW;END $$;
DROP TRIGGER IF EXISTS storm_territory_revision_bump ON public.storm_territories;
CREATE TRIGGER storm_territory_revision_bump BEFORE UPDATE ON public.storm_territories FOR EACH ROW EXECUTE FUNCTION public.bump_storm_territory_revision();
DROP TRIGGER IF EXISTS storm_territory_revision_record ON public.storm_territories;
CREATE TRIGGER storm_territory_revision_record AFTER INSERT OR UPDATE ON public.storm_territories FOR EACH ROW EXECUTE FUNCTION public.record_storm_territory_revision();
CREATE OR REPLACE FUNCTION public.storm_address_exposure(p_event_key text,p_boundary jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE threshold numeric;zone geometry;target geometry;coverage geometry;cnt bigint;counts jsonb='[]'::jsonb;versions text[];
BEGIN
 FOR threshold IN SELECT unnest(ARRAY[25.4,44.45,63.5]::numeric[]) LOOP
  SELECT ST_UnaryUnion(ST_Collect(geom)) INTO zone FROM storm_severity_zones WHERE event_key=p_event_key AND minimum_mm>=threshold AND validated AND license_verified;
  IF zone IS NULL THEN RETURN jsonb_build_object('available',false,'counts',NULL,'reason','Validated threshold geometry unavailable');END IF;
  target=CASE WHEN p_boundary IS NULL THEN zone ELSE ST_Intersection(zone,ST_SetSRID(ST_GeomFromGeoJSON(p_boundary::text),4326)) END;
  SELECT ST_UnaryUnion(ST_Collect(geom)),array_agg(DISTINCT dataset_version) INTO coverage,versions FROM storm_address_coverage WHERE geom && target;
  IF NOT ST_IsEmpty(target) AND (coverage IS NULL OR NOT ST_Covers(coverage,target)) THEN RETURN jsonb_build_object('available',false,'counts',NULL,'reason','Verified address coverage is incomplete');END IF;
  SELECT count(DISTINCT id) INTO cnt FROM ref_addresses_gold WHERE geom && target AND ST_Covers(target,geom);
  counts=counts||jsonb_build_array(jsonb_build_object('minimumMM',threshold,'count',cnt));
 END LOOP;
 RETURN jsonb_build_object('available',true,'counts',counts,'metric','Address Pins Exposed','classificationAvailable',false,'residentialCount',NULL,'coverage','verified','datasetVersions',versions,'calculatedAt',now());
END $$;
REVOKE ALL ON FUNCTION public.storm_address_exposure(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storm_address_exposure(text,jsonb) TO service_role;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['storm_intelligence_rollout','storm_events','storm_severity_zones','storm_address_coverage','storm_territory_revisions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tab);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
END LOOP;END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
