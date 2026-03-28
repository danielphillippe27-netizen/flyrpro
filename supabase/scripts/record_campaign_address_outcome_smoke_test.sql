-- Smoke test for record_campaign_address_outcome using the IDs you provided.
-- Run this in the Supabase SQL editor.
-- It safely rolls back at the end.
--
-- Important:
-- - The provided campaign address belongs to campaign:
--     0aabb50b-520f-4498-9b59-b2bcf29b5359
-- - The provided session belongs to campaign:
--     ee184041-b7c0-489b-a187-a9f963045864
-- - Because those campaigns do not match, the atomic session test is intentionally
--   left as a preflight check only. The RPC should reject that combination.

begin;

-- Constants from the records you pasted.
create temporary table smoke_input as
select
  '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid as campaign_id,
  '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid as campaign_address_id,
  '0a44fde9-d5b9-4c8e-8d1d-be51fa43bedf'::uuid as session_id,
  'ee184041-b7c0-489b-a187-a9f963045864'::uuid as session_campaign_id;

-- Discover the real campaign owner for this address/campaign pair.
create temporary table smoke_context as
select
  ca.id as campaign_address_id,
  ca.campaign_id,
  c.owner_id as campaign_owner_id
from smoke_input i
join public.campaign_addresses ca on ca.id = i.campaign_address_id
join public.campaigns c on c.id = ca.campaign_id
where ca.campaign_id = i.campaign_id;

select * from smoke_context;

-- Impersonate the actual owning authenticated user so auth.uid() matches the campaign.
do $$
declare
  v_owner_id uuid;
begin
  select campaign_owner_id into v_owner_id
  from smoke_context
  limit 1;

  if v_owner_id is null then
    raise exception 'Could not resolve campaign owner for the provided campaign address.';
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_id,
      'role', 'authenticated'
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

select auth.uid() as impersonated_user_id;

-- 1. House-only write using your real campaign address.
select public.record_campaign_address_outcome(
  p_campaign_id := '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid,
  p_campaign_address_id := '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid,
  p_status := 'delivered',
  p_notes := 'smoke test: house only'
);

-- Verify persisted house state for either supported address_statuses schema.
do $$
declare
  v_has_campaign_address_fk boolean;
  v_row jsonb;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'address_statuses'
      and column_name = 'campaign_address_id'
  ) into v_has_campaign_address_fk;

  if v_has_campaign_address_fk then
    execute $sql$
      select jsonb_build_object(
        'campaign_address_id', ca.id,
        'campaign_id', ca.campaign_id,
        'visited', ca.visited,
        'status', ast.status,
        'notes', ast.notes,
        'visit_count', ast.visit_count,
        'last_visited_at', ast.last_visited_at,
        'updated_at', ast.updated_at
      )
      from public.campaign_addresses ca
      left join public.address_statuses ast on ast.campaign_address_id = ca.id
      where ca.id = $1
    $sql$
    into v_row
    using '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid;
  else
    execute $sql$
      select jsonb_build_object(
        'campaign_address_id', ca.id,
        'campaign_id', ca.campaign_id,
        'visited', ca.visited,
        'status', ast.status,
        'notes', ast.notes,
        'visit_count', ast.visit_count,
        'last_visited_at', ast.last_visited_at,
        'updated_at', ast.updated_at
      )
      from public.campaign_addresses ca
      left join public.address_statuses ast
        on ast.address_id = ca.id
       and ast.campaign_id = ca.campaign_id
      where ca.id = $1
    $sql$
    into v_row
    using '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid;
  end if;

  raise notice 'house verification: %', v_row;
end $$;

-- 2. Preflight check for the provided session.
-- This should show that the session belongs to a different campaign than the address.
select
  ca.id as campaign_address_id,
  ca.campaign_id as address_campaign_id,
  c.owner_id as campaign_owner_id,
  s.id as session_id,
  s.user_id as session_user_id,
  s.campaign_id as session_campaign_id,
  (ca.campaign_id = s.campaign_id) as campaigns_match,
  (c.owner_id = s.user_id) as owner_matches_session_user
from public.campaign_addresses ca
join public.campaigns c on c.id = ca.campaign_id
join public.sessions s on s.id = '0a44fde9-d5b9-4c8e-8d1d-be51fa43bedf'::uuid
where ca.id = '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid;

-- 3. Template for the atomic session test.
-- Replace ONLY `matching_session_id` with an active session that belongs to
-- campaign 0aabb50b-520f-4498-9b59-b2bcf29b5359, then uncomment and run.
--
-- select public.record_campaign_address_outcome(
--   p_campaign_id := '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid,
--   p_campaign_address_id := '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid,
--   p_status := 'talked',
--   p_notes := 'smoke test: with matching session',
--   p_session_id := 'matching_session_id'::uuid,
--   p_session_target_id := 'd8aa26cb-5510-406b-aa0f-86c9fe3fbf35',
--   p_session_event_type := 'completed_manual',
--   p_lat := 43.9139,
--   p_lon := -78.7750
-- );
--
-- select
--   s.id as session_id,
--   s.completed_count,
--   se.id as session_event_id,
--   se.event_type,
--   se.address_id,
--   se.building_id,
--   se.created_at
-- from public.sessions s
-- left join lateral (
--   select *
--   from public.session_events se
--   where se.session_id = s.id
--     and se.address_id = '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid
--   order by se.created_at desc
--   limit 1
-- ) se on true
-- where s.id = 'matching_session_id'::uuid;

rollback;
