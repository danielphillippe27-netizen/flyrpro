BEGIN;
-- Server route checks membership and determines whether owner scope is needed.
-- Explicit GeoJSON avoids depending on PostgREST's geometry serialization.
CREATE OR REPLACE FUNCTION public.storm_review_boundaries(p_workspace_id uuid, p_owner_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, status text, territory_boundary jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.id,c.name::text,c.status::text,ST_AsGeoJSON(c.territory_boundary)::jsonb
  FROM public.campaigns c
  WHERE c.workspace_id=p_workspace_id AND c.territory_boundary IS NOT NULL
    AND (p_owner_id IS NULL OR c.owner_id=p_owner_id)
  ORDER BY c.created_at DESC,c.id DESC LIMIT 501;
$$;
REVOKE ALL ON FUNCTION public.storm_review_boundaries(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storm_review_boundaries(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
