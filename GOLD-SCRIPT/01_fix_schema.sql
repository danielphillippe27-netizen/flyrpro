-- ============================================================================
-- 01_fix_schema.sql
-- Safe schema fixes for municipal ingest
-- Run in Supabase SQL Editor BEFORE loading data
-- ============================================================================

-- 1) Extensions
create extension if not exists postgis;
create extension if not exists pg_trgm;

-- 2) Drop duplicate indexes (only the duplicates you showed)
-- Keep your canonical idx_ref_bldg_* and idx_ref_addr_* indexes.
drop index if exists public.idx_ref_buildings_gold_geom;
drop index if exists public.idx_ref_buildings_gold_centroid;
drop index if exists public.idx_ref_buildings_gold_source_id;

drop index if exists public.idx_ref_addresses_gold_geom;
drop index if exists public.idx_ref_addresses_gold_source_id;

-- 3) Preflight checks (won't change anything, just helps you catch issues)
-- Duplicates that would block unique constraints:
select source_id, external_id, count(*)
from public.ref_buildings_gold
where external_id is not null
group by source_id, external_id
having count(*) > 1;

-- SRID checks (constraints below will fail if any existing rows violate):
select count(*) as bad_building_geom_srid
from public.ref_buildings_gold
where st_srid(geom) <> 4326;

select count(*) as bad_address_geom_srid
from public.ref_addresses_gold
where st_srid(geom) <> 4326;

-- 4) Buildings uniqueness (for UPSERT)
-- NOTE: We do NOT force external_id NOT NULL here (no breaking changes).
-- Your processor should ensure external_id exists. Loader filters out null external_id.
alter table public.ref_buildings_gold
  drop constraint if exists uniq_ref_buildings_source_external;

alter table public.ref_buildings_gold
  add constraint uniq_ref_buildings_source_external
  unique (source_id, external_id);

-- 5) Addresses uniqueness (for UPSERT)
-- Use a NAMED constraint so GitHub loader can use: ON CONFLICT ON CONSTRAINT ...
-- Includes unit so condos/townhouses don't overwrite each other.
alter table public.ref_addresses_gold
  drop constraint if exists uniq_ref_addr_source_norm_city_unit;

alter table public.ref_addresses_gold
  add constraint uniq_ref_addr_source_norm_city_unit
  unique (
    source_id,
    street_number_normalized,
    street_name_normalized,
    city,
    unit
  );

-- 6) SRID checks (EPSG:4326)
alter table public.ref_buildings_gold
  drop constraint if exists chk_bldg_geom_srid;
alter table public.ref_buildings_gold
  add constraint chk_bldg_geom_srid check (st_srid(geom) = 4326);

alter table public.ref_buildings_gold
  drop constraint if exists chk_bldg_centroid_srid;
alter table public.ref_buildings_gold
  add constraint chk_bldg_centroid_srid check (centroid is null or st_srid(centroid) = 4326);

alter table public.ref_addresses_gold
  drop constraint if exists chk_addr_geom_srid;
alter table public.ref_addresses_gold
  add constraint chk_addr_geom_srid check (st_srid(geom) = 4326);

-- 7) Optional manual link function (detached-friendly only)
-- Run manually if desired:
--   select public.link_buildings_to_addresses('york_buildings','york_addresses',20);
create or replace function public.link_buildings_to_addresses(
  p_buildings_source text,
  p_addresses_source text,
  p_max_distance_meters int default 20
) returns int
language plpgsql
as $$
declare v_updated int;
begin
  update public.ref_buildings_gold b
  set
    primary_address = a.street_number || ' ' || a.street_name,
    primary_street_number = a.street_number,
    primary_street_name = a.street_name,
    updated_at = now()
  from (
    select distinct on (b.id)
      b.id as building_id,
      a.street_number,
      a.street_name
    from public.ref_buildings_gold b
    join public.ref_addresses_gold a
      on a.source_id = p_addresses_source
     and st_dwithin(b.centroid::geography, a.geom::geography, p_max_distance_meters)
    where b.source_id = p_buildings_source
      and b.centroid is not null
      and b.primary_address is null
    order by b.id, st_distance(b.centroid::geography, a.geom::geography)
  ) a
  where b.id = a.building_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- 8) Quick summaries
select 'buildings' as t, source_id, count(*) from public.ref_buildings_gold group by source_id order by count(*) desc;
select 'addresses' as t, source_id, count(*) from public.ref_addresses_gold group by source_id order by count(*) desc;
