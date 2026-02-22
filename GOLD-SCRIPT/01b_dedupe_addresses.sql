-- ============================================================================
-- 01b_dedupe_addresses.sql
-- Removes duplicate rows from ref_addresses_gold so the unique constraint
-- uniq_ref_addr_source_norm_city_unit can be added.
--
-- IMPORTANT: Supabase SQL Editor will timeout. Run this via a DIRECT connection:
--   • Supabase Dashboard → Project Settings → Database → "Direct connection"
--   • Use psql, TablePlus, DBeaver, or similar with that URI
--   • Example: psql "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres" -f 01b_dedupe_addresses.sql
-- ============================================================================

set statement_timeout = '600s';

do $$
declare
  r record;
  deleted bigint;
begin
  for r in select distinct source_id from public.ref_addresses_gold
  loop
    with dupes as (
      select ctid,
        row_number() over (
          partition by source_id, street_number_normalized, street_name_normalized, city, unit
          order by ctid
        ) as rn
      from public.ref_addresses_gold
      where source_id = r.source_id
    )
    delete from public.ref_addresses_gold
    where ctid in (select dupes.ctid from dupes where dupes.rn > 1);
    get diagnostics deleted = row_count;
    raise notice 'Deduped source_id: %, removed % rows', r.source_id, deleted;
  end loop;
end $$;
