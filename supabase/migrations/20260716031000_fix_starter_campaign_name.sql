update public.campaigns
set
  name = 'FIRST CAMPAIGN',
  title = 'FIRST CAMPAIGN'
where lower(trim(coalesce(name, ''))) = 'first campaign campaign'
   or lower(trim(coalesce(title, ''))) = 'first campaign campaign';
