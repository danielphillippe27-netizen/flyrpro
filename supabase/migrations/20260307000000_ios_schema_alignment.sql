-- Align schema with active iOS app write/read paths.
-- This migration is idempotent and safe to run on environments that already contain some objects.

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- address_content (used by iOS QR content editor)
-- ---------------------------------------------------------------------------
create table if not exists public.address_content (
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null references public.campaign_addresses(id) on delete cascade,
  title text not null default '',
  videos text[] not null default array[]::text[],
  images text[] not null default array[]::text[],
  forms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_address_content_address_id on public.address_content(address_id);
create index if not exists idx_address_content_updated_at on public.address_content(updated_at desc);

create or replace function public.set_address_content_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_address_content_updated_at on public.address_content;
create trigger trg_address_content_updated_at
before update on public.address_content
for each row
execute function public.set_address_content_updated_at();

alter table public.address_content enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'address_content' and policyname = 'address_content_select_owner_or_member'
  ) then
    create policy address_content_select_owner_or_member
      on public.address_content
      for select
      using (
        exists (
          select 1
          from public.campaign_addresses ca
          join public.campaigns c on c.id = ca.campaign_id
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where ca.id = address_content.address_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'address_content' and policyname = 'address_content_insert_owner_or_member'
  ) then
    create policy address_content_insert_owner_or_member
      on public.address_content
      for insert
      with check (
        exists (
          select 1
          from public.campaign_addresses ca
          join public.campaigns c on c.id = ca.campaign_id
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where ca.id = address_content.address_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'address_content' and policyname = 'address_content_update_owner_or_member'
  ) then
    create policy address_content_update_owner_or_member
      on public.address_content
      for update
      using (
        exists (
          select 1
          from public.campaign_addresses ca
          join public.campaigns c on c.id = ca.campaign_id
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where ca.id = address_content.address_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      )
      with check (
        exists (
          select 1
          from public.campaign_addresses ca
          join public.campaigns c on c.id = ca.campaign_id
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where ca.id = address_content.address_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- QR scan helper RPCs used by iOS
-- ---------------------------------------------------------------------------
create or replace function public.get_address_scan_count(p_address_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select count(*)::bigint
    from public.qr_code_scans
    where address_id = p_address_id
  );
end;
$$;

create or replace function public.get_campaign_scan_count(p_campaign_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select count(*)::bigint
    from public.qr_code_scans qcs
    join public.campaign_addresses ca on ca.id = qcs.address_id
    where ca.campaign_id = p_campaign_id
  );
end;
$$;

grant execute on function public.get_address_scan_count(uuid) to anon, authenticated, service_role;
grant execute on function public.get_campaign_scan_count(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- campaign_qr_batches (used by iOS export metadata)
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_qr_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  batch_name text not null,
  zip_url text,
  pdf_grid_url text,
  pdf_single_url text,
  csv_url text,
  created_at timestamptz not null default now(),
  constraint uq_campaign_qr_batches_campaign_id_batch_name unique (campaign_id, batch_name)
);

create index if not exists idx_campaign_qr_batches_campaign_id on public.campaign_qr_batches(campaign_id);
create index if not exists idx_campaign_qr_batches_created_at on public.campaign_qr_batches(created_at desc);

alter table public.campaign_qr_batches enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'campaign_qr_batches' and policyname = 'campaign_qr_batches_select_owner_or_member'
  ) then
    create policy campaign_qr_batches_select_owner_or_member
      on public.campaign_qr_batches
      for select
      using (
        exists (
          select 1
          from public.campaigns c
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where c.id = campaign_qr_batches.campaign_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'campaign_qr_batches' and policyname = 'campaign_qr_batches_insert_owner_or_member'
  ) then
    create policy campaign_qr_batches_insert_owner_or_member
      on public.campaign_qr_batches
      for insert
      with check (
        exists (
          select 1
          from public.campaigns c
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where c.id = campaign_qr_batches.campaign_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'campaign_qr_batches' and policyname = 'campaign_qr_batches_update_owner_or_member'
  ) then
    create policy campaign_qr_batches_update_owner_or_member
      on public.campaign_qr_batches
      for update
      using (
        exists (
          select 1
          from public.campaigns c
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where c.id = campaign_qr_batches.campaign_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      )
      with check (
        exists (
          select 1
          from public.campaigns c
          left join public.workspace_members wm
            on wm.workspace_id = c.workspace_id and wm.user_id = auth.uid()
          where c.id = campaign_qr_batches.campaign_id
            and (c.owner_id = auth.uid() or wm.user_id is not null)
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- building_touches (real write path from iOS map interactions)
-- ---------------------------------------------------------------------------
create table if not exists public.building_touches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address_id uuid not null references public.campaign_addresses(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  building_id text,
  session_id uuid references public.sessions(id) on delete set null,
  touched_at timestamptz not null default now()
);

create index if not exists idx_building_touches_user_id on public.building_touches(user_id);
create index if not exists idx_building_touches_campaign_id on public.building_touches(campaign_id);
create index if not exists idx_building_touches_address_id on public.building_touches(address_id);
create index if not exists idx_building_touches_touched_at on public.building_touches(touched_at desc);

alter table public.building_touches enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'building_touches' and policyname = 'building_touches_insert_own'
  ) then
    create policy building_touches_insert_own
      on public.building_touches
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'building_touches' and policyname = 'building_touches_select_own'
  ) then
    create policy building_touches_select_own
      on public.building_touches
      for select
      using (auth.uid() = user_id);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- CRM voice-log support tables (used by iOS backend route parity)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_object_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crm_type text not null default 'fub' check (crm_type in ('fub')),
  flyr_lead_id uuid,
  flyr_address_id uuid,
  fub_person_id bigint not null,
  created_at timestamptz not null default now(),
  constraint crm_object_links_lead_or_address check (flyr_lead_id is not null or flyr_address_id is not null)
);

create unique index if not exists idx_crm_object_links_user_crm_lead
  on public.crm_object_links (user_id, crm_type, flyr_lead_id)
  where flyr_lead_id is not null;

create unique index if not exists idx_crm_object_links_user_crm_address
  on public.crm_object_links (user_id, crm_type, flyr_address_id)
  where flyr_address_id is not null;

create index if not exists idx_crm_object_links_user_id on public.crm_object_links(user_id);

alter table public.crm_object_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_object_links' and policyname = 'crm_object_links_select_own'
  ) then
    create policy crm_object_links_select_own
      on public.crm_object_links
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_object_links' and policyname = 'crm_object_links_insert_own'
  ) then
    create policy crm_object_links_insert_own
      on public.crm_object_links
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_object_links' and policyname = 'crm_object_links_update_own'
  ) then
    create policy crm_object_links_update_own
      on public.crm_object_links
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crm_type text not null default 'fub' check (crm_type in ('fub')),
  flyr_event_id uuid not null,
  fub_person_id bigint,
  fub_note_id bigint,
  fub_task_id bigint,
  fub_appointment_id bigint,
  transcript text,
  ai_json jsonb,
  created_at timestamptz not null default now(),
  constraint uq_crm_events_user_event unique (user_id, flyr_event_id)
);

create index if not exists idx_crm_events_user_id on public.crm_events(user_id);
create index if not exists idx_crm_events_user_event on public.crm_events(user_id, flyr_event_id);

alter table public.crm_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_events' and policyname = 'crm_events_select_own'
  ) then
    create policy crm_events_select_own
      on public.crm_events
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'crm_events' and policyname = 'crm_events_insert_own'
  ) then
    create policy crm_events_insert_own
      on public.crm_events
      for insert
      with check (auth.uid() = user_id);
  end if;
end
$$;

grant select, insert, update, delete on public.crm_object_links to authenticated;
grant select, insert on public.crm_events to authenticated;
grant all on public.crm_object_links to service_role;
grant all on public.crm_events to service_role;

notify pgrst, 'reload schema';
