alter table public.user_integrations
  drop constraint if exists user_integrations_provider_check;

alter table public.user_integrations
  add constraint user_integrations_provider_check
  check (
    provider in (
      'fub',
      'kvcore',
      'boldtrail',
      'hubspot',
      'monday',
      'zapier',
      'jobber',
      'companycam',
      'sumoquote'
    )
  );
