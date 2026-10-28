-- Farm imports are not subject to campaign-size caps. Mirror only included homes
-- into the linked map campaign, retaining farm IDs, visit history and exclusions.
drop function if exists public.prepare_farm_map_addresses(uuid);
create or replace function public.prepare_farm_map_addresses(p_farm_id uuid, p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_campaign_id uuid; v_home_ids uuid[];
begin
  select linked_campaign_id into v_campaign_id from public.farms where id = p_farm_id for update;
  if v_campaign_id is null then raise exception 'Farm has no linked campaign'; end if;
  select array_agg(id order by id) into v_home_ids from (
    select id from public.farm_addresses where farm_id = p_farm_id
      and (p_after_id is null or id > p_after_id) order by id limit 250
  ) batch;
  if v_home_ids is null then return jsonb_build_object('campaign_id', v_campaign_id, 'next_id', null); end if;

  -- Attach existing campaign identities only when the match is unambiguous.
  with matches as (
    select fa.id, min(ca.id::text)::uuid as campaign_address_id
    from public.farm_addresses fa join public.campaign_addresses ca
      on ca.campaign_id = v_campaign_id
      and ((fa.gers_id is not null and fa.gers_id = ca.gers_id)
        or (fa.gers_id is null and lower(trim(fa.formatted)) = lower(trim(ca.formatted))))
    where fa.farm_id = p_farm_id and fa.id = any(v_home_ids) and fa.campaign_address_id is null
    group by fa.id having count(*) = 1
  ) update public.farm_addresses fa set campaign_address_id = m.campaign_address_id
    from matches m where fa.id = m.id;

  insert into public.campaign_addresses
    (id, campaign_id, formatted, gers_id, house_number, street_name, locality, region, postal_code, source, coordinate, geom)
  select coalesce(fa.campaign_address_id, fa.id), v_campaign_id, fa.formatted, fa.gers_id,
    fa.house_number, fa.street_name, fa.locality, fa.region, fa.postal_code, coalesce(fa.source, 'map'),
    jsonb_build_object('lat', fa.latitude, 'lon', fa.longitude),
    st_setsrid(st_makepoint(fa.longitude, fa.latitude), 4326)
  from public.farm_addresses fa where fa.farm_id = p_farm_id and fa.id = any(v_home_ids)
    and fa.latitude between -90 and 90 and fa.longitude between -180 and 180
    and not exists (select 1 from public.farm_commercial_exclusions e
      where e.farm_id = p_farm_id and e.address_id = fa.id and e.restored_at is null)
  on conflict (id) do nothing;

  update public.farm_addresses fa set campaign_address_id = fa.id
    where fa.farm_id = p_farm_id and fa.id = any(v_home_ids) and fa.campaign_address_id is null
      and exists (select 1 from public.campaign_addresses ca where ca.id = fa.id and ca.campaign_id = v_campaign_id);
  return jsonb_build_object('campaign_id', v_campaign_id, 'next_id', v_home_ids[array_length(v_home_ids, 1)]);
end;
$$;
revoke all on function public.prepare_farm_map_addresses(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_farm_map_addresses(uuid, uuid) to service_role;
