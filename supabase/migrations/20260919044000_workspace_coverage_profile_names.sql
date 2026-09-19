-- Match the production profile schema. Preserve existing function permissions.
CREATE OR REPLACE FUNCTION public.get_campaign_workspace_coverage(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_workspace uuid; v_enabled boolean; v_rows jsonb; v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_campaign(p_campaign_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Campaign access denied';
  END IF;
  SELECT workspace_id INTO v_workspace FROM campaigns WHERE id = p_campaign_id;
  -- Membership required even if a campaign was individually shared across teams.
  IF v_workspace IS NULL OR NOT (public.can_manage_workspace_coverage(v_workspace) OR EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = v_workspace AND user_id = auth.uid()
  )) THEN RETURN jsonb_build_object('enabled', false, 'canManage', false, 'homes', '[]'::jsonb); END IF;
  SELECT coalesce((SELECT enabled FROM workspace_coverage_settings WHERE workspace_id = v_workspace), false) INTO v_enabled;
  IF NOT v_enabled THEN RETURN jsonb_build_object('enabled', false, 'canManage', public.can_manage_workspace_coverage(v_workspace), 'homes', '[]'::jsonb); END IF;
  WITH homes AS (
    SELECT ca.id AS address_id,
      CASE WHEN public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source) IS NULL THEN 'unmatched'
        WHEN h.visited_at IS NOT NULL AND h.campaign_id <> p_campaign_id THEN 'visited_elsewhere'
        WHEN other.id IS NOT NULL THEN 'overlap' ELSE 'available' END AS state,
      CASE WHEN h.visited_at IS NOT NULL AND h.campaign_id <> p_campaign_id THEN h.campaign_name ELSE other.name END AS campaign_name,
      CASE WHEN h.campaign_id <> p_campaign_id THEN h.visited_at END AS visited_at,
      CASE WHEN h.campaign_id <> p_campaign_id THEN h.last_action_by END AS last_action_by,
      CASE WHEN h.campaign_id <> p_campaign_id THEN nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), '') END AS rep_name
    FROM campaign_addresses ca
    LEFT JOIN workspace_home_coverage h ON h.workspace_id = v_workspace AND h.home_key = public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source)
    LEFT JOIN user_profiles profile ON profile.user_id = h.last_action_by
    LEFT JOIN LATERAL (
      SELECT c.id, coalesce(c.name, c.title) AS name
      FROM campaign_addresses peer JOIN campaigns c ON c.id = peer.campaign_id
      WHERE public.campaign_address_coverage_key(peer.source_id::text, peer.gers_id::text, peer.formatted, peer.address, peer.id, peer.match_source) = public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source) AND c.workspace_id = v_workspace AND c.id <> p_campaign_id
        AND peer.deleted_at IS NULL AND lower(coalesce(c.status, 'active')) NOT IN ('archived', 'completed', 'deleted', 'cancelled')
        AND nullif(to_jsonb(c)->>'archived_at', '') IS NULL AND nullif(to_jsonb(c)->>'deleted_at', '') IS NULL
      ORDER BY c.created_at, c.id LIMIT 1
    ) other ON true
    WHERE ca.campaign_id = p_campaign_id AND ca.deleted_at IS NULL
  ) SELECT coalesce(jsonb_agg(to_jsonb(homes)) FILTER (WHERE state <> 'available'), '[]'::jsonb),
    jsonb_build_object('total', count(*), 'visited', count(*) FILTER (WHERE state = 'visited_elsewhere'),
      'overlap', count(*) FILTER (WHERE state = 'overlap'), 'available', count(*) FILTER (WHERE state = 'available'),
      'unmatched', count(*) FILTER (WHERE state = 'unmatched'))
  INTO v_rows, v_summary FROM homes;
  RETURN jsonb_build_object('enabled', true, 'canManage', public.can_manage_workspace_coverage(v_workspace), 'homes', v_rows, 'summary', v_summary);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_workspace_coverage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_workspace_coverage(uuid) TO authenticated;

