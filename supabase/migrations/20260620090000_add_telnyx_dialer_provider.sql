BEGIN;

ALTER TABLE public.workspace_dialer_settings
  ADD COLUMN IF NOT EXISTS telecom_provider text NOT NULL DEFAULT 'twilio'
    CHECK (telecom_provider IN ('twilio', 'telnyx')),
  ADD COLUMN IF NOT EXISTS provider_phone_number_id text,
  ADD COLUMN IF NOT EXISTS provider_number_order_id text;

ALTER TABLE public.salesperson_dialer_settings
  ADD COLUMN IF NOT EXISTS telecom_provider text NOT NULL DEFAULT 'twilio'
    CHECK (telecom_provider IN ('twilio', 'telnyx')),
  ADD COLUMN IF NOT EXISTS provider_phone_number_id text,
  ADD COLUMN IF NOT EXISTS provider_number_order_id text;

ALTER TABLE public.dialer_calls
  ADD COLUMN IF NOT EXISTS telecom_provider text NOT NULL DEFAULT 'twilio'
    CHECK (telecom_provider IN ('twilio', 'telnyx')),
  ADD COLUMN IF NOT EXISTS provider_call_id text,
  ADD COLUMN IF NOT EXISTS provider_parent_call_id text;

ALTER TABLE public.dialer_sms_followups
  ADD COLUMN IF NOT EXISTS telecom_provider text NOT NULL DEFAULT 'twilio'
    CHECK (telecom_provider IN ('twilio', 'telnyx')),
  ADD COLUMN IF NOT EXISTS provider_message_id text;

ALTER TABLE public.dialer_inbound_messages
  ADD COLUMN IF NOT EXISTS telecom_provider text NOT NULL DEFAULT 'twilio'
    CHECK (telecom_provider IN ('twilio', 'telnyx')),
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS idx_dialer_calls_workspace_provider_call_id
  ON public.dialer_calls(workspace_id, telecom_provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_sms_followups_provider_message_unique
  ON public.dialer_sms_followups(telecom_provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_inbound_messages_provider_message_unique
  ON public.dialer_inbound_messages(telecom_provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMIT;
