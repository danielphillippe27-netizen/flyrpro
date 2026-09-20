-- Business cards are available to all workspaces; publishing remains opt-in.
alter table public.card_workspace_features alter column enabled set default true;

create function public.enable_business_cards_for_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.card_workspace_features (workspace_id, enabled)
  values (new.id, true)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.enable_business_cards_for_new_workspace() from public, anon, authenticated;

create trigger enable_business_cards_after_workspace_insert
  after insert on public.workspaces
  for each row execute function public.enable_business_cards_for_new_workspace();

insert into public.card_workspace_features (workspace_id, enabled)
select id, true from public.workspaces
on conflict (workspace_id) do update set enabled = excluded.enabled;
