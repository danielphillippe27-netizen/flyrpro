-- Smoke test for canonical persisted campaign outcomes.
-- Run this in the Supabase SQL editor after deploying:
--   1. repair_record_campaign_address_outcome_compat.sql (or the canonical migration)
--   2. repair_record_campaign_target_outcome_compat.sql (or the canonical migration)
--   3. 20260325133000_campaign_feature_status_from_address_outcomes.sql
--   4. 20260325134500_record_public_qr_scan_outcome.sql
--
-- What this covers:
-- - single-house canonical save
-- - multi-address building canonical save
-- - "page reload" read from persisted addresses + contacts
-- - "map reload" read from rpc_get_campaign_full_features
-- - "stats reload" read from persisted addresses + contacts
--
-- It safely rolls back at the end.

begin;

create temporary table smoke_input as
select
  '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid as campaign_id,
  '00001d02-4cb5-44df-adb5-77135ac7fcb0'::uuid as single_campaign_address_id,
  'd8aa26cb-5510-406b-aa0f-86c9fe3fbf35'::text as multi_target_building_id;

create temporary table smoke_context as
select
  i.campaign_id,
  i.single_campaign_address_id,
  i.multi_target_building_id,
  c.owner_id as campaign_owner_id,
  coalesce(array_agg(distinct ca_multi.id order by ca_multi.id), array[]::uuid[]) as multi_campaign_address_ids,
  count(distinct ca_multi.id) as multi_address_count
from smoke_input i
join public.campaigns c on c.id = i.campaign_id
left join public.campaign_addresses ca_multi
  on ca_multi.campaign_id = i.campaign_id
 and ca_multi.building_id::text = i.multi_target_building_id
group by i.campaign_id, i.single_campaign_address_id, i.multi_target_building_id, c.owner_id;

select * from smoke_context;

do $$
declare
  v_owner_id uuid;
  v_multi_count integer;
begin
  select campaign_owner_id, multi_address_count
  into v_owner_id, v_multi_count
  from smoke_context
  limit 1;

  if v_owner_id is null then
    raise exception 'Could not resolve campaign owner for the smoke test campaign.';
  end if;

  if coalesce(v_multi_count, 0) = 0 then
    raise exception 'Could not resolve any multi-address building targets for the smoke test.';
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

-- 1. Single-house canonical save
select public.record_campaign_address_outcome(
  p_campaign_id := (select campaign_id from smoke_context limit 1),
  p_campaign_address_id := (select single_campaign_address_id from smoke_context limit 1),
  p_status := 'talked',
  p_notes := 'smoke test: single house'
) as single_house_result;

-- 2. Multi-address building canonical save
select public.record_campaign_target_outcome(
  p_campaign_id := (select campaign_id from smoke_context limit 1),
  p_campaign_address_ids := (select multi_campaign_address_ids from smoke_context limit 1),
  p_status := 'delivered',
  p_notes := 'smoke test: multi target'
) as multi_target_result;

-- 3. Persisted address rows that the page reload now uses
do $$
declare
  v_has_campaign_address_fk boolean;
  v_rows jsonb;
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'campaign_address_id', ca.id,
          'formatted', ca.formatted,
          'visited', ca.visited,
          'address_status', ast.status,
          'notes', ast.notes,
          'visit_count', ast.visit_count,
          'last_visited_at', ast.last_visited_at
        )
        order by ca.formatted, ca.id
      ), '[]'::jsonb)
      from public.campaign_addresses ca
      left join public.address_statuses ast on ast.campaign_address_id = ca.id
      where ca.campaign_id = $1
        and (
          ca.id = $2
          or ca.id = any($3)
        )
    $sql$
    into v_rows
    using
      (select campaign_id from smoke_context limit 1),
      (select single_campaign_address_id from smoke_context limit 1),
      (select multi_campaign_address_ids from smoke_context limit 1);
  else
    execute $sql$
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'campaign_address_id', ca.id,
          'formatted', ca.formatted,
          'visited', ca.visited,
          'address_status', ast.status,
          'notes', ast.notes,
          'visit_count', ast.visit_count,
          'last_visited_at', ast.last_visited_at
        )
        order by ca.formatted, ca.id
      ), '[]'::jsonb)
      from public.campaign_addresses ca
      left join public.address_statuses ast
        on ast.address_id = ca.id
       and ast.campaign_id = ca.campaign_id
      where ca.campaign_id = $1
        and (
          ca.id = $2
          or ca.id = any($3)
        )
    $sql$
    into v_rows
    using
      (select campaign_id from smoke_context limit 1),
      (select single_campaign_address_id from smoke_context limit 1),
      (select multi_campaign_address_ids from smoke_context limit 1);
  end if;

  raise notice 'page_reload_addresses: %', v_rows;
end $$;

-- 4. Map reload source
select public.rpc_get_campaign_full_features(
  (select campaign_id from smoke_context limit 1)
) as map_reload_features;

select public.get_campaign_buildings_geojson(
  (select campaign_id from smoke_context limit 1)
) as map_reload_features_alias;

-- 5. Stats reload source (matches lib/campaignStats.ts semantics)
with address_state as (
  select
    ca.id,
    ca.visited,
    ca.scans,
    ca.last_scanned_at,
    case
      when exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'address_statuses'
          and column_name = 'campaign_address_id'
      ) then (
        select ast.status
        from public.address_statuses ast
        where ast.campaign_address_id = ca.id
        limit 1
      )
      else (
        select ast.status
        from public.address_statuses ast
        where ast.address_id = ca.id
          and ast.campaign_id = ca.campaign_id
        limit 1
      )
    end as address_status
  from public.campaign_addresses ca
  where ca.campaign_id = (select campaign_id from smoke_context limit 1)
)
select jsonb_build_object(
  'addresses', count(*)::int,
  'contacts', (
    select count(*)::int
    from public.campaign_contacts cc
    where cc.campaign_id = (select campaign_id from smoke_context limit 1)
  ),
  'visited', count(*) filter (
    where coalesce(nullif(trim(lower(address_status)), ''), case when visited then 'delivered' else 'none' end)
      in ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
  )::int,
  'contacted', count(*) filter (
    where coalesce(nullif(trim(lower(address_status)), ''), case when visited then 'delivered' else 'none' end)
      in ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
  )::int,
  'scanned', count(*) filter (
    where coalesce(scans, 0) > 0 or last_scanned_at is not null
  )::int,
  'progress_pct',
    case
      when count(*) = 0 then 0
      else round(
        100.0 * count(*) filter (
          where coalesce(nullif(trim(lower(address_status)), ''), case when visited then 'delivered' else 'none' end)
            in ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
        ) / count(*)
      )::int
    end,
  'scan_rate',
    case
      when count(*) = 0 then 0
      else round(
        100.0 * count(*) filter (
          where coalesce(scans, 0) > 0 or last_scanned_at is not null
        ) / count(*)
      )::int
    end
) as stats_reload_summary
from address_state;

rollback;
