BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ios@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'android@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zone@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces(id, name, owner_id)
VALUES ('10000000-0000-0000-0000-000000000001', 'Collaboration test', '00000000-0000-0000-0000-000000000001');

INSERT INTO public.campaigns(id, owner_id, workspace_id, title, name, description, status)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Cross-platform contract', 'Cross-platform contract', 'pgTAP fixture', 'active'
);

INSERT INTO public.campaign_assignments(
  id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id,
  mode, status, goal_homes
) VALUES
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'whole_team', 'in_progress', 10),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'whole_team', 'accepted', 10),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'zone_split', 'accepted', 1);

INSERT INTO public.campaign_addresses(
  id, campaign_id, formatted, address, source, geom, visited
) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '1 Test Street', '1 Test Street', 'mapbox', st_setsrid(st_makepoint(-79.38, 43.65), 4326), false),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '4 Test Street', '4 Test Street', 'mapbox', st_setsrid(st_makepoint(-79.37, 43.65), 4326), false);

INSERT INTO public.campaign_assignment_homes(assignment_id, campaign_address_id, sequence)
VALUES ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 1);

CREATE TEMP TABLE collaboration_results(name text PRIMARY KEY, payload jsonb);
CREATE TEMP TABLE collaboration_tap_results(result text);

-- The production policy may already enforce current builds. This contract owns
-- its rollout clock inside the surrounding rollback transaction so it can test
-- both sides of the cutoff deterministically without changing production state.
UPDATE public.mobile_client_policies
SET minimum_campaign_mutation_build = NULL,
    candidate_available_at = NULL,
    enforce_after = NULL
WHERE platform IN ('ios', 'android', 'legacy');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

INSERT INTO collaboration_results VALUES (
  'pin_create',
  public.v2_create_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000002',
    p_formatted => '2 Test Street', p_lat => 43.6501, p_lon => -79.3801,
    p_client_mutation_id => 'pin-create-ios', p_origin_platform => 'ios', p_client_build => 100
  )
);

INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'applied' FROM collaboration_results WHERE name = 'pin_create'), 'true', 'manual pin create applies');
INSERT INTO collaboration_tap_results SELECT is((SELECT id::text FROM public.campaign_addresses WHERE id = '30000000-0000-0000-0000-000000000002'), '30000000-0000-0000-0000-000000000002', 'server stores the exact client pin UUID');
INSERT INTO collaboration_tap_results SELECT is((SELECT assignment_id::text FROM public.campaign_addresses WHERE id = '30000000-0000-0000-0000-000000000002'), '40000000-0000-0000-0000-000000000002', 'new assignee pin is attached to the creator assignment');

INSERT INTO collaboration_results VALUES (
  'pin_replay',
  public.v2_create_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000002',
    p_formatted => '2 Test Street', p_lat => 43.6501, p_lon => -79.3801,
    p_client_mutation_id => 'pin-create-ios', p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'replayed' FROM collaboration_results WHERE name = 'pin_replay'), 'true', 'repeated pin creation replays the original result');
INSERT INTO collaboration_tap_results SELECT is((SELECT count(*)::text FROM public.campaign_home_events WHERE client_mutation_id = 'pin-create-ios'), '1', 'pin replay creates one permanent event');

INSERT INTO collaboration_results VALUES (
  'mutation_reused',
  public.v2_create_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000002',
    p_formatted => 'Changed input', p_lat => 43.6501, p_lon => -79.3801,
    p_client_mutation_id => 'pin-create-ios', p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'mutation_reused'), 'IDEMPOTENCY_KEY_REUSED', 'changed input cannot reuse an idempotency key');

DELETE FROM public.campaign_mutation_receipts
WHERE user_id = '00000000-0000-0000-0000-000000000002' AND client_mutation_id = 'pin-create-ios';
INSERT INTO collaboration_results VALUES (
  'event_replay_after_ttl',
  public.v2_create_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000002',
    p_formatted => '2 Test Street', p_lat => 43.6501, p_lon => -79.3801,
    p_client_mutation_id => 'pin-create-ios', p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'replayed' FROM collaboration_results WHERE name = 'event_replay_after_ttl'), 'true', 'permanent event prevents duplication after receipt expiry');

INSERT INTO collaboration_results VALUES (
  'status_first',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'no_answer', p_client_mutation_id => 'status-ios-1',
    p_base_revision => 0, p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'revision' FROM collaboration_results WHERE name = 'status_first'), '1', 'first status write creates revision 1');

INSERT INTO collaboration_results VALUES (
  'status_replay',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'no_answer', p_client_mutation_id => 'status-ios-1',
    p_base_revision => 0, p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'replayed' FROM collaboration_results WHERE name = 'status_replay'), 'true', 'status retry is replayed');
