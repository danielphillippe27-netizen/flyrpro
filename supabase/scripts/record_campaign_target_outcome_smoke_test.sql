-- Smoke test for record_campaign_target_outcome using the campaign/building IDs you provided.
-- Run this in the Supabase SQL editor after deploying:
--   1. repair_record_campaign_address_outcome_compat.sql
--   2. repair_record_campaign_target_outcome_compat.sql
--
-- It safely rolls back at the end.

begin;

create temporary table smoke_input as
select
  '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid as campaign_id,
  'd8aa26cb-5510-406b-aa0f-86c9fe3fbf35'::text as target_building_id;

create temporary table smoke_target_context as
select
  i.campaign_id,
  i.target_building_id,
  c.owner_id as campaign_owner_id,
  coalesce(array_agg(ca.id order by coalesce(ca.formatted, ''), ca.id), array[]::uuid[]) as campaign_address_ids,
  count(*) as address_count
from smoke_input i
join public.campaigns c on c.id = i.campaign_id
join public.campaign_addresses ca
  on ca.campaign_id = i.campaign_id
 and ca.building_id::text = i.target_building_id
group by i.campaign_id, i.target_building_id, c.owner_id;

select * from smoke_target_context;

do $$
declare
  v_owner_id uuid;
begin
  select campaign_owner_id into v_owner_id
  from smoke_target_context
  limit 1;

  if v_owner_id is null then
    raise exception 'Could not resolve campaign owner for the provided building target.';
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

select public.record_campaign_target_outcome(
  p_campaign_id := (select campaign_id from smoke_target_context limit 1),
  p_campaign_address_ids := (select campaign_address_ids from smoke_target_context limit 1),
  p_status := 'delivered',
  p_notes := 'smoke test: bulk target'
);

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
          'status', ast.status,
          'notes', ast.notes,
          'visit_count', ast.visit_count,
          'last_visited_at', ast.last_visited_at,
          'updated_at', ast.updated_at
        )
        order by ca.formatted, ca.id
      ), '[]'::jsonb)
      from public.campaign_addresses ca
      left join public.address_statuses ast on ast.campaign_address_id = ca.id
      where ca.id = any($1)
    $sql$
    into v_rows
    using (select campaign_address_ids from smoke_target_context limit 1);
  else
    execute $sql$
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'campaign_address_id', ca.id,
          'formatted', ca.formatted,
          'visited', ca.visited,
          'status', ast.status,
          'notes', ast.notes,
          'visit_count', ast.visit_count,
          'last_visited_at', ast.last_visited_at,
          'updated_at', ast.updated_at
        )
        order by ca.formatted, ca.id
      ), '[]'::jsonb)
      from public.campaign_addresses ca
      left join public.address_statuses ast
        on ast.address_id = ca.id
       and ast.campaign_id = ca.campaign_id
      where ca.id = any($1)
    $sql$
    into v_rows
    using (select campaign_address_ids from smoke_target_context limit 1);
  end if;

  raise notice 'target verification: %', v_rows;
end $$;

-- Optional session preflight: paste the fresh session ID you create in this campaign and uncomment.
--
-- select public.record_campaign_target_outcome(
--   p_campaign_id := '0aabb50b-520f-4498-9b59-b2bcf29b5359'::uuid,
--   p_campaign_address_ids := (select campaign_address_ids from smoke_target_context limit 1),
--   p_status := 'delivered',
--   p_notes := 'smoke test: bulk target + session',
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
--   se.metadata,
--   se.created_at
-- from public.sessions s
-- left join lateral (
--   select *
--   from public.session_events se
--   where se.session_id = s.id
--   order by se.created_at desc
--   limit 1
-- ) se on true
-- where s.id = 'matching_session_id'::uuid;

rollback;
