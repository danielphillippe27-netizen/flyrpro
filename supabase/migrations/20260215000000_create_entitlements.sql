-- Entitlements: single source of truth for plan/status (Free, Pro, Team).
-- Used by Stripe webhooks, Apple verify, and server routes. User-scoped for v1.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  is_active boolean not null default false,
  source text not null default 'none' check (source in ('none', 'stripe', 'apple')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.entitlements is 'User subscription entitlements; source of truth for web + iOS. Writes via service role only.';

alter table public.entitlements enable row level security;

-- Users can read their own row only.
create policy "entitlements_select_own"
  on public.entitlements for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for anon or authenticated; service role only.
-- getEntitlementForUser() uses createAdminClient() to insert default row when missing.

-- Backfill from user_profiles so existing Pro users get a row
insert into public.entitlements (user_id, plan, is_active, source, stripe_customer_id, updated_at)
select user_id, 'pro', true, 'stripe', stripe_customer_id, now()
from public.user_profiles
where (pro_active = true or stripe_customer_id is not null)
  and user_id not in (select user_id from public.entitlements)
on conflict (user_id) do nothing;
