-- Additive digital engagement; never changes canvassing dispositions or QR counters.
create table public.card_workspace_features (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 enabled boolean not null default false
);
create table public.card_profiles (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 rep_id uuid not null references auth.users(id) on delete cascade,
 content jsonb not null default '{}'::jsonb, published boolean not null default false,
 updated_at timestamptz not null default now(), unique(workspace_id,rep_id)
);
create table public.card_shares (
 id uuid primary key default gen_random_uuid(), token text not null unique,
 profile_id uuid not null references public.card_profiles(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 rep_id uuid not null references auth.users(id) on delete cascade,
 contact_id uuid references public.contacts(id) on delete set null,
 campaign_id uuid references public.campaigns(id) on delete set null,
 address_id uuid references public.campaign_addresses(id) on delete set null,
 building_id text, parent_share_id uuid references public.card_shares(id) on delete cascade,
 idempotency_key uuid not null, revoked_at timestamptz, created_at timestamptz not null default now(),
 unique(rep_id,workspace_id,idempotency_key), check(length(token)>=32)
);
create table public.card_events (
 id uuid primary key default gen_random_uuid(), share_id uuid not null references public.card_shares(id) on delete cascade,
 visit_id uuid not null, event_key text not null, event_type text not null, detail text,
 created_at timestamptz not null default now(), unique(share_id,visit_id,event_key)
);
create index card_events_share_time on public.card_events(share_id,created_at);
create index card_shares_contact on public.card_shares(contact_id);
create table public.card_property_engagement (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 address_id uuid primary key references public.campaign_addresses(id) on delete cascade,
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 building_id text, qualified_views integer not null default 0, last_engaged_at timestamptz not null default now()
);
create table public.card_referrals (
 id uuid primary key default gen_random_uuid(), share_id uuid not null references public.card_shares(id) on delete cascade,
 submission_id uuid not null, contact_id uuid references public.contacts(id) on delete set null,
 referrer_name text, note text, permission_acknowledged boolean not null, created_at timestamptz not null default now(),
 unique(share_id,submission_id)
);
create table public.card_rate_limits (bucket text primary key, window_start timestamptz not null, hits integer not null);
alter table public.card_workspace_features enable row level security;
alter table public.card_profiles enable row level security;
alter table public.card_shares enable row level security;
alter table public.card_events enable row level security;
alter table public.card_property_engagement enable row level security;
alter table public.card_referrals enable row level security;
alter table public.card_rate_limits enable row level security;
create policy card_feature_member_read on public.card_workspace_features for select to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=card_workspace_features.workspace_id and m.user_id=auth.uid()));
-- Private event/contact data is available only through authorized API endpoints.
create policy card_engagement_workspace_read on public.card_property_engagement for select to authenticated
 using (exists(select 1 from public.workspace_members m where m.workspace_id=card_property_engagement.workspace_id and m.user_id=auth.uid()) and exists(select 1 from public.card_workspace_features f where f.workspace_id=card_property_engagement.workspace_id and f.enabled));
create or replace function public.card_take_rate_limit(p_bucket text,p_limit integer) returns boolean
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into card_rate_limits values(p_bucket,date_trunc('minute',now()),1)
 on conflict(bucket) do update set hits=case when card_rate_limits.window_start<date_trunc('minute',now()) then 1 else card_rate_limits.hits+1 end,
 window_start=date_trunc('minute',now()) returning hits into n;
 delete from card_rate_limits where window_start<now()-interval '1 day';
 return n<=p_limit;
