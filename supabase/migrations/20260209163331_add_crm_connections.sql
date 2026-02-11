-- CRM connections for integrations
-- Provider examples: followupboss

create table if not exists crm_connections (
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

-- Enable RLS on crm_connections
alter table crm_connections enable row level security;

-- Users can only see/manage their own CRM connections
create policy "own crm_connections"
on crm_connections for all
using (auth.uid() = user_id);

-- Index for faster lookups by user
create index if not exists idx_crm_connections_user_id 
on crm_connections(user_id);

-- Index for provider lookups
create index if not exists idx_crm_connections_provider 
on crm_connections(provider);

-- Unique constraint to prevent duplicate connections per user/provider
create unique index if not exists idx_crm_connections_user_provider 
on crm_connections(user_id, provider);
