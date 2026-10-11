-- Run with supabase db query --linked --file supabase/tests/storm_intelligence_geometry_validation.sql
-- Temporary fixtures are rolled back; never enable production flags from this test.
BEGIN;
DO $$
DECLARE target geometry; expected bigint; result jsonb; coverage_id uuid; test_territory_id uuid; workspace uuid; creator uuid; rev integer; snapshots integer;
BEGIN
 SELECT ST_Buffer(geom::geography,100)::geometry INTO target FROM public.ref_addresses_gold WHERE geom IS NOT NULL LIMIT 1;
 target=ST_GeomFromGeoJSON(ST_AsGeoJSON(target));
 IF target IS NULL THEN RAISE EXCEPTION 'No reference address available for validation';END IF;
 SELECT count(DISTINCT id) INTO expected FROM public.ref_addresses_gold WHERE geom && target AND ST_Covers(target,geom);
 INSERT INTO public.storm_events(event_key,provider_event_id,hazard,source,event_start,event_end,source_updated_at) VALUES('validation:temporary:rollback','fixture','hail','validation-fixture',now()-interval '1 day',now(),now());
 INSERT INTO public.storm_severity_zones(event_key,minimum_mm,geometry,source_resolution_m,estimation_method,source_updated_at,validated,license_verified)
 SELECT 'validation:temporary:rollback',threshold,ST_AsGeoJSON(target)::jsonb,100,'temporary-fixture',now(),true,true FROM unnest(ARRAY[25.4,44.45,63.5]) threshold;
 INSERT INTO public.storm_address_coverage(dataset_version,geom,verified_at) VALUES('temporary-validation',ST_Multi(target),now()) RETURNING id INTO coverage_id;
 result=public.storm_address_exposure('validation:temporary:rollback',ST_AsGeoJSON(target)::jsonb);
 IF NOT (result->>'available')::boolean THEN RAISE EXCEPTION 'Exposure unavailable: %',result;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'counts') counts WHERE (counts->>'count')::bigint<>expected) THEN RAISE EXCEPTION 'Counts disagree with independent ST_Covers query';END IF;
 IF jsonb_array_length(result->'counts')<>3 OR expected<1 THEN RAISE EXCEPTION 'Threshold counts missing';END IF;
 DELETE FROM public.storm_address_coverage WHERE id=coverage_id;
 result=public.storm_address_exposure('validation:temporary:rollback',ST_AsGeoJSON(target)::jsonb);
 IF (result->>'available')::boolean OR result->'counts'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing coverage became zero';END IF;
 IF has_function_privilege('anon','public.storm_address_exposure(text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.storm_address_exposure(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Exposure function grants too broad';END IF;
 SELECT id INTO workspace FROM public.workspaces LIMIT 1;SELECT id INTO creator FROM auth.users LIMIT 1;
 INSERT INTO public.storm_territories(workspace_id,created_by,name,boundary,context) VALUES(workspace,creator,'Temporary rollback validation',ST_AsGeoJSON(target)::jsonb,'{}'::jsonb) RETURNING id INTO test_territory_id;
 UPDATE public.storm_territories SET name='Temporary revision validation' WHERE id=test_territory_id;
 SELECT revision INTO rev FROM public.storm_territories WHERE id=test_territory_id;
 SELECT count(*) INTO snapshots FROM public.storm_territory_revisions WHERE storm_territory_revisions.territory_id=test_territory_id;
 IF rev<>2 OR snapshots<>2 THEN RAISE EXCEPTION 'Territory revision validation failed';END IF;
END $$;
ROLLBACK;
