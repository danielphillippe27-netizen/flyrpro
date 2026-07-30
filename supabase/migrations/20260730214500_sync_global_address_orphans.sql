-- Reconciliation is the canonical one-to-one link authority for detached
-- campaigns. Rebuild the orphan queue from the final link set in the same
-- transaction so legacy/incomplete orphan rows cannot skew reports.

CREATE OR REPLACE FUNCTION public.sync_campaign_address_orphans(
  p_campaign_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.address_orphans orphan
  WHERE orphan.campaign_id = p_campaign_id
    AND EXISTS (
      SELECT 1
      FROM public.building_address_links link
      WHERE link.campaign_id = p_campaign_id
        AND link.address_id = orphan.address_id
        AND coalesce(link.link_state, 'active') = 'active'
    );

  INSERT INTO public.address_orphans (
    campaign_id,
    address_id,
    address_street,
    suggested_buildings,
    status,
    suggested_street,
    coordinate
  )
  SELECT
    p_campaign_id,
    address.id,
    address.street_name,
    '[]'::jsonb,
    'pending_review',
    address.street_name,
    address.geom
  FROM public.campaign_addresses address
  WHERE address.campaign_id = p_campaign_id
    AND address.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.building_address_links link
      WHERE link.campaign_id = p_campaign_id
        AND link.address_id = address.id
        AND coalesce(link.link_state, 'active') = 'active'
    )
  ON CONFLICT (address_id) DO UPDATE SET
    status = CASE
      WHEN public.address_orphans.status IN ('assigned', 'dismissed')
        THEN public.address_orphans.status
      ELSE 'pending_review'
    END,
    address_street = EXCLUDED.address_street,
    suggested_street = EXCLUDED.suggested_street,
    coordinate = EXCLUDED.coordinate;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure(
    'public.apply_global_reverse_assignment_core(uuid,uuid,jsonb,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.apply_global_reverse_assignment(uuid, uuid, jsonb, text)
      RENAME TO apply_global_reverse_assignment_core;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_global_reverse_assignment(
  p_campaign_id uuid,
  p_run_id uuid,
  p_assignments jsonb,
  p_algorithm_version text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applied integer;
BEGIN
  v_applied := public.apply_global_reverse_assignment_core(
    p_campaign_id,
    p_run_id,
    p_assignments,
    p_algorithm_version
  );
  PERFORM public.sync_campaign_address_orphans(p_campaign_id);
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_campaign_address_orphans(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_campaign_address_orphans(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.apply_global_reverse_assignment_core(
  uuid, uuid, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_global_reverse_assignment_core(
  uuid, uuid, jsonb, text
) TO service_role;
REVOKE ALL ON FUNCTION public.apply_global_reverse_assignment(
  uuid, uuid, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_global_reverse_assignment(
  uuid, uuid, jsonb, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
