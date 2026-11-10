-- Edit a single tag without replacing any of a contact's other tags.
create function public.coco_bulk_contact_tags(ws uuid, ids uuid[], tag text, operation text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  caller uuid := auth.uid();
  locked_count integer;
begin
  if caller is null or not public.mac_workspace_access(ws) then
    raise exception 'Workspace unavailable' using errcode='42501';
  end if;
  tag := trim(tag);
  if ids is null or cardinality(ids) not between 1 and 500
    or array_position(ids, null) is not null
    or coalesce(length(tag), 0) not between 1 and 60
    or operation is null or operation not in ('add', 'remove') then
    raise exception 'Invalid tag edit' using errcode='22023';
  end if;

  -- Use the same contact lock as the existing single-contact label command.
  perform 1 from public.contacts c
  where c.id = any(ids) and c.user_id = caller and c.workspace_id = ws
  order by c.id for update;
  get diagnostics locked_count = row_count;
  if locked_count <> (select count(distinct id) from unnest(ids) as selected(id)) then
    raise exception 'Contact unavailable' using errcode='42501';
  end if;

  if operation = 'add' then
    insert into public.crm_contact_profiles (user_id, workspace_id, contact_id, labels)
    select caller, ws, id, array[tag] from (select distinct unnest(ids) id) selected
    on conflict (user_id, contact_id) do update
    set labels = array_append(crm_contact_profiles.labels, tag)
    where crm_contact_profiles.workspace_id = ws
      and not exists (
        select 1 from unnest(crm_contact_profiles.labels) existing(label)
        where lower(trim(existing.label)) = lower(tag)
      );
  else
    update public.crm_contact_profiles p
    set labels = array(
      select existing.label from unnest(p.labels) with ordinality existing(label, position)
      where lower(trim(existing.label)) <> lower(tag)
      order by existing.position
    )
    where p.user_id = caller and p.workspace_id = ws and p.contact_id = any(ids)
      and exists (select 1 from unnest(p.labels) existing(label) where lower(trim(existing.label)) = lower(tag));
  end if;
end $$;

revoke all on function public.coco_bulk_contact_tags(uuid, uuid[], text, text) from public, anon;
grant execute on function public.coco_bulk_contact_tags(uuid, uuid[], text, text) to authenticated;
