#!/usr/bin/env bash
# Isolated database test. Uses only a new disposable container and no production data.
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="wolfgrid-canonical-no-backfill-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --pull=never --name "$container" -e POSTGRES_PASSWORD=localtest postgres:17-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres >/dev/null <<'SQL'
create role anon; create role authenticated; create role service_role;
create table public.campaigns (id uuid primary key, created_at timestamptz not null default now());
create table public.campaign_map_bundles (campaign_id uuid, asset_signature text, is_current boolean);
insert into public.campaigns(id, created_at) values ('00000000-0000-0000-0000-000000000001', now() - interval '1 day');
insert into public.campaigns(id, created_at) values ('00000000-0000-0000-0000-000000000003', now() - interval '1 day');
insert into public.campaign_map_bundles values ('00000000-0000-0000-0000-000000000001', 'old', true);
SQL
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres < "$repo_dir/supabase/migrations/20261027190000_canonical_campaign_tiles.sql" >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres >/dev/null <<'SQL'
alter table public.campaign_map_tile_settings disable trigger enqueue_canonical_campaign_tiles_settings;
insert into public.campaign_map_tile_settings(campaign_id, web_enabled) values ('00000000-0000-0000-0000-000000000001', true);
alter table public.campaign_map_tile_settings enable trigger enqueue_canonical_campaign_tiles_settings;
SQL
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres < "$repo_dir/supabase/migrations/20261027210000_canonical_geometry_pack.sql" >/dev/null
docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres >/dev/null <<'SQL'
do $$ begin
  if (select count(*) from public.campaign_map_tile_jobs) <> 0 then raise exception 'upgrade queued an existing campaign'; end if;
  if to_regprocedure('public.stage_canonical_campaign_tile_builds()') is not null then raise exception 'bulk staging is enabled'; end if;
end $$;
update public.campaign_map_tile_settings set ios_enabled = true;
update public.campaign_map_bundles set is_current = true where is_current;
do $$ begin
  if (select count(*) from public.campaign_map_tile_jobs) <> 0 then raise exception 'flags or unchanged data triggered a backfill'; end if;
end $$;
update public.campaign_map_bundles set asset_signature = 'new' where is_current;
do $$ begin
  if (select count(*) from public.campaign_map_tile_jobs where canonical_signature = 'new') <> 1 then raise exception 'new revision was not queued'; end if;
end $$;
insert into public.campaign_map_bundles values ('00000000-0000-0000-0000-000000000003', 'old-new-revision', true);
do $$ begin
  if exists (select 1 from public.campaign_map_tile_jobs where campaign_id = '00000000-0000-0000-0000-000000000003') then raise exception 'old campaign revision triggered a backfill'; end if;
  if exists (select 1 from public.campaign_map_tile_settings where campaign_id = '00000000-0000-0000-0000-000000000003') then raise exception 'old campaign was opted in'; end if;
end $$;
insert into public.campaigns(id) values ('00000000-0000-0000-0000-000000000002');
insert into public.campaign_map_bundles values ('00000000-0000-0000-0000-000000000002', 'fresh', true);
do $$ begin
  if not exists (select 1 from public.campaign_map_tile_jobs where canonical_signature = 'fresh') then raise exception 'new campaign not queued'; end if;
  if not exists (select 1 from public.campaign_map_tile_settings where campaign_id = '00000000-0000-0000-0000-000000000002' and build_enabled and ios_enabled and web_enabled and android_enabled) then raise exception 'new campaign platform rollout incorrect'; end if;
end $$;
update public.campaign_map_bundles set asset_signature = 'optimized' where campaign_id = '00000000-0000-0000-0000-000000000002';
do $$ begin
  if not exists (select 1 from public.campaign_map_tile_jobs where campaign_id = '00000000-0000-0000-0000-000000000002' and canonical_signature = 'optimized') then raise exception 'later optimizer revision was not queued'; end if;
end $$;
SQL
printf '%s\n' 'PASS: no backfill; newly created campaigns build and enable tiles on all platforms'
