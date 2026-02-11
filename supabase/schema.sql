-- campaigns
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  type text check (type in ('letters','flyers')) default 'letters',
  destination_url text,
  created_at timestamp default now()
);

-- recipients
create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  address_line text,
  city text,
  region text,
  postal_code text,
  status text default 'pending',   -- pending|sent|scanned
  sent_at timestamp,
  scanned_at timestamp,
  qr_png_url text
);

-- user_profiles to hold pro_active
create table if not exists user_profiles (
  user_id uuid primary key,
  pro_active boolean default false,
  stripe_customer_id text,
  created_at timestamp default now()
);

-- RLS
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table user_profiles enable row level security;

create policy "own campaigns"
on campaigns for all
using (auth.uid() = user_id);

create policy "recipients by owner"
on campaign_recipients for all
using (exists (select 1 from campaigns c where c.id = campaign_recipients.campaign_id and c.user_id = auth.uid()));

create policy "own profile"
on user_profiles for all
using (auth.uid() = user_id);

-- Storage bucket for QR codes
insert into storage.buckets (id, name, public)
values ('qr', 'qr', true)
on conflict (id) do nothing;

-- Storage policy for QR codes
create policy "Public QR access"
on storage.objects for select
using (bucket_id = 'qr');

create policy "Authenticated can upload QRs"
on storage.objects for insert
with check (bucket_id = 'qr' and auth.role() = 'authenticated');

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

