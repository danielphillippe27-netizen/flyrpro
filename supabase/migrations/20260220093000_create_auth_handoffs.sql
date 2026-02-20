create table if not exists public.auth_handoffs (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  user_agent text null,
  ip text null,
  constraint auth_handoffs_expiry_window_chk
    check (
      expires_at >= created_at
      and expires_at <= created_at + interval '2 minutes'
    )
);

create index if not exists auth_handoffs_user_id_idx
  on public.auth_handoffs (user_id);

create index if not exists auth_handoffs_expires_at_idx
  on public.auth_handoffs (expires_at);

alter table public.auth_handoffs enable row level security;

revoke all on public.auth_handoffs from anon, authenticated;

drop policy if exists auth_handoffs_deny_anon on public.auth_handoffs;
create policy auth_handoffs_deny_anon
  on public.auth_handoffs
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists auth_handoffs_deny_authenticated on public.auth_handoffs;
create policy auth_handoffs_deny_authenticated
  on public.auth_handoffs
  for all
  to authenticated
  using (false)
  with check (false);
