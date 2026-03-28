-- Hotfix: add sessions.leads_created if missing, then rebuild session_analytics
-- with conversations_per_door and leads_per_conversation.

begin;

alter table if exists public.sessions
  add column if not exists leads_created integer not null default 0;

comment on column public.sessions.leads_created is
  'Per-session lead count captured from mobile/web session completion.';

create index if not exists idx_sessions_workspace_leads_created
  on public.sessions(workspace_id, leads_created);

create or replace view public.session_analytics as
select
    s.*,
    pace.doors_per_hour,
    pace.conversations_per_hour,
    pace.completions_per_km,
    case
        when base.doors_total > 0 then
            base.conversations_total::double precision / base.doors_total::double precision
        else 0.0
    end as conversations_per_door,
    case
        when base.conversations_total > 0 then
            base.leads_total::double precision / base.conversations_total::double precision
        else 0.0
    end as leads_per_conversation,
    appts.appointments_count,
    case
        when base.conversations_total > 0 then
            appts.appointments_count::double precision / base.conversations_total::double precision
        else 0.0
    end as appointments_per_conversation
from public.sessions s
cross join lateral (
    select
        greatest(coalesce(s.doors_hit, s.flyers_delivered, s.completed_count, 0), 0) as doors_total,
        greatest(coalesce(s.conversations, 0), 0) as conversations_total,
        greatest(coalesce(s.leads_created, 0), 0) as leads_total,
        greatest(coalesce(s.distance_meters, 0), 0) / 1000.0 as distance_km,
        greatest(
            coalesce(
                nullif(s.active_seconds, 0)::double precision,
                extract(epoch from (coalesce(s.end_time, now()) - s.start_time))
            ),
            0.0
        ) as duration_seconds
) base
cross join lateral (
    select
        case
            when base.duration_seconds > 0 then
                base.doors_total::double precision / (base.duration_seconds / 3600.0)
            else 0.0
        end as doors_per_hour,
        case
            when base.duration_seconds > 0 then
                base.conversations_total::double precision / (base.duration_seconds / 3600.0)
            else 0.0
        end as conversations_per_hour,
        case
            when base.distance_km > 0 then
                base.doors_total::double precision / base.distance_km
            else 0.0
        end as completions_per_km
) pace
cross join lateral (
    select coalesce(count(*), 0)::integer as appointments_count
    from public.crm_events ce
    where ce.user_id = s.user_id
      and ce.fub_appointment_id is not null
      and ce.created_at >= s.start_time
      and ce.created_at < coalesce(s.end_time, now())
) appts;

alter view public.session_analytics set (security_invoker = true);

grant select on public.session_analytics to authenticated;

comment on view public.session_analytics is
    'Sessions with derived pace and conversion metrics, including conversations per door, leads per conversation, and appointment counts inferred from crm_events in the session time window.';

notify pgrst, 'reload schema';

commit;
