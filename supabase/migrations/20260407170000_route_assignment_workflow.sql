BEGIN;

-- Expand route assignment lifecycle for lead assignment + agent fulfillment.
ALTER TABLE public.route_assignments
  DROP CONSTRAINT IF EXISTS route_assignments_status_check;

ALTER TABLE public.route_assignments
  ADD CONSTRAINT route_assignments_status_check
  CHECK (
    status IN (
      'assigned',
      'accepted',
      'in_progress',
      'completed',
      'declined',
      'cancelled'
    )
  );

ALTER TABLE public.route_assignments
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text;

ALTER TABLE public.route_assignments
  DROP CONSTRAINT IF EXISTS route_assignments_priority_check;

ALTER TABLE public.route_assignments
  ADD CONSTRAINT route_assignments_priority_check
  CHECK (priority IN ('low', 'normal', 'high'));

-- One active assignment per route plan at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_route_assignments_one_active_per_plan
  ON public.route_assignments(route_plan_id)
  WHERE status IN ('assigned', 'accepted', 'in_progress');

COMMIT;
