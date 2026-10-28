alter table public.mac_contact_messages add column attachment_manifest jsonb not null default '[]';
alter function public.import_mac_contact_messages(uuid,uuid,bigint,jsonb,bigint) rename to import_mac_contact_messages_without_files;
revoke all on function public.import_mac_contact_messages_without_files(uuid,uuid,bigint,jsonb,bigint) from public,anon,authenticated;
create function public.import_mac_contact_messages(target_device uuid,target_contact uuid,expected_cursor bigint,batch jsonb,scanned_cursor bigint default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;item jsonb;attachment jsonb;
begin
 for item in select value from jsonb_array_elements(batch) loop
 if item ? 'attachments' then
 if jsonb_typeof(item->'attachments')<>'array' or jsonb_array_length(item->'attachments')>100 then raise exception 'Invalid attachments';end if;
 for attachment in select value from jsonb_array_elements(item->'attachments') loop
 if jsonb_typeof(attachment)<>'object' or length(attachment->>'guid') not between 1 and 256 or length(attachment->>'fileName') not between 1 and 512 or coalesce(attachment->>'status','') not in('pending','unavailable','too_large','excluded') or exists(select 1 from jsonb_object_keys(attachment) k where k not in('guid','fileName','mimeType','byteCount','status')) then raise exception 'Invalid attachment metadata';end if;
 end loop;end if;end loop;
 result:=public.import_mac_contact_messages_without_files(target_device,target_contact,expected_cursor,batch,scanned_cursor);
 for item in select value from jsonb_array_elements(batch) loop
 if item ? 'attachments' then update public.mac_contact_messages set attachment_manifest=item->'attachments' where user_id=auth.uid() and contact_id=target_contact and external_id=item->>'guid';end if;
 end loop;return result;
end $$;
revoke all on function public.import_mac_contact_messages(uuid,uuid,bigint,jsonb,bigint) from public,anon;
grant execute on function public.import_mac_contact_messages(uuid,uuid,bigint,jsonb,bigint) to authenticated;
