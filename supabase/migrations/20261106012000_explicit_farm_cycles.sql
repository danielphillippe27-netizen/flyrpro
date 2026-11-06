-- One active round per farm. Planning sessions never advances it.
BEGIN;
ALTER TABLE public.farms ADD COLUMN active_cycle_number integer;

-- Preserve recorded cycle membership, including legacy rows without a number.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY farm_id ORDER BY
    coalesce(completed_date, started_at, scheduled_date, created_at), id)::integer AS cycle
  FROM public.farm_touches
)
UPDATE public.farm_touches t SET cycle_number = greatest(1, coalesce(t.cycle_number, o.cycle))
FROM ordered o WHERE o.id = t.id AND (t.cycle_number IS NULL OR t.cycle_number < 1);

-- Future plans are not evidence that a round has started. Never renumber history.
UPDATE public.farms f SET active_cycle_number = coalesce((
  SELECT max(t.cycle_number) FROM public.farm_touches t WHERE t.farm_id = f.id
    AND (t.status IN ('in_progress', 'completed') OR t.started_at IS NOT NULL
      OR t.completed_date IS NOT NULL OR t.completed_at IS NOT NULL
      OR t.last_completed_at IS NOT NULL OR t.completed = true
      OR EXISTS (SELECT 1 FROM public.farm_touch_addresses a WHERE a.farm_touch_id = t.id AND a.status <> 'none'))
), 1);
ALTER TABLE public.farms ALTER COLUMN active_cycle_number SET DEFAULT 1,
  ALTER COLUMN active_cycle_number SET NOT NULL,
  ADD CONSTRAINT farms_active_cycle_positive CHECK (active_cycle_number > 0);

CREATE TABLE public.farm_cycles (
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  started_on date,
  ends_on date,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farm_id, cycle_number),
  CONSTRAINT farm_cycle_date_order CHECK (ends_on IS NULL OR started_on IS NULL OR ends_on >= started_on)
);

INSERT INTO public.farm_cycles (farm_id, cycle_number, started_on)
SELECT farm_id, cycle_number,
  min(coalesce(started_at, completed_date, completed_at)::date)
FROM public.farm_touches GROUP BY farm_id, cycle_number;
INSERT INTO public.farm_cycles (farm_id, cycle_number, started_on)
SELECT id, active_cycle_number, start_date::date FROM public.farms
ON CONFLICT (farm_id, cycle_number) DO UPDATE
SET started_on = coalesce(farm_cycles.started_on, excluded.started_on);

ALTER TABLE public.farm_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY farm_cycles_read ON public.farm_cycles FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_cycles.farm_id AND
    (f.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = f.workspace_id AND m.user_id = auth.uid())))
);
REVOKE ALL ON public.farm_cycles FROM anon, authenticated;
GRANT SELECT ON public.farm_cycles TO authenticated;
GRANT ALL ON public.farm_cycles TO service_role;

CREATE FUNCTION public.initialize_farm_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.farm_cycles (farm_id, cycle_number, started_on)
  VALUES (NEW.id, NEW.active_cycle_number, NEW.start_date::date);
  RETURN NEW;
END $$;
CREATE TRIGGER initialize_farm_cycle AFTER INSERT ON public.farms
FOR EACH ROW EXECUTE FUNCTION public.initialize_farm_cycle();

-- Definer functions explicitly authorize owner/workspace membership before locking.
-- All cycle writes lock the farm first, so advance and date edits are serialized.
CREATE FUNCTION public.set_farm_cycle_end_date(
  p_farm_id uuid, p_cycle_number integer, p_ends_on date, p_expected_updated_at timestamptz
) RETURNS public.farm_cycles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cycle public.farm_cycles;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.farms f WHERE f.id = p_farm_id AND
    (f.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = f.workspace_id AND m.user_id = auth.uid()))
  ) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.farms WHERE id = p_farm_id FOR UPDATE;
  SELECT * INTO v_cycle FROM public.farm_cycles
    WHERE farm_id = p_farm_id AND cycle_number = p_cycle_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF p_expected_updated_at IS NULL OR v_cycle.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'This cycle changed. Refresh before saving.' USING ERRCODE = '40001';
  END IF;
  IF p_ends_on < v_cycle.started_on THEN RAISE EXCEPTION 'End date cannot be before the cycle start date'; END IF;
  UPDATE public.farm_cycles SET ends_on = p_ends_on, updated_at = clock_timestamp()
    WHERE farm_id = p_farm_id AND cycle_number = p_cycle_number RETURNING * INTO v_cycle;
  RETURN v_cycle;