INSERT INTO collaboration_tap_results SELECT is((SELECT visit_count::text FROM public.address_statuses WHERE campaign_address_id = '30000000-0000-0000-0000-000000000001'), '1', 'status replay increments visit count once');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
INSERT INTO collaboration_results VALUES (
  'teammate_locked',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'talked', p_client_mutation_id => 'status-android-locked',
    p_base_revision => 1, p_origin_platform => 'android', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'teammate_locked'), 'TEAMMATE_STATUS_LOCKED', 'ordinary teammate cannot overwrite another actor status');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO collaboration_results VALUES (
  'actor_correction',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'talked', p_client_mutation_id => 'status-ios-correction',
    p_base_revision => 1, p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'revision' FROM collaboration_results WHERE name = 'actor_correction'), '2', 'original actor may correct their own status');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
INSERT INTO collaboration_results VALUES (
  'manager_reason_required',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'appointment', p_client_mutation_id => 'status-owner-no-reason',
    p_base_revision => 2, p_origin_platform => 'web'
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'manager_reason_required'), 'OVERRIDE_REASON_REQUIRED', 'manager override requires an audit reason');

INSERT INTO collaboration_results VALUES (
  'manager_override',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'appointment', p_client_mutation_id => 'status-owner-override',
    p_base_revision => 2, p_origin_platform => 'web', p_override_reason => 'Corrected after customer confirmation'
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'revision' FROM collaboration_results WHERE name = 'manager_override'), '3', 'reasoned manager override applies');
INSERT INTO collaboration_tap_results SELECT is((SELECT override_reason FROM public.campaign_home_events WHERE client_mutation_id = 'status-owner-override'), 'Corrected after customer confirmation', 'manager reason is retained in immutable history');

-- Required compounding conflict: web create -> iOS offline edit -> web revision 2 -> stale iOS rejection -> explicit reapply revision 3.
INSERT INTO collaboration_results VALUES (
  'compound_create',
  public.v2_create_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000003',
    p_formatted => '3 Test Street', p_lat => 43.6502, p_lon => -79.3802,
    p_client_mutation_id => 'compound-web-create', p_origin_platform => 'web'
  )
);
INSERT INTO collaboration_results VALUES (
  'compound_web_revision_2',
  public.v2_update_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000003',
    p_base_revision => 1, p_formatted => '3 Test Street — web edit',
    p_client_mutation_id => 'compound-web-edit', p_origin_platform => 'web'
  )
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
INSERT INTO collaboration_results VALUES (
  'compound_ios_stale',
  public.v2_update_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000003',
    p_base_revision => 1, p_formatted => '3 Test Street — offline iOS draft',
    p_client_mutation_id => 'compound-ios-stale', p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'compound_ios_stale'), 'REVISION_CONFLICT', 'stale offline iOS edit is rejected');
INSERT INTO collaboration_tap_results SELECT is((SELECT revision::text FROM public.campaign_addresses WHERE id = '30000000-0000-0000-0000-000000000003'), '2', 'server remains at web revision 2 after stale conflict');
INSERT INTO collaboration_tap_results SELECT is((SELECT formatted FROM public.campaign_addresses WHERE id = '30000000-0000-0000-0000-000000000003'), '3 Test Street — web edit', 'stale draft does not overwrite canonical pin metadata');

INSERT INTO collaboration_results VALUES (
  'compound_ios_reapply',
  public.v2_update_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000003',
    p_base_revision => 2, p_formatted => '3 Test Street — offline iOS draft',
    p_client_mutation_id => 'compound-ios-reapply', p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'revision' FROM collaboration_results WHERE name = 'compound_ios_reapply'), '3', 'explicit reapply creates revision 3 with a new mutation id');

INSERT INTO collaboration_results VALUES (
  'stale_status_revision',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000001',
    p_status => 'hot_lead', p_client_mutation_id => 'status-ios-stale-revision',
    p_base_revision => 2, p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'stale_status_revision'), 'REVISION_CONFLICT', 'stale status write returns the canonical revision before ownership policy is evaluated');
INSERT INTO collaboration_tap_results SELECT is((SELECT revision::text FROM public.address_statuses WHERE campaign_address_id = '30000000-0000-0000-0000-000000000001'), '3', 'stale status write leaves the server revision unchanged');

INSERT INTO collaboration_results VALUES (
  'compound_stale_delete',
  public.v2_delete_campaign_manual_pin(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000003',
    p_base_revision => 2, p_client_mutation_id => 'compound-ios-stale-delete',
    p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'compound_stale_delete'), 'REVISION_CONFLICT', 'stale manual-pin delete is rejected');
INSERT INTO collaboration_tap_results SELECT ok((SELECT deleted_at IS NULL FROM public.campaign_addresses WHERE id = '30000000-0000-0000-0000-000000000003'), 'stale delete does not tombstone the canonical pin');

