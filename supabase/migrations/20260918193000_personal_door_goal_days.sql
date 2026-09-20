-- Recurring personal door-goal days. ISO weekday numbers: Monday=1, Sunday=7.
BEGIN;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS door_goal_days integer[]
  NOT NULL DEFAULT ARRAY[1,2,3,4,5];
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_door_goal_days_valid
  CHECK (cardinality(door_goal_days) BETWEEN 1 AND 7
    AND door_goal_days <@ ARRAY[1,2,3,4,5,6,7]
    AND array_position(door_goal_days, NULL) IS NULL);

CREATE OR REPLACE FUNCTION public.wolfy_protect_personal_goals()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.daily_door_goal IS DISTINCT FROM OLD.daily_door_goal
      OR NEW.weekly_door_goal IS DISTINCT FROM OLD.weekly_door_goal
      OR NEW.door_goal_days IS DISTINCT FROM OLD.door_goal_days)
     AND auth.role() = 'authenticated' AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the owner can change personal goals' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Keep the original three-argument RPC for older installed clients. It preserves days.
CREATE OR REPLACE FUNCTION public.wolfy_save_personal_goals(
  p_user uuid, p_daily integer, p_weekly integer, p_days integer[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_user IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Goal owner mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_daily <= 0 OR p_weekly <= 0 THEN RAISE EXCEPTION 'Targets must be positive'; END IF;
  IF p_days IS NULL OR cardinality(p_days) NOT BETWEEN 1 AND 7
     OR NOT p_days <@ ARRAY[1,2,3,4,5,6,7] OR array_position(p_days, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Choose at least one valid goal day';
  END IF;
  INSERT INTO public.user_profiles(user_id, daily_door_goal, weekly_door_goal, door_goal_days)
  VALUES(auth.uid(), p_daily, p_weekly, ARRAY(SELECT DISTINCT d FROM unnest(p_days) d ORDER BY d))
  ON CONFLICT(user_id) DO UPDATE SET daily_door_goal = excluded.daily_door_goal,
    weekly_door_goal = excluded.weekly_door_goal, door_goal_days = excluded.door_goal_days;
  SELECT jsonb_build_object('daily_door_goal', daily_door_goal, 'weekly_door_goal', weekly_door_goal,
    'door_goal_days', door_goal_days) INTO result FROM public.user_profiles WHERE user_id = auth.uid();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.wolfy_save_personal_goals(uuid, integer, integer, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wolfy_save_personal_goals(uuid, integer, integer, integer[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.wolfy_reconcile_goals(p_workspace uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE zone text; day_start timestamptz; week_start timestamptz; m jsonb; daily integer; weekly integer;
BEGIN
 PERFORM wolfy_assert_owner(p_workspace,p_user);
 SELECT timezone INTO zone FROM wolfy_profiles WHERE workspace_id=p_workspace AND user_id=p_user;
 day_start=date_trunc('day',now() AT TIME ZONE zone) AT TIME ZONE zone;
 week_start=date_trunc('week',now() AT TIME ZONE zone) AT TIME ZONE zone;
 SELECT CASE WHEN extract(isodow FROM now() AT TIME ZONE zone)::integer = ANY(door_goal_days)
   THEN daily_door_goal ELSE NULL END, weekly_door_goal INTO daily,weekly FROM user_profiles WHERE user_id=p_user;
 m=wolfy_home_metrics(p_workspace,day_start,week_start,now());
 IF daily>0 AND (m->>'doors')::integer>=daily THEN PERFORM wolfy_award(p_workspace,p_user,'goal','day:'||day_start::date); END IF;
 IF weekly>0 AND (m->>'weekly_doors')::integer>=weekly THEN PERFORM wolfy_award(p_workspace,p_user,'goal','week:'||week_start::date); END IF;
END $$;
REVOKE ALL ON FUNCTION public.wolfy_reconcile_goals(uuid,uuid) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
