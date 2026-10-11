BEGIN;
CREATE OR REPLACE FUNCTION public.storm_campaign_stop_counts(p_campaign_ids uuid[])
RETURNS TABLE(id uuid,total bigint,visited bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.id,count(a.id),count(a.id) FILTER (WHERE a.visited IS TRUE)
  FROM campaigns c LEFT JOIN campaign_addresses a ON a.campaign_id=c.id AND a.deleted_at IS NULL
  WHERE c.id=ANY(p_campaign_ids) AND cardinality(p_campaign_ids)<=50
  GROUP BY c.id;
$$;
REVOKE ALL ON FUNCTION public.storm_campaign_stop_counts(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storm_campaign_stop_counts(uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
