-- Enforce active appointment conversion under concurrent requests and status changes.
BEGIN;
CREATE UNIQUE INDEX field_sales_one_active_appointment
 ON public.field_sales(workspace_id,appointment_id)
 WHERE appointment_id IS NOT NULL AND status IN ('pending','verified');
COMMIT;
