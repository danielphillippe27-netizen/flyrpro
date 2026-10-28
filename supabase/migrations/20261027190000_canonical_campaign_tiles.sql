-- Immutable canonical geometry packages. Only the authenticated API/service role reads them.
create table if not exists public.campaign_map_tile_artifacts (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  asset_signature text not null,
  canonical_signature text not null,
  geometry_revision text not null,
  bucket text not null,
  archive_key text not null,
  details_key text not null,
  sha256 text not null,
  byte_length bigint not null check (byte_length > 0),
  bundle jsonb not null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, asset_signature)
);
create index if not exists campaign_map_tile_canonical_idx
  on public.campaign_map_tile_artifacts(campaign_id, canonical_signature, created_at desc);
alter table public.campaign_map_tile_artifacts enable row level security;
revoke all on public.campaign_map_tile_artifacts from anon, authenticated;
grant all on public.campaign_map_tile_artifacts to service_role;

create table if not exists public.campaign_map_tile_settings (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  web_enabled boolean not null default false,
  ios_enabled boolean not null default false,
  android_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.campaign_map_tile_settings enable row level security;
revoke all on public.campaign_map_tile_settings from anon, authenticated;
grant all on public.campaign_map_tile_settings to service_role;

-- Compilation runs in a worker with tippecanoe, never in the map request.
create table if not exists public.campaign_map_tile_jobs (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  canonical_signature text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','superseded','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, canonical_signature)
);
alter table public.campaign_map_tile_jobs enable row level security;
revoke all on public.campaign_map_tile_jobs from anon, authenticated;
grant all on public.campaign_map_tile_jobs to service_role;

create or replace function public.enqueue_canonical_campaign_tiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.campaign_map_tile_jobs(campaign_id, canonical_signature)
  select b.campaign_id, b.asset_signature
  from public.campaign_map_bundles b
  join public.campaign_map_tile_settings s on s.campaign_id = b.campaign_id
  where b.campaign_id = new.campaign_id and b.is_current
    and (s.web_enabled or s.ios_enabled or s.android_enabled)
    and not exists (select 1 from public.campaign_map_tile_artifacts a
      where a.campaign_id = b.campaign_id and a.canonical_signature = b.asset_signature)
  on conflict (campaign_id, canonical_signature) do nothing;
  return new;
end;
$$;
revoke all on function public.enqueue_canonical_campaign_tiles() from public;
drop trigger if exists enqueue_canonical_campaign_tiles_bundle on public.campaign_map_bundles;
create trigger enqueue_canonical_campaign_tiles_bundle after insert or update on public.campaign_map_bundles
  for each row execute function public.enqueue_canonical_campaign_tiles();
drop trigger if exists enqueue_canonical_campaign_tiles_settings on public.campaign_map_tile_settings;
create trigger enqueue_canonical_campaign_tiles_settings after insert or update on public.campaign_map_tile_settings
  for each row execute function public.enqueue_canonical_campaign_tiles();

create or replace function public.claim_canonical_campaign_tile_job()
returns setof public.campaign_map_tile_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidate as (
    select j.campaign_id, j.canonical_signature from public.campaign_map_tile_jobs j
    join public.campaign_map_tile_settings s on s.campaign_id = j.campaign_id
    where (s.web_enabled or s.ios_enabled or s.android_enabled)
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
