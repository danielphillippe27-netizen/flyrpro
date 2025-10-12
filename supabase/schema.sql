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

