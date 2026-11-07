-- Explicit rounds. No calendar or session action advances coverage.
BEGIN;
ALTER TABLE public.farm_cycles ADD COLUMN previous_ends_on date;
CREATE OR REPLACE FUNCTION public.advance_farm_cycle(
  p_farm_id uuid, p_expected_cycle integer, p_started_on date, p_ends_on date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current integer; v_start date; v_previous_end date;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.farms f WHERE f.id = p_farm_id AND
    (f.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = f.workspace_id AND m.user_id = auth.uid()))
  ) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  SELECT active_cycle_number INTO v_current FROM public.farms WHERE id = p_farm_id FOR UPDATE;
  IF p_expected_cycle IS NULL OR v_current <> p_expected_cycle THEN
    RAISE EXCEPTION 'The active cycle changed. Refresh before starting another.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.end_time IS NULL AND
      (s.farm_id = p_farm_id OR s.farm_touch_id IN (SELECT id FROM public.farm_touches WHERE farm_id=p_farm_id))) THEN
    RAISE EXCEPTION 'Finish the open Farm session before starting a new round';
  END IF;
  SELECT started_on, ends_on INTO v_start, v_previous_end FROM public.farm_cycles
    WHERE farm_id = p_farm_id AND cycle_number = v_current;
  IF p_started_on IS NULL OR p_started_on < v_start OR p_ends_on < p_started_on THEN
    RAISE EXCEPTION 'Choose valid cycle dates';
  END IF;
  UPDATE public.farm_cycles SET closed_at = now(), ends_on = coalesce(ends_on, p_started_on), updated_at = clock_timestamp()
    WHERE farm_id = p_farm_id AND cycle_number = v_current;
  INSERT INTO public.farm_cycles (farm_id, cycle_number, started_on, ends_on, previous_ends_on)
    VALUES (p_farm_id, v_current + 1, p_started_on, p_ends_on, v_previous_end)
    ON CONFLICT (farm_id, cycle_number) DO UPDATE
    SET started_on = excluded.started_on, ends_on = excluded.ends_on, previous_ends_on = excluded.previous_ends_on, closed_at = NULL, updated_at = clock_timestamp();
  UPDATE public.farms SET active_cycle_number = v_current + 1 WHERE id = p_farm_id;
  RETURN v_current + 1;
END $$;


CREATE OR REPLACE FUNCTION public.undo_farm_round(p_farm_id uuid, p_expected_cycle integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_current integer; v_previous_end date;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
   SELECT 1 FROM farms f WHERE f.id=p_farm_id AND (f.owner_id=auth.uid() OR EXISTS (
     SELECT 1 FROM workspace_members m WHERE m.workspace_id=f.workspace_id AND m.user_id=auth.uid()))
 ) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
 SELECT active_cycle_number INTO v_current FROM farms WHERE id=p_farm_id FOR UPDATE;
 IF p_expected_cycle IS NULL OR v_current IS DISTINCT FROM p_expected_cycle THEN
   RAISE EXCEPTION 'The active round changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 IF v_current <= 1 OR NOT EXISTS (SELECT 1 FROM farm_cycles WHERE farm_id=p_farm_id AND cycle_number=v_current-1) THEN
   RAISE EXCEPTION 'There is no previous round to restore'; END IF;
 -- Lock membership while checking: late offline writes must not race the undo.
 PERFORM id FROM farm_touches WHERE farm_id=p_farm_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM sessions s WHERE
   (s.end_time IS NULL AND (s.farm_id=p_farm_id OR s.farm_touch_id IN (SELECT id FROM farm_touches WHERE farm_id=p_farm_id)))
   OR s.farm_touch_id IN (SELECT id FROM farm_touches WHERE farm_id=p_farm_id AND cycle_number=v_current))
 OR EXISTS (SELECT 1 FROM farm_touches t WHERE t.farm_id=p_farm_id AND t.cycle_number=v_current AND
   (t.completed=true OR t.started_at IS NOT NULL OR t.status IN ('in_progress','completed')
    OR EXISTS (SELECT 1 FROM farm_touch_addresses a WHERE a.farm_touch_id=t.id))) THEN
   RAISE EXCEPTION 'This round already has activity. Its history must be kept.'; END IF;
 -- Empty planned touches remain available in the restored round.
 UPDATE farm_touches SET cycle_number=v_current-1 WHERE farm_id=p_farm_id AND cycle_number=v_current;
 SELECT previous_ends_on INTO v_previous_end FROM farm_cycles WHERE farm_id=p_farm_id AND cycle_number=v_current;
 DELETE FROM farm_cycles WHERE farm_id=p_farm_id AND cycle_number=v_current;
 UPDATE farm_cycles SET closed_at=NULL, ends_on=v_previous_end, updated_at=clock_timestamp()
   WHERE farm_id=p_farm_id AND cycle_number=v_current-1;
 UPDATE farms SET active_cycle_number=v_current-1 WHERE id=p_farm_id;
 RETURN v_current-1;
END $$;

CREATE OR REPLACE FUNCTION public.guard_farm_active_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.active_cycle_number<>1 THEN RAISE EXCEPTION 'New farms start at Round 1'; END IF;
 ELSIF NEW.active_cycle_number IS DISTINCT FROM OLD.active_cycle_number THEN
   IF NEW.active_cycle_number=OLD.active_cycle_number-1
     AND NOT EXISTS (SELECT 1 FROM farm_cycles WHERE farm_id=OLD.id AND cycle_number=OLD.active_cycle_number)
     AND EXISTS (SELECT 1 FROM farm_cycles WHERE farm_id=OLD.id AND cycle_number=NEW.active_cycle_number AND closed_at IS NULL)
   THEN RETURN NEW; END IF;
   IF NEW.active_cycle_number<>OLD.active_cycle_number+1
     OR NOT EXISTS (SELECT 1 FROM farm_cycles WHERE farm_id=OLD.id AND cycle_number=OLD.active_cycle_number AND closed_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM farm_cycles WHERE farm_id=OLD.id AND cycle_number=NEW.active_cycle_number AND started_on IS NOT NULL AND closed_at IS NULL)
   THEN RAISE EXCEPTION 'Start a new round from Farm Settings'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.undo_farm_round(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_farm_round(uuid,integer) TO authenticated;
-- Serialize new membership and live-session starts with transitions.
CREATE OR REPLACE FUNCTION public.assign_active_farm_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_active integer;
BEGIN
 SELECT active_cycle_number INTO v_active FROM farms WHERE id=NEW.farm_id FOR UPDATE;
 IF NEW.cycle_number IS NULL THEN NEW.cycle_number=v_active; END IF;
 IF NEW.cycle_number > v_active THEN
   RAISE EXCEPTION 'This round has not been started. Refresh the Farm before saving this session.';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.lock_farm_session_round() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_farm uuid;
BEGIN
 v_farm=NEW.farm_id;
 IF v_farm IS NULL AND NEW.farm_touch_id IS NOT NULL THEN
   SELECT farm_id INTO v_farm FROM farm_touches WHERE id=NEW.farm_touch_id;
 END IF;
 IF v_farm IS NOT NULL THEN PERFORM id FROM farms WHERE id=v_farm FOR UPDATE; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lock_farm_session_round BEFORE INSERT ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.lock_farm_session_round();
REVOKE ALL ON FUNCTION public.lock_farm_session_round() FROM PUBLIC;
COMMIT;
