-- Create flyers table for campaign flyer editor
create table if not exists flyers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null default 'New Flyer',
  size text not null default 'LETTER_8_5x11',
  data jsonb not null default '{"backgroundColor": "#ffffff", "elements": []}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create index on campaign_id for faster lookups
create index if not exists idx_flyers_campaign_id on flyers(campaign_id);

-- Enable RLS
alter table flyers enable row level security;

-- RLS Policy: Users can only access flyers for campaigns they own
create policy "Users can view flyers for their campaigns"
on flyers for select
using (
  exists (
    select 1 from campaigns
    where campaigns.id = flyers.campaign_id
    and campaigns.owner_id = auth.uid()
  )
);

-- RLS Policy: Users can insert flyers for their campaigns
create policy "Users can create flyers for their campaigns"
on flyers for insert
with check (
  exists (
    select 1 from campaigns
    where campaigns.id = flyers.campaign_id
    and campaigns.owner_id = auth.uid()
  )
);

-- RLS Policy: Users can update flyers for their campaigns
create policy "Users can update flyers for their campaigns"
on flyers for update
using (
  exists (
    select 1 from campaigns
    where campaigns.id = flyers.campaign_id
    and campaigns.owner_id = auth.uid()
  )
);

-- RLS Policy: Users can delete flyers for their campaigns
create policy "Users can delete flyers for their campaigns"
on flyers for delete
using (
  exists (
    select 1 from campaigns
    where campaigns.id = flyers.campaign_id
    and campaigns.owner_id = auth.uid()
  )
);

-- Create function to update updated_at timestamp
create or replace function update_flyers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger to automatically update updated_at
create trigger update_flyers_updated_at
before update on flyers
for each row
execute function update_flyers_updated_at();

-- Storage bucket for flyer images
insert into storage.buckets (id, name, public)
values ('flyers', 'flyers', true)
on conflict (id) do nothing;

-- Storage policy for flyer images (public read)
create policy "Public flyer image access"
on storage.objects for select
using (bucket_id = 'flyers');

-- Storage policy for authenticated users to upload flyer images
create policy "Authenticated can upload flyer images"
on storage.objects for insert
with check (bucket_id = 'flyers' and auth.role() = 'authenticated');

-- Storage policy for authenticated users to update their flyer images
create policy "Authenticated can update flyer images"
on storage.objects for update
using (bucket_id = 'flyers' and auth.role() = 'authenticated');

-- Storage policy for authenticated users to delete their flyer images
create policy "Authenticated can delete flyer images"
on storage.objects for delete
using (bucket_id = 'flyers' and auth.role() = 'authenticated');

