-- Contact-only referrals satisfy the existing required address field without household attribution.
create or replace function public.card_submit_referral(p_share uuid,p_submission uuid,p_name text,p_phone text,p_email text,p_note text,p_referrer text)
returns uuid language plpgsql security definer set search_path=public as $$
declare s card_shares; existing uuid; cid uuid; matches uuid[];
begin
 select cs.* into s from card_shares cs join card_profiles cp on cp.id=cs.profile_id
 join card_workspace_features f on f.workspace_id=cs.workspace_id and f.enabled
 where cs.id=p_share and cs.revoked_at is null and cp.published for update of cs;
 if not found then raise exception 'Card unavailable'; end if;
 if exists (with recursive parents as (select id,parent_share_id,revoked_at from card_shares where id=s.id union all select p.id,p.parent_share_id,p.revoked_at from card_shares p join parents c on p.id=c.parent_share_id) select 1 from parents where revoked_at is not null) then raise exception 'Card unavailable'; end if;
 select contact_id into existing from card_referrals where share_id=p_share and submission_id=p_submission;
 if found then return existing; end if;
 -- Serialize matching within the owner's workspace, including submissions from different shares.
 perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text||s.rep_id::text,0));
 select array_agg(id) into matches from contacts where workspace_id=s.workspace_id and user_id=s.rep_id
 and ((nullif(p_email,'') is not null and lower(email)=lower(p_email)) or
 (nullif(p_phone,'') is not null and regexp_replace(phone,'[^0-9]','','g')=regexp_replace(p_phone,'[^0-9]','','g')))
;
 if cardinality(matches)=1 then cid=matches[1]; end if;
 if cid is null then
 insert into contacts(user_id,workspace_id,full_name,address,phone,email,status,source,notes)
 values(s.rep_id,s.workspace_id,p_name,'',nullif(p_phone,''),nullif(p_email,''),'new','business_card_referral',nullif(p_note,'')) returning id into cid;
 end if;
 insert into card_referrals(share_id,submission_id,contact_id,referrer_name,note,permission_acknowledged)
 values(s.id,p_submission,cid,p_referrer,nullif(p_note,''),true);
 insert into card_events(share_id,visit_id,event_key,event_type) values(s.id,p_submission,'referral','referral_submitted') on conflict do nothing;
 if s.parent_share_id is not null then
 insert into card_events(share_id,visit_id,event_key,event_type) values(s.parent_share_id,p_submission,'referral','referral_submitted') on conflict do nothing;
 end if;
 return cid;
end $$;
