-- Add stripe_customer_id and stripe_subscription_id to entitlements if missing
-- (handles tables created before these columns were in the create migration)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'entitlements'
      and column_name = 'stripe_customer_id'
  ) then
    alter table public.entitlements add column stripe_customer_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'entitlements'
      and column_name = 'stripe_subscription_id'
  ) then
    alter table public.entitlements add column stripe_subscription_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'entitlements'
      and column_name = 'current_period_end'
  ) then
    alter table public.entitlements add column current_period_end timestamptz;
  end if;
end $$;
