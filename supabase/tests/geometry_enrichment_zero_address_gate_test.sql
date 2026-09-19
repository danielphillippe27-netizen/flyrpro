-- Run after the minimal geometry fixture and both geometry migrations.
INSERT INTO campaign_addresses(id,campaign_id,formatted,region,geometry_target_kind,geometry_target_geom,address_resolution_status,address_resolution_permanent_allowed)
VALUES
('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Address pending','WA','parcel','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}','pending',false),
('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Address pending','WA','parcel','{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}','pending',true);
DO $$ DECLARE ids uuid[]; BEGIN
 SELECT array_agg(id) INTO ids FROM claim_campaign_address_enrichment(24);
 IF ids IS DISTINCT FROM ARRAY['20000000-0000-4000-8000-000000000002'::uuid] THEN RAISE EXCEPTION 'Paid claim escaped zero-address gate'; END IF;
 IF EXISTS(SELECT 1 FROM claim_campaign_address_enrichment(24)) THEN RAISE EXCEPTION 'Noneligible row claimed'; END IF;
END $$;
