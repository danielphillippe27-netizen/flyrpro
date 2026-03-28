-- Hotfix: add canonical bulk target outcome persistence that delegates per-address writes
-- to the compatibility-safe record_campaign_address_outcome function already deployed.

create or replace function public.record_campaign_target_outcome(
  p_campaign_id uuid,
  p_campaign_address_ids uuid[],
  p_status text default 'none',
  p_notes text default null,
  p_occurred_at timestamptz default now(),
  p_session_id uuid default null,
  p_session_target_id text default null,
  p_session_event_type text default null,
  p_lat double precision default null,
  p_lon double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_address_ids uuid[];
  v_campaign_address_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_visited boolean;
  v_session_user_id uuid;
  v_session_campaign_id uuid;
  v_session_event_id uuid;
  v_validated_count integer;
  v_address_outcomes jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(array_agg(address_id order by first_ordinal), array[]::uuid[])
  into v_campaign_address_ids
  from (
    select address_id, min(ordinality) as first_ordinal
    from unnest(coalesce(p_campaign_address_ids, array[]::uuid[])) with ordinality as input(address_id, ordinality)
    where address_id is not null
    group by address_id
  ) deduped;

  if coalesce(array_length(v_campaign_address_ids, 1), 0) = 0 then
    raise exception 'campaign address ids are required';
  end if;

  if v_status not in (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  ) then
    raise exception 'Unsupported address status: %', v_status;
  end if;

  if p_session_event_type is not null and p_session_event_type not in (
    'completed_manual',
    'completed_auto',
    'completion_undone'
  ) then
    raise exception 'Unsupported session event type: %', p_session_event_type;
  end if;

  select count(*)
  into v_validated_count
  from public.campaign_addresses ca
  join public.campaigns c on c.id = ca.campaign_id
  where ca.id = any(v_campaign_address_ids)
    and ca.campaign_id = p_campaign_id
    and c.owner_id = auth.uid();

  if v_validated_count <> coalesce(array_length(v_campaign_address_ids, 1), 0) then
    raise exception 'One or more campaign addresses were not found or access was denied';
  end if;

  if p_session_id is not null then
    select user_id, campaign_id
    into v_session_user_id, v_session_campaign_id
    from public.sessions
    where id = p_session_id;

    if v_session_user_id is null or v_session_user_id != auth.uid() then
      raise exception 'Session not found or access denied';
    end if;

    if v_session_campaign_id is distinct from p_campaign_id then
      raise exception 'Session campaign does not match campaign address outcome campaign';
    end if;
  end if;

  foreach v_campaign_address_id in array v_campaign_address_ids loop
    v_address_outcomes := v_address_outcomes || jsonb_build_array(
      public.record_campaign_address_outcome(
        p_campaign_id => p_campaign_id,
        p_campaign_address_id => v_campaign_address_id,
        p_status => v_status,
        p_notes => v_notes,
        p_occurred_at => p_occurred_at
      )
    );
  end loop;

  v_visited := v_status <> 'none';

  if p_session_id is not null and p_session_event_type is not null then
    insert into public.session_events (
      session_id,
      building_id,
      address_id,
      event_type,
      created_at,
      lat,
      lon,
      event_location,
      metadata,
      user_id
    ) values (
      p_session_id,
      nullif(trim(coalesce(p_session_target_id, '')), ''),
      v_campaign_address_ids[1],
      p_session_event_type,
      p_occurred_at,
      p_lat,
      p_lon,
      case
        when p_lon is not null and p_lat is not null
          then st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
        else null
      end,
      jsonb_build_object(
        'address_status', v_status,
        'source', 'record_campaign_target_outcome',
        'campaign_address_ids', to_jsonb(v_campaign_address_ids),
        'address_count', coalesce(array_length(v_campaign_address_ids, 1), 0)
      ),
      v_session_user_id
    )
    returning id into v_session_event_id;

    if p_session_event_type in ('completed_manual', 'completed_auto') then
      update public.sessions
      set completed_count = completed_count + 1,
          updated_at = now()
      where id = p_session_id;
    elsif p_session_event_type = 'completion_undone' then
      update public.sessions
      set completed_count = greatest(0, completed_count - 1),
          updated_at = now()
      where id = p_session_id;
    end if;
  end if;

  return jsonb_build_object(
    'campaign_address_ids', to_jsonb(v_campaign_address_ids),
    'status', v_status,
    'visited', v_visited,
    'affected_count', coalesce(array_length(v_campaign_address_ids, 1), 0),
    'address_outcomes', v_address_outcomes,
    'session_event_id', v_session_event_id
  );
end;
$$;

comment on function public.record_campaign_target_outcome(uuid, uuid[], text, text, timestamptz, uuid, text, text, double precision, double precision)
is 'Canonical multi-address target outcome write path, compatible with the live record_campaign_address_outcome deployment.';

grant execute on function public.record_campaign_target_outcome(uuid, uuid[], text, text, timestamptz, uuid, text, text, double precision, double precision) to authenticated, service_role;
