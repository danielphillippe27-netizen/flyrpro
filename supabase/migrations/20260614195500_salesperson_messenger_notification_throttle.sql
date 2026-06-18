CREATE INDEX IF NOT EXISTS idx_notifications_salesperson_messenger_throttle
  ON public.notifications (workspace_id, user_id, type, created_at DESC)
  WHERE type = 'salesperson_messenger_message';

