-- Ensure user_integrations exists and api_key is TEXT (not VARCHAR) so FUB API keys (40+ chars) are not truncated.
-- Used by web app (followupboss/connect) and iOS Edge Function (crm_sync).

create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  api_key text,
  access_token text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (user_id, provider)
);

-- Add api_key if missing, then ensure type is TEXT (fix truncation if it was VARCHAR(n))
alter table public.user_integrations
  add column if not exists api_key text;
alter table public.user_integrations
  alter column api_key type text;

-- RLS so users only see their own rows
alter table public.user_integrations enable row level security;

drop policy if exists "own user_integrations" on public.user_integrations;
create policy "own user_integrations"
  on public.user_integrations for all
  using (auth.uid() = user_id);

create index if not exists idx_user_integrations_user_id on public.user_integrations(user_id);
create index if not exists idx_user_integrations_provider on public.user_integrations(provider);
