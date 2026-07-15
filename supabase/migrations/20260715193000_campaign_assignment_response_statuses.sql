BEGIN;

ALTER TABLE public.campaign_assignments
  DROP CONSTRAINT IF EXISTS campaign_assignments_status_check;

ALTER TABLE public.campaign_assignments
  ADD CONSTRAINT campaign_assignments_status_check
  CHECK (
    status IN (
      'assigned',
      'accepted',
      'declined',
      'in_progress',
      'completed',
      'cancelled'
    )
  );

COMMIT;
