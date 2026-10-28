-- Exact original geometry for field operations, separate from clipped vector tiles.
-- Existing artifacts remain valid and keep their existing fallback behavior.
alter table public.campaign_map_tile_artifacts
  add column if not exists geometry_key text,
  add column if not exists compact_bundle jsonb;

-- Preparing archives is separate from enabling a renderer for customers.
alter table public.campaign_map_tile_settings
  add column if not exists build_enabled boolean not null default false;

-- A persisted cutover keeps later edits to older campaigns out of the rollout.
create table if not exists public.campaign_map_tile_rollout_control (
  singleton boolean primary key default true check (singleton),
  new_campaigns_after timestamptz not null default now()
);
insert into public.campaign_map_tile_rollout_control(singleton) values (true)
  on conflict (singleton) do nothing;
alter table public.campaign_map_tile_rollout_control enable row level security;
revoke all on public.campaign_map_tile_rollout_control from anon, authenticated;
grant select on public.campaign_map_tile_rollout_control to service_role;

-- Queue new or changed canonical revisions for campaigns explicitly enabled
-- for tile builds. Do not reset running jobs or bypass failed-job retry limits.
create or replace function public.enqueue_canonical_campaign_tiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only a newly published canonical revision should start a build. Merely
  -- touching an unchanged old bundle must not become an implicit backfill.
  if tg_table_name = 'campaign_map_bundles' and tg_op = 'UPDATE'
    and old.asset_signature is not distinct from new.asset_signature
    and old.is_current is not distinct from new.is_current then
    return new;
  end if;
  -- Only campaigns created after cutover opt into tiles. Preserve any
  -- existing campaign-specific settings, including explicit opt-outs.
  if new.is_current and exists (
    select 1 from public.campaigns c cross join public.campaign_map_tile_rollout_control r
    where c.id = new.campaign_id and r.singleton and c.created_at >= r.new_campaigns_after
  ) then
    insert into public.campaign_map_tile_settings(campaign_id, build_enabled, ios_enabled, android_enabled, web_enabled)
    values (new.campaign_id, true, true, true, true)
    on conflict (campaign_id) do nothing;
  end if;
  insert into public.campaign_map_tile_jobs(campaign_id, canonical_signature)
  select b.campaign_id, b.asset_signature
  from public.campaign_map_bundles b
  join public.campaign_map_tile_settings s on s.campaign_id = b.campaign_id
  where b.campaign_id = new.campaign_id and b.is_current
    and (s.build_enabled or s.web_enabled or s.ios_enabled or s.android_enabled)
    and not exists (select 1 from public.campaign_map_tile_artifacts a
      where a.campaign_id = b.campaign_id and a.canonical_signature = b.asset_signature
        and a.geometry_key is not null and a.compact_bundle is not null)
  on conflict (campaign_id, canonical_signature) do update
    set status = 'queued', attempts = 0, available_at = now(), updated_at = now(), last_error = null
    where campaign_map_tile_jobs.status in ('succeeded', 'superseded');
  return new;
end;
$$;
revoke all on function public.enqueue_canonical_campaign_tiles() from public;

-- Turning on a future rollout flag must not enqueue an existing campaign.
drop trigger if exists enqueue_canonical_campaign_tiles_settings on public.campaign_map_tile_settings;

create or replace function public.claim_canonical_campaign_tile_job()
returns setof public.campaign_map_tile_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidate as (
    select j.campaign_id, j.canonical_signature from public.campaign_map_tile_jobs j
    join public.campaign_map_tile_settings s on s.campaign_id = j.campaign_id
    where (s.build_enabled or s.web_enabled or s.ios_enabled or s.android_enabled)
      and ((j.status = 'queued' and j.available_at <= now())
        or (j.status = 'running' and j.lease_until < now()))
    order by j.available_at
    for update of j skip locked limit 1
  )
  update public.campaign_map_tile_jobs j set status = 'running', attempts = j.attempts + 1,
    lease_id = gen_random_uuid(), lease_until = now() + interval '15 minutes', updated_at = now()
  from candidate c where j.campaign_id = c.campaign_id and j.canonical_signature = c.canonical_signature
  returning j.*;
end;
$$;
revoke all on function public.claim_canonical_campaign_tile_job() from public, anon, authenticated;
grant execute on function public.claim_canonical_campaign_tile_job() to service_role;

-- Deliberately do not enqueue existing campaign bundles here. A rollout without
-- backfill leaves them on their existing format until a future eligible change.
