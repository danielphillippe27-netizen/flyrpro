create table public.crm_email_templates (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  subject text not null check (char_length(btrim(subject)) between 1 and 200 and subject !~ E'[\\r\\n]'),
  body text not null check (char_length(btrim(body)) between 1 and 10000)
);

create index crm_email_templates_owner_name on public.crm_email_templates (user_id, name, id);
alter table public.crm_email_templates enable row level security;
revoke all on public.crm_email_templates from public, anon;
grant select, insert, update, delete on public.crm_email_templates to authenticated;
create policy "Users manage their own email templates"
  on public.crm_email_templates for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
