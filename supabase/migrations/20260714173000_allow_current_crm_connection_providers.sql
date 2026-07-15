-- Keep crm_connections aligned with the integration catalog.
alter table public.crm_connections
  drop constraint if exists crm_connections_provider_check;

alter table public.crm_connections
  add constraint crm_connections_provider_check
  check (
    provider in (
      'followupboss',
      'fub',
      'hubspot',
      'boldtrail',
      'zapier',
      'monday',
      'jobnimbus',
      'companycam',
      'jobber',
      'acculynx',
      'sumoquote',
      'rooflink'
    )
  );
