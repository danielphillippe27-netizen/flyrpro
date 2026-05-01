DROP FUNCTION IF EXISTS public.hydrate_campaign_gold_addresses(uuid, text, text, integer);

NOTIFY pgrst, 'reload schema';
