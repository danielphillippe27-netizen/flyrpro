BEGIN;

-- Code-joined teammates may have no campaign assignment or workspace role.
-- Include their active session membership so both mobile maps can resolve
-- their profile name through the existing campaign member directory RPC.
CREATE OR REPLACE FUNCTION public.rpc_get_campaign_member_directory(p_campaign_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT c.owner_id AS user_id, 'owner'::text AS role, c.created_at
    FROM public.campaigns c
    WHERE c.id = p_campaign_id

    UNION

    SELECT wm.user_id,
      CASE WHEN lower(wm.role) = 'owner' THEN 'owner' ELSE 'admin' END,
      wm.created_at
    FROM public.campaigns c
    JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
    WHERE c.id = p_campaign_id AND lower(wm.role) IN ('owner', 'admin')

    UNION

    SELECT ca.assigned_to_user_id, 'member'::text, ca.created_at
    FROM public.campaign_assignments ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.status IN ('accepted', 'in_progress', 'completed')

    UNION

    SELECT sp.user_id, 'member'::text, sp.joined_at
    FROM public.session_participants sp
    JOIN public.sessions s ON s.id = sp.session_id
    WHERE sp.campaign_id = p_campaign_id
      AND sp.left_at IS NULL
      AND s.campaign_id = p_campaign_id
      AND s.end_time IS NULL
  )
  SELECT DISTINCT ON (m.user_id)
    m.user_id,
    m.role,
    COALESCE(
      NULLIF(trim(concat_ws(' ', up.first_name, up.last_name)), ''),
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(trim(au.raw_user_meta_data->>'name'), ''),
      NULLIF(trim(au.raw_user_meta_data->>'display_name'), ''),
      NULLIF(split_part(coalesce(au.email, ''), '@', 1), ''),
      left(m.user_id::text, 8)
    ) AS display_name,
    au.email,
    COALESCE(
      NULLIF(trim(up.avatar_url), ''),
      NULLIF(trim(p.avatar_url), ''),
      NULLIF(trim(au.raw_user_meta_data->>'avatar_url'), '')
    ) AS avatar_url,
    m.created_at
  FROM members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = m.user_id
  LEFT JOIN auth.users au ON au.id = m.user_id
  WHERE public.can_view_campaign(p_campaign_id)
  ORDER BY m.user_id,
    CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_member_directory(uuid) TO authenticated, service_role;

COMMIT;
