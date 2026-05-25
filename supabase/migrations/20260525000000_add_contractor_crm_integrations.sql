-- Allow contractor/home-service CRM mappings alongside existing real-estate CRMs.

alter table public.crm_object_links
  drop constraint if exists crm_object_links_crm_type_check;

alter table public.crm_object_links
  add constraint crm_object_links_crm_type_check
  check (
    crm_type in (
      'fub',
      'monday',
      'boldtrail',
      'hubspot',
      'jobnimbus',
      'companycam',
      'jobber',
      'acculynx',
      'sumoquote',
      'rooflink'
    )
  );
