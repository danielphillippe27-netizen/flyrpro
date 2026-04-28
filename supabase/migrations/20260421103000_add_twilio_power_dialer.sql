BEGIN;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS phone_last_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_validation_error text;

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_phone_e164
  ON public.contacts(workspace_id, phone_e164);

CREATE INDEX IF NOT EXISTS idx_contacts_phone_e164
  ON public.contacts(phone_e164);

CREATE TABLE IF NOT EXISTS public.workspace_dialer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  default_from_number text,
  default_sms_from_number text,
  allow_sms_followup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dialer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  source_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  tab_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_workspace_user_created
  ON public.dialer_sessions(workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_workspace_status_created
  ON public.dialer_sessions(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.dialer_session_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'calling', 'completed', 'skipped', 'invalid')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_call_id uuid,
  claimed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  completed_at timestamptz,
  skip_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_dialer_session_leads_session_position
  ON public.dialer_session_leads(session_id, position);

CREATE INDEX IF NOT EXISTS idx_dialer_session_leads_session_status_position
  ON public.dialer_session_leads(session_id, status, position);

CREATE TABLE IF NOT EXISTS public.dialer_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.dialer_sessions(id) ON DELETE CASCADE,
  session_lead_id uuid NOT NULL REFERENCES public.dialer_session_leads(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_request_id text NOT NULL UNIQUE,
  twilio_call_sid text UNIQUE,
  twilio_parent_call_sid text,
  to_number_raw text,
  to_number_e164 text,
  from_number_e164 text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'initiated', 'ringing', 'in-progress', 'answered', 'completed', 'busy', 'failed', 'no-answer', 'canceled')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound')),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  disposition text CHECK (disposition IN ('connected', 'no_answer', 'left_voicemail', 'callback_requested', 'follow_up', 'appointment_set', 'do_not_call', 'bad_number', 'not_interested')),
  disposition_note text,
  follow_up_at timestamptz,
  appointment_at timestamptz,
  status_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_calls_workspace_contact_created
  ON public.dialer_calls(workspace_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dialer_calls_workspace_twilio_sid
  ON public.dialer_calls(workspace_id, twilio_call_sid);

CREATE INDEX IF NOT EXISTS idx_dialer_calls_session_created
  ON public.dialer_calls(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.dialer_sms_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES public.dialer_calls(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twilio_message_sid text UNIQUE,
  from_number_e164 text,
  to_number_e164 text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  status_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_sms_followups_workspace_contact_created
  ON public.dialer_sms_followups(workspace_id, contact_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_next_dialer_session_lead(
  p_session_id uuid,
  p_workspace_id uuid,
  p_user_id uuid
)
RETURNS public.dialer_session_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.dialer_session_leads;
BEGIN
  WITH next_row AS (
    SELECT dsl.id
    FROM public.dialer_session_leads dsl
    WHERE dsl.session_id = p_session_id
      AND dsl.workspace_id = p_workspace_id
      AND dsl.status = 'pending'
    ORDER BY dsl.position ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.dialer_session_leads dsl
  SET
    status = 'claimed',
    claimed_by_user_id = p_user_id,
    claimed_at = now(),
    updated_at = now()
  FROM next_row
  WHERE dsl.id = next_row.id
  RETURNING dsl.* INTO v_row;

  RETURN v_row;
END;
$$;

ALTER TABLE public.workspace_dialer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_session_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_sms_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_dialer_settings_member_read" ON public.workspace_dialer_settings;
CREATE POLICY "workspace_dialer_settings_member_read"
  ON public.workspace_dialer_settings FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_dialer_settings_owner_admin_manage" ON public.workspace_dialer_settings;
CREATE POLICY "workspace_dialer_settings_owner_admin_manage"
  ON public.workspace_dialer_settings FOR ALL
  USING (public.is_workspace_owner_or_admin(workspace_id))
  WITH CHECK (public.is_workspace_owner_or_admin(workspace_id));

DROP POLICY IF EXISTS "dialer_sessions_member_read" ON public.dialer_sessions;
CREATE POLICY "dialer_sessions_member_read"
  ON public.dialer_sessions FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "dialer_sessions_member_insert" ON public.dialer_sessions;
CREATE POLICY "dialer_sessions_member_insert"
  ON public.dialer_sessions FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "dialer_sessions_member_update_own" ON public.dialer_sessions;
CREATE POLICY "dialer_sessions_member_update_own"
  ON public.dialer_sessions FOR UPDATE
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "dialer_session_leads_member_read" ON public.dialer_session_leads;
CREATE POLICY "dialer_session_leads_member_read"
  ON public.dialer_session_leads FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "dialer_calls_member_read" ON public.dialer_calls;
CREATE POLICY "dialer_calls_member_read"
  ON public.dialer_calls FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "dialer_calls_member_insert" ON public.dialer_calls;
CREATE POLICY "dialer_calls_member_insert"
  ON public.dialer_calls FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "dialer_calls_member_update_own" ON public.dialer_calls;
CREATE POLICY "dialer_calls_member_update_own"
  ON public.dialer_calls FOR UPDATE
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "dialer_sms_followups_member_read" ON public.dialer_sms_followups;
CREATE POLICY "dialer_sms_followups_member_read"
  ON public.dialer_sms_followups FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "dialer_sms_followups_member_insert" ON public.dialer_sms_followups;
CREATE POLICY "dialer_sms_followups_member_insert"
  ON public.dialer_sms_followups FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

COMMIT;
