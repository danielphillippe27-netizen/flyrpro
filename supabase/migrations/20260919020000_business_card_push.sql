create table public.card_push_queue (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.card_events(id) on delete cascade,
 share_id uuid not null references public.card_shares(id) on delete cascade,
 visit_id uuid not null,
 event_type text not null,
 detail text not null default '',
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 delivered_token_ids uuid[] not null default '{}',
 last_error text,
 created_at timestamptz not null default now(),
 unique(share_id,visit_id,event_type,detail)
);
alter table public.card_push_queue enable row level security;
revoke all on public.card_push_queue from anon, authenticated;
grant all on public.card_push_queue to service_role;
create index card_push_pending on public.card_push_queue(available_at) where sent_at is null;
create function public.enqueue_card_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_type in ('qualified_open','call_clicked','text_clicked','email_clicked','contact_downloaded','social_clicked','website_clicked','review_clicked','referral_started') then
  insert into public.card_push_queue(event_id,share_id,visit_id,event_type,detail)
  values(new.id,new.share_id,new.visit_id,new.event_type,coalesce(new.detail,'')) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.enqueue_card_push() from public,anon,authenticated;
create trigger card_event_push after insert on public.card_events for each row execute function public.enqueue_card_push();
create function public.claim_card_push(p_share uuid default null) returns setof public.card_push_queue
language sql security definer set search_path='' as $$
 update public.card_push_queue set attempts=attempts+1,available_at=now()+interval '2 minutes'
 where id in (select id from public.card_push_queue where sent_at is null and attempts<6 and available_at<=now()
 and (p_share is null or share_id=p_share) order by created_at for update skip locked limit 10)
 returning *;
$$;
revoke all on function public.claim_card_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_card_push(uuid) to service_role;
