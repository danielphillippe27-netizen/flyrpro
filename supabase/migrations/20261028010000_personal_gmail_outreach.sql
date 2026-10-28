-- Tokens are available only to the server service role, never browser clients.
create table if not exists public.personal_gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  tokens_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.personal_gmail_connections enable row level security;
revoke all on public.personal_gmail_connections from anon, authenticated;
grant all on public.personal_gmail_connections to service_role;

create table if not exists public.gmail_outreach_sends (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  contact_id uuid not null,
  workspace_id uuid not null,
  content_hash text not null,
  status text not null check (status in ('sending','accepted','failed','unknown')),
  provider_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id, contact_id)
);
alter table public.gmail_outreach_sends enable row level security;
revoke all on public.gmail_outreach_sends from anon, authenticated;
grant all on public.gmail_outreach_sends to service_role;
