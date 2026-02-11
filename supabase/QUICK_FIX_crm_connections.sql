-- Run this in Supabase Dashboard → SQL Editor if Follow Up Boss connect returns 500
-- (creates crm_connections table for integrations, or adds missing columns + refreshes schema cache)

create table if not exists public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  api_key_encrypted text not null,
  status text default 'connected',
  created_at timestamp default now(),
  updated_at timestamp default now(),
  last_tested_at timestamp,
  last_push_at timestamp,
  last_error text
);

-- Drop provider check constraint if it only allows a fixed list (e.g. excludes 'followupboss')
alter table public.crm_connections drop constraint if exists crm_connections_provider_check;

-- If table already existed with old schema, add any missing columns
alter table public.crm_connections add column if not exists api_key_encrypted text;
alter table public.crm_connections add column if not exists status text default 'connected';
alter table public.crm_connections add column if not exists created_at timestamp default now();
alter table public.crm_connections add column if not exists updated_at timestamp default now();
alter table public.crm_connections add column if not exists last_tested_at timestamp;
alter table public.crm_connections add column if not exists last_push_at timestamp;
alter table public.crm_connections add column if not exists last_error text;

alter table public.crm_connections enable row level security;

drop policy if exists "own crm_connections" on public.crm_connections;
create policy "own crm_connections"
on public.crm_connections for all
using (auth.uid() = user_id);

create index if not exists idx_crm_connections_user_id on public.crm_connections(user_id);
create index if not exists idx_crm_connections_provider on public.crm_connections(provider);
create unique index if not exists idx_crm_connections_user_provider on public.crm_connections(user_id, provider);

-- Tell PostgREST to reload schema cache so the new column is visible
notify pgrst, 'reload schema';
