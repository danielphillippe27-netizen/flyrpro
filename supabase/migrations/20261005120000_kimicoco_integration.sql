alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name text;
alter table public.contacts add column if not exists appointment_title text;
alter table public.contacts add column if not exists appointment_notes text;
alter table public.contacts add column if not exists appointment_location text;
alter table public.contacts add column if not exists follow_up_title text;
alter table public.contacts add column if not exists follow_up_notes text;
create table public.kimicoco_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id), encrypted_key text not null,
 destination_workspace_id uuid not null, destination_workspace_name text not null,
 auto_sync boolean not null default true, generation uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(), last_sync_at timestamptz
);
create table public.kimicoco_sync_jobs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade, payload jsonb not null,
 version bigint not null default 1, status text not null default 'pending' check(status in ('pending','processing','synced','needs_attention')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, remote_client_id uuid, last_error text,
 updated_at timestamptz not null default now(), unique(workspace_id,contact_id)
);
alter table public.kimicoco_connections enable row level security;
alter table public.kimicoco_sync_jobs enable row level security;
-- Server routes verify workspace membership; credentials and jobs are not client-readable.
create index kimicoco_jobs_ready on public.kimicoco_sync_jobs(next_attempt_at) where status in ('pending','processing');
create or replace function public.enqueue_kimicoco_contact(p_workspace uuid,p_contact uuid)
returns void language plpgsql security definer set search_path='' as $$
declare contact jsonb;
begin
 if not exists(select 1 from public.kimicoco_connections where workspace_id=p_workspace) then return; end if;
 select to_jsonb(c) into contact from public.contacts c where c.id=p_contact and c.workspace_id=p_workspace;
 if contact is null then raise exception 'Contact not found in workspace'; end if;
 insert into public.kimicoco_sync_jobs(workspace_id,contact_id,payload) values(p_workspace,p_contact,contact)
 on conflict(workspace_id,contact_id) do update set payload=excluded.payload,version=kimicoco_sync_jobs.version+1,status='pending',attempts=0,next_attempt_at=now(),last_error=null,updated_at=now();
end $$;
create or replace function public.kimicoco_contact_saved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.kimicoco_connections where workspace_id=new.workspace_id and auto_sync) then
   if TG_OP='INSERT' or to_jsonb(new)-array['updated_at','last_contacted','last_contacted_at'] is distinct from to_jsonb(old)-array['updated_at','last_contacted','last_contacted_at'] then
     perform public.enqueue_kimicoco_contact(new.workspace_id,new.id);
   end if;
 end if;
 return new;
end $$;
create trigger kimicoco_contact_saved after insert or update on public.contacts for each row execute function public.kimicoco_contact_saved();
create or replace function public.claim_kimicoco_jobs(p_workspace uuid default null)
returns setof public.kimicoco_sync_jobs language sql security definer set search_path='' as $$
 with ready as (
 select j.id from public.kimicoco_sync_jobs j join public.kimicoco_connections c on c.workspace_id=j.workspace_id
 where (p_workspace is null or j.workspace_id=p_workspace) and j.status in ('pending','processing')
 and j.next_attempt_at<=now() and (j.lease_until is null or j.lease_until<now())
 order by j.next_attempt_at limit 12 for update of j skip locked
 ) update public.kimicoco_sync_jobs j set status='processing',lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
 from ready where j.id=ready.id returning j.*;
$$;
revoke all on function public.enqueue_kimicoco_contact(uuid,uuid),public.claim_kimicoco_jobs(uuid),public.kimicoco_contact_saved() from public,anon,authenticated;
grant execute on function public.enqueue_kimicoco_contact(uuid,uuid),public.claim_kimicoco_jobs(uuid) to service_role;
create or replace function public.reset_kimicoco_jobs(p_workspace uuid) returns void
language sql security definer set search_path='' as $$
 update public.kimicoco_sync_jobs set version=version+1,status='pending',attempts=0,next_attempt_at=now(),remote_client_id=null,last_error=null,updated_at=now() where workspace_id=p_workspace;
$$;
revoke all on function public.reset_kimicoco_jobs(uuid) from public,anon,authenticated;
grant execute on function public.reset_kimicoco_jobs(uuid) to service_role;
grant all on public.kimicoco_connections,public.kimicoco_sync_jobs to service_role;
create or replace function public.enqueue_kimicoco_workspace(p_workspace uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare contact record; total integer:=0;
begin
 if not exists(select 1 from public.kimicoco_connections where workspace_id=p_workspace) then raise exception 'KimiCoco not connected'; end if;
 for contact in select id from public.contacts where workspace_id=p_workspace loop
   perform public.enqueue_kimicoco_contact(p_workspace,contact.id); total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.enqueue_kimicoco_workspace(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_kimicoco_workspace(uuid) to service_role;
