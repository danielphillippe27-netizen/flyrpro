BEGIN;

-- The legacy SECURITY INVOKER implementation evaluated campaign-address RLS for
-- every row in the table before grouping. At production scale that causes the
-- mobile campaign-list request to time out and the clients to display zero.
--
-- Resolve authorization once per campaign, then count through the indexed
-- campaign_id join. Keeping the existing no-argument signature fixes released
-- mobile clients as soon as this migration is deployed.
CREATE OR REPLACE FUNCTION public.get_campaign_address_counts()
RETURNS TABLE (campaign_id uuid, address_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authorized_campaigns AS MATERIALIZED (
    SELECT c.id
    FROM public.campaigns c
    WHERE auth.role() = 'service_role'
       OR public.can_view_campaign(c.id)
  )
  SELECT authorized.id AS campaign_id,
         count(addresses.id)::bigint AS address_count
  FROM authorized_campaigns authorized
  LEFT JOIN public.campaign_addresses addresses
    ON addresses.campaign_id = authorized.id
   AND addresses.deleted_at IS NULL
  GROUP BY authorized.id;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_address_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_address_counts() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_campaign_address_counts() IS
  'Returns live home counts for campaigns the caller can view, authorizing once per campaign instead of once per address row.';

COMMIT;