END $$;

CREATE FUNCTION public.advance_farm_cycle(
  p_farm_id uuid, p_expected_cycle integer, p_started_on date, p_ends_on date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current integer; v_start date;
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
  SELECT started_on INTO v_start FROM public.farm_cycles
    WHERE farm_id = p_farm_id AND cycle_number = v_current;
  IF p_started_on IS NULL OR p_started_on < v_start OR p_ends_on < p_started_on THEN
    RAISE EXCEPTION 'Choose valid cycle dates';
  END IF;
  UPDATE public.farm_cycles SET closed_at = now(), ends_on = coalesce(ends_on, p_started_on), updated_at = clock_timestamp()
    WHERE farm_id = p_farm_id AND cycle_number = v_current;
  INSERT INTO public.farm_cycles (farm_id, cycle_number, started_on, ends_on)
    VALUES (p_farm_id, v_current + 1, p_started_on, p_ends_on)
    ON CONFLICT (farm_id, cycle_number) DO UPDATE
    SET started_on = excluded.started_on, ends_on = excluded.ends_on, closed_at = NULL, updated_at = clock_timestamp();
  UPDATE public.farms SET active_cycle_number = v_current + 1 WHERE id = p_farm_id;
  RETURN v_current + 1;
END $$;

-- Keep direct farm updates from bypassing the transactional cycle transition.
CREATE FUNCTION public.guard_farm_active_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.active_cycle_number <> 1 THEN RAISE EXCEPTION 'New farms start at Cycle 1'; END IF;
  ELSIF NEW.active_cycle_number IS DISTINCT FROM OLD.active_cycle_number THEN
    IF NEW.active_cycle_number <> OLD.active_cycle_number + 1
      OR NOT EXISTS (SELECT 1 FROM public.farm_cycles WHERE farm_id = OLD.id
        AND cycle_number = OLD.active_cycle_number AND closed_at IS NOT NULL)
      OR NOT EXISTS (SELECT 1 FROM public.farm_cycles WHERE farm_id = OLD.id
        AND cycle_number = NEW.active_cycle_number AND started_on IS NOT NULL AND closed_at IS NULL)
    THEN RAISE EXCEPTION 'Start the next cycle from farm settings'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_farm_active_cycle BEFORE INSERT OR UPDATE OF active_cycle_number ON public.farms
FOR EACH ROW EXECUTE FUNCTION public.guard_farm_active_cycle();
REVOKE ALL ON FUNCTION public.guard_farm_active_cycle() FROM PUBLIC;

-- Missing assignments inherit the active cycle. Explicit assignments are preserved
-- so a session started offline cannot be silently moved when it syncs later.
ALTER TABLE public.farm_touches ALTER COLUMN cycle_number DROP DEFAULT;
CREATE FUNCTION public.assign_active_farm_cycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cycle_number IS NULL THEN
    SELECT active_cycle_number INTO NEW.cycle_number FROM public.farms WHERE id = NEW.farm_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assign_active_farm_cycle BEFORE INSERT ON public.farm_touches
FOR EACH ROW EXECUTE FUNCTION public.assign_active_farm_cycle();

REVOKE ALL ON FUNCTION public.initialize_farm_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_active_farm_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_farm_cycle_end_date(uuid, integer, date, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_farm_cycle(uuid, integer, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_farm_cycle_end_date(uuid, integer, date, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_farm_cycle(uuid, integer, date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
