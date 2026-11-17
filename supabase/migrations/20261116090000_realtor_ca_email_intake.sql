create table public.realtor_ca_email_routes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  verification_code text,
  verification_received_at timestamptz,
  primary key (workspace_id, user_id)
);

alter table public.realtor_ca_email_routes enable row level security;
revoke all on public.realtor_ca_email_routes from public, anon, authenticated;
grant select, insert, update, delete on public.realtor_ca_email_routes to service_role;

create function public.receive_realtor_ca_email(route_token text, mail jsonb, inquiry jsonb)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  route public.realtor_ca_email_routes;
  inbox_id uuid;
  target_contact uuid;
  buyer_name text := inquiry->>'name';
  buyer_email text := inquiry->>'email';
  buyer_phone text := inquiry->>'phone';
  phone_digits text := right(regexp_replace(buyer_phone, '[^0-9]', '', 'g'), 10);
  source_key text;
  received_at timestamptz := (mail->>'receivedAt')::timestamptz;
begin
  select r.* into route
  from public.realtor_ca_email_routes r
  join public.workspace_members m using (workspace_id, user_id)
  where r.token = route_token
  for update of r for share of m;
  if not found then return null; end if;

  if mail->>'verificationCode' is not null then
    update public.realtor_ca_email_routes
    set verification_code = mail->>'verificationCode', verification_received_at = received_at
    where token = route_token
      and (verification_received_at is null or verification_received_at < received_at);
    return null;
  end if;

  source_key := route.user_id::text || ':' || (mail->>'messageId');

  -- Claim the message before touching Contacts. A failed write rolls the claim back.
  insert into public.inbox_items (
    workspace_id, owner_user_id, source, source_table, source_id, title,
    preview, body, from_label, from_email, from_phone, to_email, occurred_at, raw_payload
  ) values (
    route.workspace_id, route.user_id, 'email', 'realtor_ca_email', source_key,
    mail->>'subject', mail->>'preview', mail->>'body', coalesce(buyer_name, mail->>'from'),
    case when buyer_name is null then mail->>'from' else buyer_email end, buyer_phone,
    mail->>'to', received_at,
    jsonb_strip_nulls(jsonb_build_object(
      'direction', 'inbound', 'provider', 'realtor.ca',
      'listing', inquiry->>'listing', 'mls', inquiry->>'mls'
    ))
  )
  on conflict (workspace_id, source, source_table, source_id) do nothing
  returning id into inbox_id;

  if inbox_id is null or buyer_name is null then return inbox_id; end if;

  select id into target_contact from public.contacts
  where user_id = route.user_id and workspace_id = route.workspace_id
    and (
      (buyer_email is not null and lower(trim(email)) = buyer_email)
      or (buyer_email is null and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = phone_digits)
    )
  order by updated_at desc nulls last, id
  limit 1;

  if target_contact is null then
    insert into public.contacts (
      user_id, workspace_id, full_name, first_name, last_name, email, phone, address, status, source
    ) values (
      route.user_id, route.workspace_id, buyer_name, split_part(buyer_name, ' ', 1),
      nullif(trim(substr(buyer_name, length(split_part(buyer_name, ' ', 1)) + 1)), ''),
      buyer_email, buyer_phone, '', 'new', 'REALTOR.ca'
    ) returning id into target_contact;
  elsif buyer_phone is not null then
    update public.contacts set phone = buyer_phone, updated_at = now()
    where id = target_contact and nullif(trim(phone), '') is null;
  end if;

  insert into public.crm_contact_profiles (user_id, workspace_id, contact_id, labels)
  values (route.user_id, route.workspace_id, target_contact, array['REALTOR.ca Lead'])
  on conflict (user_id, contact_id) do update
  set labels = array_append(crm_contact_profiles.labels, 'REALTOR.ca Lead')
  where crm_contact_profiles.workspace_id = route.workspace_id
    and not exists (
      select 1 from unnest(crm_contact_profiles.labels) as existing(label)
      where lower(trim(existing.label)) = 'realtor.ca lead'
    );

  update public.inbox_items set contact_id = target_contact where id = inbox_id;
  insert into public.crm_relationship_events (
    user_id, workspace_id, contact_id, request_id, kind, title, body, occurred_at
  ) values (
    route.user_id, route.workspace_id, target_contact, inbox_id, 'email',
    'REALTOR.ca inquiry',
    concat_ws(chr(10), coalesce(nullif(inquiry->>'message', ''), mail->>'body'), mail->>'subject'),
    received_at
  );
  return inbox_id;
end;
$$;

revoke all on function public.receive_realtor_ca_email(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.receive_realtor_ca_email(text, jsonb, jsonb) to service_role;
