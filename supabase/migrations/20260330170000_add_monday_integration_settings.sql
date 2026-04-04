-- Add monday.com integration state and generic remote object link fields.

alter table public.user_integrations
  add column if not exists refresh_token text,
  add column if not exists expires_at bigint,
  add column if not exists webhook_url text,
  add column if not exists account_id text,
  add column if not exists account_name text,
  add column if not exists selected_board_id text,
  add column if not exists selected_board_name text,
  add column if not exists provider_config jsonb not null default '{}'::jsonb;

comment on column public.user_integrations.account_id is 'External account identifier for OAuth CRM integrations (e.g. monday account id).';
comment on column public.user_integrations.account_name is 'Display name for the connected external account.';
comment on column public.user_integrations.selected_board_id is 'Selected monday.com board id for outbound sync.';
comment on column public.user_integrations.selected_board_name is 'Selected monday.com board name for outbound sync.';
comment on column public.user_integrations.provider_config is 'Provider-specific JSON config such as monday workspace info and column mapping.';

alter table public.crm_object_links
  drop constraint if exists crm_object_links_crm_type_check;

alter table public.crm_object_links
  add constraint crm_object_links_crm_type_check
  check (crm_type in ('fub', 'monday'));

alter table public.crm_object_links
  alter column fub_person_id drop not null;

alter table public.crm_object_links
  add column if not exists remote_object_id text,
  add column if not exists remote_object_type text,
  add column if not exists remote_metadata jsonb not null default '{}'::jsonb;

update public.crm_object_links
set remote_object_id = coalesce(remote_object_id, fub_person_id::text),
    remote_object_type = coalesce(remote_object_type, case when crm_type = 'fub' then 'person' else null end)
where remote_object_id is null;

create index if not exists idx_crm_object_links_remote_object_id
  on public.crm_object_links (crm_type, remote_object_id)
  where remote_object_id is not null;

comment on column public.crm_object_links.remote_object_id is 'Provider-specific remote object id (for example monday item id).';
comment on column public.crm_object_links.remote_object_type is 'Provider-specific remote object type (for example person or item).';
comment on column public.crm_object_links.remote_metadata is 'Provider-specific metadata for the linked remote object.';
