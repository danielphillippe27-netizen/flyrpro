-- Returns lifetime doors_hit and conversations totals for a user
-- from completed sessions. Replaces two full-row scans in the
-- dashboard API lifetime fallback path.
CREATE OR REPLACE FUNCTION public.get_lifetime_session_totals(p_user_id uuid)
RETURNS TABLE(doors_hit bigint, conversations bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(s.doors_hit), 0)::bigint AS doors_hit,
    COALESCE(SUM(s.conversations), 0)::bigint AS conversations
  FROM sessions s
  WHERE s.user_id = p_user_id
    AND s.end_time IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_lifetime_session_totals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lifetime_session_totals(uuid) TO service_role;
