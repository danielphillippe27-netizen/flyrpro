BEGIN;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS weekly_door_goal integer,
  ADD COLUMN IF NOT EXISTS weekly_sessions_goal integer;

COMMENT ON COLUMN public.workspaces.weekly_door_goal IS 'Workspace-level weekly door goal for team dashboards';
COMMENT ON COLUMN public.workspaces.weekly_sessions_goal IS 'Optional workspace-level weekly sessions goal';

WITH workspace_goal_totals AS (
  SELECT
    wm.workspace_id,
    SUM(COALESCE(up.weekly_door_goal, 100))::integer AS weekly_door_goal,
    CASE
      WHEN COUNT(up.weekly_sessions_goal) > 0 THEN SUM(up.weekly_sessions_goal)::integer
      ELSE NULL
    END AS weekly_sessions_goal
  FROM public.workspace_members wm
  LEFT JOIN public.user_profiles up
    ON up.user_id = wm.user_id
  GROUP BY wm.workspace_id
)
UPDATE public.workspaces w
SET
  weekly_door_goal = COALESCE(w.weekly_door_goal, totals.weekly_door_goal),
  weekly_sessions_goal = COALESCE(w.weekly_sessions_goal, totals.weekly_sessions_goal)
FROM workspace_goal_totals totals
WHERE w.id = totals.workspace_id
  AND w.weekly_door_goal IS NULL
  AND w.weekly_sessions_goal IS NULL;

COMMIT;
