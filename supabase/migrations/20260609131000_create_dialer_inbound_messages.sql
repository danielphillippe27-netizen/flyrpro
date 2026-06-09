CREATE TABLE IF NOT EXISTS public.dialer_inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  twilio_message_sid text UNIQUE,
  from_number_e164 text NOT NULL,
  to_number_e164 text NOT NULL,
  body text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  status_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_inbound_messages_workspace_received
  ON public.dialer_inbound_messages(workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_dialer_inbound_messages_workspace_contact_received
  ON public.dialer_inbound_messages(workspace_id, contact_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.set_dialer_inbound_messages_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_dialer_inbound_messages_updated_at ON public.dialer_inbound_messages;
CREATE TRIGGER set_dialer_inbound_messages_updated_at
BEFORE UPDATE ON public.dialer_inbound_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_dialer_inbound_messages_updated_at();

ALTER TABLE public.dialer_inbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialer_inbound_messages_workspace_members_select ON public.dialer_inbound_messages;
CREATE POLICY dialer_inbound_messages_workspace_members_select
ON public.dialer_inbound_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_inbound_messages.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialer_inbound_messages_workspace_members_update ON public.dialer_inbound_messages;
CREATE POLICY dialer_inbound_messages_workspace_members_update
ON public.dialer_inbound_messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_inbound_messages.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_inbound_messages.workspace_id
      AND wm.user_id = auth.uid()
  )
);
