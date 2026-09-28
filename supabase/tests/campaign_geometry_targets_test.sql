-- Run only in a disposable PostgreSQL/PostGIS database after loading the
-- minimal fixture schema and 20260919180000_campaign_geometry_targets.sql.
BEGIN;
DO $$
DECLARE
 c uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
 token uuid; token_b uuid; result jsonb; remaining jsonb; actual boolean; claimed integer;
 shape jsonb := '{"type":"Polygon","coordinates":[[[-124.4,47.95],[-124.39,47.95],[-124.39,47.96],[-124.4,47.96],[-124.4,47.95]]]}';
BEGIN
 INSERT INTO campaign_addresses(id,campaign_id,formatted,address,region,visited,geometry_target_kind,geometry_target_id,geometry_target_geom,address_resolution_status)
 VALUES(a,c,'Address pending','Address pending','WA',true,'building','roof-a',shape,'pending'),
       (b,c,'Address pending','Address pending','WA',false,'parcel','parcel-b',shape,'pending');
 INSERT INTO field_activity(address_id,note,outcome,assignee) VALUES(a,'Keep my visit and notes','no_answer','rep-1');
 SELECT count(*) INTO claimed FROM claim_campaign_address_enrichment(24);
 ASSERT claimed=2, 'Both types of target must be claimable';
 SELECT address_resolution_lease INTO token FROM campaign_addresses WHERE id=a;
 SELECT address_resolution_lease INTO token_b FROM campaign_addresses WHERE id=b;
 SELECT count(*) INTO claimed FROM claim_campaign_address_enrichment(24);
 ASSERT claimed=0, 'A second worker must not reclaim a live lease';
 result := jsonb_build_object('formatted','111 Wood St','house_number','111','street_name','Wood St',
   'region','WA','locality','Forks','longitude',-124.395,'latitude',47.955,'accuracy','rooftop');
 actual := finish_campaign_address_enrichment(a,gen_random_uuid(),result);
 ASSERT NOT actual, 'Stale workers cannot overwrite newer work';
 actual := finish_campaign_address_enrichment(a,token,result);
 ASSERT actual, 'A visited provisional stop must enrich in place';
 ASSERT (SELECT visited AND formatted='111 Wood St' FROM campaign_addresses WHERE id=a), 'Visit must survive enrichment';
 ASSERT (SELECT note='Keep my visit and notes' AND outcome='no_answer' AND assignee='rep-1' FROM field_activity WHERE address_id=a), 'Field history must retain its address foreign key';
 ASSERT (SELECT count(*)=2 FROM campaign_addresses WHERE campaign_id=c), 'Enrichment must not insert stops';
 actual := finish_campaign_address_enrichment(b,token_b,result);
 ASSERT NOT actual, 'Two targets cannot automatically claim the same civic address';
 ASSERT (SELECT address_resolution_status='unresolved' FROM campaign_addresses WHERE id=b), 'Ambiguous duplicate remains visible for review';
 UPDATE campaign_addresses SET address_resolution_status='pending',address_resolution_next_at=now(),formatted='My corrected address' WHERE id=b;
 PERFORM claim_campaign_address_enrichment(24);
 SELECT address_resolution_lease INTO token_b FROM campaign_addresses WHERE id=b;
 actual := finish_campaign_address_enrichment(b,token_b,result || '{"house_number":"222"}');
 ASSERT NOT actual AND (SELECT formatted='My corrected address' FROM campaign_addresses WHERE id=b), 'Manual edits win over enrichment';
 UPDATE campaign_addresses SET address_resolution_status='pending',address_resolution_next_at=now(),formatted='Address pending',address_resolution_attempts=0 WHERE id=b;
 PERFORM claim_campaign_address_enrichment(24);
 SELECT address_resolution_lease INTO token_b FROM campaign_addresses WHERE id=b;
 actual := finish_campaign_address_enrichment(b,token_b,result || '{"house_number":"222","longitude":-124.5}');
 ASSERT NOT actual, 'Neighbouring property results must not be saved';
 UPDATE campaign_addresses SET address_resolution_status='pending',address_resolution_next_at=now(),address_resolution_attempts=0 WHERE id=b;
 PERFORM claim_campaign_address_enrichment(24);
 SELECT address_resolution_lease INTO token_b FROM campaign_addresses WHERE id=b;
 PERFORM finish_campaign_address_enrichment(b,token_b,NULL,'Rate limited',true);
 ASSERT (SELECT address_resolution_status='pending' AND address_resolution_lease IS NULL FROM campaign_addresses WHERE id=b), 'Transient failure schedules a retry';
 UPDATE campaign_addresses SET address_resolution_attempts=3,address_resolution_next_at=now() WHERE id=b;
 PERFORM claim_campaign_address_enrichment(24);
 ASSERT (SELECT address_resolution_status='unresolved' FROM campaign_addresses WHERE id=b), 'Abandoned retries terminate instead of looping forever';
 -- Later native coverage adopts a unique geometry stop, preserving the same visit.
 UPDATE campaign_addresses SET geometry_target_geom=NULL WHERE id=b;
 UPDATE campaign_addresses SET formatted='Address pending',house_number=NULL,street_name=NULL,address_resolution_status='unresolved' WHERE id=a;
 remaining := adopt_campaign_geometry_addresses(c,jsonb_build_array(jsonb_build_object(
   'formatted','111 WOOD ST, FORKS','house_number','111','street_name','Wood St','region','WA','lat',47.955,'lon',-124.395)));
 ASSERT remaining='[]'::jsonb, 'New native coverage must reuse the provisional stop';
 ASSERT (SELECT visited AND formatted='111 WOOD ST, FORKS' FROM campaign_addresses WHERE id=a), 'Source adoption must preserve field state';
 remaining := adopt_campaign_geometry_addresses(c,jsonb_build_array(jsonb_build_object(
   'formatted','111 WOOD ST, FORKS','house_number','111','street_name','Wood St','region','WA','lat',47.955,'lon',-124.395)));
 ASSERT remaining='[]'::jsonb, 'Source adoption must be idempotent';
 remaining := adopt_campaign_geometry_addresses(c,jsonb_build_array(jsonb_build_object(
   'formatted','Unit 2, 111 Wood St','house_number','111','street_name','Wood St','region','WA','lat',47.955,'lon',-124.395)));
 ASSERT jsonb_array_length(remaining)=1, 'A distinct unit must not collapse into the property stop';
 UPDATE campaign_addresses SET deleted_at=now() WHERE id=a;
 remaining := adopt_campaign_geometry_addresses(c,jsonb_build_array(jsonb_build_object(
   'formatted','111 WOOD ST, FORKS','house_number','111','street_name','Wood St','region','WA','lat',47.955,'lon',-124.395)));
 ASSERT remaining='[]'::jsonb, 'Provision retries must not recreate an explicitly removed geometry stop';
 ASSERT NOT has_function_privilege('authenticated','public.claim_campaign_address_enrichment(integer)','EXECUTE'), 'Clients cannot claim global work';
 ASSERT NOT has_function_privilege('authenticated','public.finish_campaign_address_enrichment(uuid,uuid,jsonb,text,boolean)','EXECUTE'), 'Only backend may confirm provider matches';
 RAISE NOTICE 'PASS: geometry stop lifecycle, leases, duplicates, field history, manual edits, spatial checks, retries, source adoption, and RPC permissions';
END;
$$;
GRANT SELECT, UPDATE ON campaign_addresses TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    UPDATE campaign_addresses SET address_resolution_status='confirmed';
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  ASSERT rejected, 'Client address permissions must not permit forging provider metadata';
  UPDATE campaign_addresses SET formatted='Rep correction' WHERE formatted='Address pending';
  RAISE NOTICE 'PASS: backend-only metadata guard permits ordinary field label edits';
END;
$$;
RESET ROLE;
ROLLBACK;
