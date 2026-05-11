DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND constraint_name = 'campaigns_type_check'
  ) THEN
    ALTER TABLE public.campaigns
    DROP CONSTRAINT campaigns_type_check;
  END IF;

  ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_type_check
  CHECK (
    type IN (
      'flyer',
      'door_knock',
      'event',
      'survey',
      'gift',
      'pop_by',
      'open_house',
      'coming_soon',
      'market_update',
      'letters',
      'just_sold',
      'just_listed',
      'prospecting',
      'other'
    )
  );
END $$;
