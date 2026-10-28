-- One account/workspace action covers current and future uniquely matched CRM people.
-- Existing opt-ins are unchanged until the user presses Enable sync.
alter table public.mac_crm_preferences add column sync_all_contacts boolean not null default false;
create function public.refresh_mac_contact_sync_consent(ws uuid,reset_choices boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed uuid[];
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 perform 1 from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws and sync_enabled and sync_all_contacts for update;
 if not found then return; end if;
 with handles as(select * from public.mac_owned_identifiers(ws)), unique_handles as(select identifier from handles group by identifier having count(distinct contact_id)=1),
 eligible as(select h.contact_id,array_agg(distinct h.identifier order by h.identifier) identifiers from handles h join unique_handles u using(identifier) group by h.contact_id),
 saved as(
 insert into public.mac_message_permissions(user_id,workspace_id,contact_id,enabled,identifiers,history_range,import_after,approved_at,revoked_at)
 select auth.uid(),ws,contact_id,true,identifiers,'all',null,now(),null from eligible
 on conflict(user_id,workspace_id,contact_id) do update set enabled=true,identifiers=excluded.identifiers,history_range='all',import_after=null,approved_at=now(),revoked_at=null
 where (reset_choices or mac_message_permissions.enabled) and
 (not mac_message_permissions.enabled or mac_message_permissions.identifiers is distinct from excluded.identifiers or mac_message_permissions.history_range<>'all')
 returning contact_id)
 select array_agg(contact_id) into changed from saved;
 update public.mac_contact_sync s set cursor=0,enabled=true where s.user_id=auth.uid() and s.contact_id=any(changed);
 -- Consent revision must also change when a newly eligible person has no device cursor yet.
 update public.mac_crm_preferences set revision=revision+1,updated_at=now() where user_id=auth.uid() and workspace_id=ws and cardinality(changed)>0;
end $$;
revoke all on function public.refresh_mac_contact_sync_consent(uuid,boolean) from public,authenticated,anon;
create function public.enable_mac_contact_sync(ws uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.mac_workspace_access(ws) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 insert into public.mac_crm_preferences(user_id,workspace_id,sync_all_contacts) values(auth.uid(),ws,true)
 on conflict(user_id,workspace_id) do update set sync_all_contacts=true;
 perform public.set_mac_crm_preferences(ws,true,coalesce((select ai_messages_enabled from public.mac_crm_preferences where user_id=auth.uid() and workspace_id=ws),false));
 perform public.refresh_mac_contact_sync_consent(ws,true);
 insert into public.mac_permission_events(user_id,workspace_id,action) values(auth.uid(),ws,'all_crm_contacts_sync_enabled');
end $$;
revoke all on function public.enable_mac_contact_sync(uuid) from public,anon;
grant execute on function public.enable_mac_contact_sync(uuid) to authenticated;
alter function public.prepare_mac_crm_sync(uuid,uuid,boolean,boolean) rename to prepare_mac_crm_sync_contact_choices;
revoke all on function public.prepare_mac_crm_sync_contact_choices(uuid,uuid,boolean,boolean) from public,authenticated,anon;
create function public.prepare_mac_crm_sync(ws uuid,device uuid,recheck boolean default false,history_capable boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not coalesce(history_capable,false) then return public.prepare_mac_crm_sync_contact_choices(ws,device,recheck,history_capable); end if;
 perform public.refresh_mac_contact_sync_consent(ws);
 return public.prepare_mac_crm_sync_contact_choices(ws,device,recheck,history_capable);
end $$;
revoke all on function public.prepare_mac_crm_sync(uuid,uuid,boolean,boolean) from public,anon;
grant execute on function public.prepare_mac_crm_sync(uuid,uuid,boolean,boolean) to authenticated;