-- Transition bridge: identical old-build retries fingerprint to one mutation and
-- occurrence time prevents a later-arriving stale write from replacing new state.
INSERT INTO collaboration_results VALUES (
  'legacy_first',
  public.record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'delivered', p_occurred_at => '2026-01-01T12:00:00Z'
  )
);
INSERT INTO collaboration_results VALUES (
  'legacy_retry',
  public.record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'delivered', p_occurred_at => '2026-01-01T12:00:00Z'
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'applied' FROM collaboration_results WHERE name = 'legacy_first'), 'true', 'legacy mutation is accepted before the cutoff');
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'replayed' FROM collaboration_results WHERE name = 'legacy_retry'), 'true', 'legacy retry with the same occurrence fingerprint is replayed');
INSERT INTO collaboration_tap_results SELECT is((SELECT visit_count::text FROM public.address_statuses WHERE campaign_address_id = '30000000-0000-0000-0000-000000000004'), '1', 'fingerprinted legacy retry increments visit count once');
INSERT INTO collaboration_tap_results SELECT is((SELECT count(*)::text FROM public.campaign_home_events WHERE campaign_address_id = '30000000-0000-0000-0000-000000000004' AND origin_platform = 'legacy'), '1', 'fingerprinted legacy retry creates one permanent event');

INSERT INTO collaboration_results VALUES (
  'legacy_newer_state',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'talked', p_occurred_at => '2026-01-02T12:00:00Z',
    p_client_mutation_id => 'status-ios-newer-than-legacy', p_base_revision => 1,
    p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_results VALUES (
  'legacy_stale_arrival',
  public.record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'no_answer', p_occurred_at => '2026-01-01T13:00:00Z'
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'legacy_stale_arrival'), 'REVISION_CONFLICT', 'legacy occurrence-time guard rejects an older offline mutation');
INSERT INTO collaboration_tap_results SELECT is((SELECT status FROM public.address_statuses WHERE campaign_address_id = '30000000-0000-0000-0000-000000000004'), 'talked', 'legacy stale arrival does not replace newer server state');

UPDATE public.mobile_client_policies
SET minimum_campaign_mutation_build = NULL, enforce_after = now() - interval '1 minute'
WHERE platform = 'legacy';
INSERT INTO collaboration_results VALUES (
  'legacy_after_cutoff',
  public.record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'appointment', p_occurred_at => '2026-01-03T12:00:00Z'
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'legacy_after_cutoff'), 'CLIENT_UPGRADE_REQUIRED', 'legacy RPC becomes a read-safe rejection shim after cutoff');

UPDATE public.mobile_client_policies
SET minimum_campaign_mutation_build = 101, enforce_after = now() - interval '1 minute'
WHERE platform = 'ios';
INSERT INTO collaboration_results VALUES (
  'ios_below_minimum',
  public.v2_record_campaign_address_outcome(
    p_campaign_id => '20000000-0000-0000-0000-000000000001',
    p_campaign_address_id => '30000000-0000-0000-0000-000000000004',
    p_status => 'appointment', p_client_mutation_id => 'status-ios-below-minimum',
    p_base_revision => 2, p_origin_platform => 'ios', p_client_build => 100
  )
);
INSERT INTO collaboration_tap_results SELECT is((SELECT payload->>'error_code' FROM collaboration_results WHERE name = 'ios_below_minimum'), 'CLIENT_UPGRADE_REQUIRED', 'below-minimum explicit mobile build cannot mutate after enforcement');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
INSERT INTO collaboration_tap_results SELECT ok(public.can_view_campaign('20000000-0000-0000-0000-000000000001'), 'active zone assignee can view full campaign');
INSERT INTO collaboration_tap_results SELECT ok(public.can_mutate_campaign_address('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), 'zone assignee can mutate assigned home');
INSERT INTO collaboration_tap_results SELECT ok(NOT public.can_mutate_campaign_address('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004'), 'zone assignee cannot mutate another zone');

UPDATE public.campaign_assignments SET status = 'completed' WHERE id = '40000000-0000-0000-0000-000000000003';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
INSERT INTO collaboration_tap_results SELECT ok(public.can_view_campaign('20000000-0000-0000-0000-000000000001'), 'completed assignee remains able to view campaign history');
INSERT INTO collaboration_tap_results SELECT ok(NOT public.can_mutate_campaign_address('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), 'completed assignment is read-only');

INSERT INTO public.campaign_mutation_receipts(
  user_id, client_mutation_id, campaign_id, operation, request_hash, response, expires_at
) VALUES
  ('00000000-0000-0000-0000-000000000003', 'expired-receipt', '20000000-0000-0000-0000-000000000001', 'test', 'old', '{}'::jsonb, now() - interval '1 second'),
  ('00000000-0000-0000-0000-000000000003', 'future-receipt', '20000000-0000-0000-0000-000000000001', 'test', 'new', '{}'::jsonb, now() + interval '90 days');
INSERT INTO collaboration_tap_results SELECT is(public.cleanup_expired_campaign_mutation_receipts(100), 1, 'receipt cleanup removes only expired rows');
INSERT INTO collaboration_tap_results SELECT ok(NOT EXISTS (SELECT 1 FROM public.campaign_mutation_receipts WHERE client_mutation_id = 'expired-receipt'), 'expired receipt was removed');
INSERT INTO collaboration_tap_results SELECT ok(EXISTS (SELECT 1 FROM public.campaign_mutation_receipts WHERE client_mutation_id = 'future-receipt'), 'unexpired receipt was preserved');

INSERT INTO collaboration_tap_results SELECT * FROM finish();
SELECT result FROM collaboration_tap_results;
ROLLBACK;