end $$;
create or replace function public.card_record_event(p_share uuid,p_visit uuid,p_key text,p_type text,p_detail text default null)
returns void language plpgsql security definer set search_path=public as $$
declare s card_shares; inserted integer;
begin
 select cs.* into s from card_shares cs join card_profiles cp on cp.id=cs.profile_id
 join card_workspace_features f on f.workspace_id=cs.workspace_id and f.enabled
 where cs.id=p_share and cs.revoked_at is null and cp.published for update of cs;
 if not found then raise exception 'Card unavailable'; end if;
 if exists (with recursive parents as (select id,parent_share_id,revoked_at from card_shares where id=s.id union all select p.id,p.parent_share_id,p.revoked_at from card_shares p join parents c on p.id=c.parent_share_id) select 1 from parents where revoked_at is not null) then raise exception 'Card unavailable'; end if;
 insert into card_events(share_id,visit_id,event_key,event_type,detail) values(s.id,p_visit,p_key,p_type,left(p_detail,100)) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 and p_type='qualified_open' and s.address_id is not null and s.parent_share_id is null then
 insert into card_property_engagement(workspace_id,address_id,campaign_id,building_id,qualified_views,last_engaged_at)
 values(s.workspace_id,s.address_id,s.campaign_id,s.building_id,1,now())
 on conflict(address_id) do update set qualified_views=card_property_engagement.qualified_views+1,last_engaged_at=now();
 end if;
end $$;
revoke all on function public.card_take_rate_limit(text,integer) from public,anon,authenticated;
revoke all on function public.card_record_event(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.card_take_rate_limit(text,integer) to service_role;
grant execute on function public.card_record_event(uuid,uuid,text,text,text) to service_role;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.card_property_engagement;
 end if;
end $$;
create or replace function public.card_submit_referral(p_share uuid,p_submission uuid,p_name text,p_phone text,p_email text,p_note text,p_referrer text)
returns uuid language plpgsql security definer set search_path=public as $$
declare s card_shares; existing uuid; cid uuid; matches uuid[];
begin
 select cs.* into s from card_shares cs join card_profiles cp on cp.id=cs.profile_id
 join card_workspace_features f on f.workspace_id=cs.workspace_id and f.enabled
 where cs.id=p_share and cs.revoked_at is null and cp.published for update of cs;
 if not found then raise exception 'Card unavailable'; end if;
 if exists (with recursive parents as (select id,parent_share_id,revoked_at from card_shares where id=s.id union all select p.id,p.parent_share_id,p.revoked_at from card_shares p join parents c on p.id=c.parent_share_id) select 1 from parents where revoked_at is not null) then raise exception 'Card unavailable'; end if;
 select contact_id into existing from card_referrals where share_id=p_share and submission_id=p_submission;
 if found then return existing; end if;
 -- Serialize matching within the owner's workspace, including submissions from different shares.
 perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text||s.rep_id::text,0));
 select array_agg(id) into matches from contacts where workspace_id=s.workspace_id and user_id=s.rep_id
 and ((nullif(p_email,'') is not null and lower(email)=lower(p_email)) or
 (nullif(p_phone,'') is not null and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g')))
;
 if cardinality(matches)=1 then cid=matches[1]; end if;
 if cid is null then
 insert into contacts(user_id,workspace_id,full_name,phone,email,status,source,notes)
 values(s.rep_id,s.workspace_id,p_name,nullif(p_phone,''),nullif(p_email,''),'new','business_card_referral',nullif(p_note,'')) returning id into cid;
 end if;
 insert into card_referrals(share_id,submission_id,contact_id,referrer_name,note,permission_acknowledged)
 values(s.id,p_submission,cid,p_referrer,nullif(p_note,''),true);
 insert into card_events(share_id,visit_id,event_key,event_type) values(s.id,p_submission,'referral','referral_submitted') on conflict do nothing;
 if s.parent_share_id is not null then
 insert into card_events(share_id,visit_id,event_key,event_type) values(s.parent_share_id,p_submission,'referral','referral_submitted') on conflict do nothing;
 end if;
 return cid;
end $$;
revoke all on function public.card_submit_referral(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.card_submit_referral(uuid,uuid,text,text,text,text,text) to service_role;

grant select on public.card_workspace_features, public.card_property_engagement to authenticated;
grant all on public.card_workspace_features, public.card_profiles, public.card_shares, public.card_events, public.card_property_engagement, public.card_referrals, public.card_rate_limits to service_role;
