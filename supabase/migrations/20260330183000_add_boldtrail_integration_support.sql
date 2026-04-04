-- Allow BoldTrail CRM mappings alongside Follow Up Boss and monday.com.

update public.crm_object_links
set crm_type = 'boldtrail'
where lower(btrim(crm_type)) in ('boldtrail / kvcore', 'boldtrail/kvcore', 'boldtrail kvcore');

alter table public.crm_object_links
  drop constraint if exists crm_object_links_crm_type_check;

alter table public.crm_object_links
  add constraint crm_object_links_crm_type_check
  check (crm_type in ('fub', 'monday', 'boldtrail'));
