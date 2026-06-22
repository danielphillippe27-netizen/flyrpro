CREATE TABLE IF NOT EXISTS public.salesperson_lead_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  dialler_lead_id uuid REFERENCES public.dialler_leads(id) ON DELETE SET NULL,
  assigned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  company text,
  phone text,
  phone_e164 text,
  email text,
  email_normalized text,
  website text,
  website_domain text,
  address text,
  city text,
  region text,
  country_code text,
  source text,
  external_id text,
  lead_fingerprint text,
  lead_state text NOT NULL DEFAULT 'new' CHECK (
    lead_state IN (
      'new',
      'assigned',
      'queued',
      'attempting',
      'contacted',
      'no_answer',
      'callback',
      'interested',
      'not_now',
      'dnc',
      'converted',
      'archived'
    )
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempted_at timestamptz,
  next_follow_up_at timestamptz,
  disposition text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salesperson_lead_master_workspace_assignee_idx
  ON public.salesperson_lead_master(workspace_id, assigned_user_id, lead_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_master_workspace_state_idx
  ON public.salesperson_lead_master(workspace_id, lead_state, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_contact_uidx
  ON public.salesperson_lead_master(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_dialler_lead_uidx
  ON public.salesperson_lead_master(dialler_lead_id)
  WHERE dialler_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_workspace_phone_uidx
  ON public.salesperson_lead_master(workspace_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND phone_e164 <> '';

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_workspace_email_uidx
  ON public.salesperson_lead_master(workspace_id, email_normalized)
  WHERE email_normalized IS NOT NULL AND email_normalized <> '';

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_workspace_source_uidx
  ON public.salesperson_lead_master(workspace_id, source, external_id)
  WHERE source IS NOT NULL AND source <> '' AND external_id IS NOT NULL AND external_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_lead_master_workspace_fingerprint_uidx
  ON public.salesperson_lead_master(workspace_id, lead_fingerprint)
  WHERE lead_fingerprint IS NOT NULL AND lead_fingerprint <> '';

CREATE OR REPLACE FUNCTION public.set_salesperson_lead_master_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.email_normalized = nullif(lower(trim(NEW.email)), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_salesperson_lead_master_updated_at ON public.salesperson_lead_master;
CREATE TRIGGER set_salesperson_lead_master_updated_at
BEFORE INSERT OR UPDATE ON public.salesperson_lead_master
FOR EACH ROW
EXECUTE FUNCTION public.set_salesperson_lead_master_updated_at();

CREATE OR REPLACE FUNCTION public.sync_contact_to_salesperson_lead_master()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id uuid;
  target_user_id uuid;
  normalized_email text;
  fingerprint text;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  target_user_id := NEW.user_id;
  IF target_user_id IS NULL THEN
    SELECT wm.user_id
    INTO target_user_id
    FROM public.workspace_members wm
    WHERE wm.workspace_id = NEW.workspace_id
    ORDER BY wm.created_at
    LIMIT 1;
  END IF;

  IF target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  normalized_email := nullif(lower(trim(NEW.email)), '');
  fingerprint := nullif(
    lower(concat_ws('|', NULLIF(trim(NEW.full_name), ''), NULLIF(trim(NEW.phone_e164), ''), normalized_email, NULLIF(trim(NEW.address), ''))),
    ''
  );

  SELECT slm.id
  INTO target_id
  FROM public.salesperson_lead_master slm
  WHERE slm.workspace_id = NEW.workspace_id
    AND (
      slm.contact_id = NEW.id
      OR (NEW.phone_e164 IS NOT NULL AND NEW.phone_e164 <> '' AND slm.phone_e164 = NEW.phone_e164)
      OR (normalized_email IS NOT NULL AND slm.email_normalized = normalized_email)
    )
  ORDER BY CASE WHEN slm.contact_id = NEW.id THEN 0 ELSE 1 END, slm.updated_at DESC
  LIMIT 1;

  IF target_id IS NOT NULL THEN
    UPDATE public.salesperson_lead_master
    SET
      contact_id = COALESCE(contact_id, NEW.id),
      assigned_user_id = COALESCE(assigned_user_id, target_user_id),
      created_by_user_id = COALESCE(created_by_user_id, target_user_id),
      name = COALESCE(NULLIF(trim(NEW.full_name), ''), name),
      phone = NULLIF(trim(NEW.phone), ''),
      phone_e164 = NULLIF(trim(NEW.phone_e164), ''),
      email = NULLIF(trim(NEW.email), ''),
      email_normalized = normalized_email,
      address = NULLIF(trim(NEW.address), ''),
      source = COALESCE(NULLIF(trim(NEW.source), ''), source, 'contacts'),
      lead_fingerprint = COALESCE(fingerprint, lead_fingerprint),
      lead_state = CASE
        WHEN lead_state = 'new' THEN 'assigned'
        ELSE lead_state
      END,
      notes = COALESCE(NEW.notes, notes)
    WHERE id = target_id;
  ELSE
    INSERT INTO public.salesperson_lead_master (
      workspace_id,
      contact_id,
      assigned_user_id,
      created_by_user_id,
      name,
      phone,
      phone_e164,
      email,
      email_normalized,
      address,
      source,
      lead_fingerprint,
      lead_state,
      notes,
      created_at,
      updated_at
    )
    VALUES (
      NEW.workspace_id,
      NEW.id,
      target_user_id,
      target_user_id,
      COALESCE(NULLIF(trim(NEW.full_name), ''), 'Lead'),
      NULLIF(trim(NEW.phone), ''),
      NULLIF(trim(NEW.phone_e164), ''),
      NULLIF(trim(NEW.email), ''),
      normalized_email,
      NULLIF(trim(NEW.address), ''),
      COALESCE(NULLIF(trim(NEW.source), ''), 'contacts'),
      fingerprint,
      'assigned',
      NEW.notes,
      COALESCE(NEW.created_at, now()),
      COALESCE(NEW.updated_at, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_to_salesperson_lead_master ON public.contacts;
CREATE TRIGGER sync_contact_to_salesperson_lead_master
AFTER INSERT OR UPDATE OF user_id, workspace_id, full_name, phone, phone_e164, email, address, source, notes
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.sync_contact_to_salesperson_lead_master();

WITH contact_agents AS (
  SELECT
    c.id AS contact_id,
    c.workspace_id,
    COALESCE(c.user_id, wm.user_id) AS assigned_user_id,
    c.full_name,
    c.phone,
    c.phone_e164,
    c.email,
    c.address,
    c.source,
    c.notes,
    c.created_at,
    c.updated_at
  FROM public.contacts c
  LEFT JOIN LATERAL (
    SELECT user_id
    FROM public.workspace_members
    WHERE workspace_id = c.workspace_id
    ORDER BY created_at
    LIMIT 1
  ) wm ON true
  WHERE c.workspace_id IS NOT NULL
)
INSERT INTO public.salesperson_lead_master (
  workspace_id,
  contact_id,
  assigned_user_id,
  created_by_user_id,
  name,
  phone,
  phone_e164,
  email,
  email_normalized,
  address,
  source,
  lead_fingerprint,
  lead_state,
  notes,
  created_at,
  updated_at
)
SELECT
  workspace_id,
  contact_id,
  assigned_user_id,
  assigned_user_id,
  COALESCE(NULLIF(trim(full_name), ''), 'Lead'),
  NULLIF(trim(phone), ''),
  NULLIF(trim(phone_e164), ''),
  NULLIF(trim(email), ''),
  NULLIF(lower(trim(email)), ''),
  NULLIF(trim(address), ''),
  COALESCE(NULLIF(trim(source), ''), 'contacts'),
  NULLIF(lower(concat_ws('|', NULLIF(trim(full_name), ''), NULLIF(trim(phone_e164), ''), NULLIF(trim(email), ''), NULLIF(trim(address), ''))), ''),
  'assigned',
  notes,
  COALESCE(created_at, now()),
  COALESCE(updated_at, now())
FROM contact_agents
WHERE assigned_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.salesperson_lead_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesperson_lead_master_workspace_members_select ON public.salesperson_lead_master;
CREATE POLICY salesperson_lead_master_workspace_members_select
ON public.salesperson_lead_master
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_master.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS salesperson_lead_master_workspace_members_insert ON public.salesperson_lead_master;
CREATE POLICY salesperson_lead_master_workspace_members_insert
ON public.salesperson_lead_master
FOR INSERT
WITH CHECK (
  assigned_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_master.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS salesperson_lead_master_workspace_members_update ON public.salesperson_lead_master;
CREATE POLICY salesperson_lead_master_workspace_members_update
ON public.salesperson_lead_master
FOR UPDATE
USING (
  assigned_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_master.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  assigned_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = salesperson_lead_master.workspace_id
      AND wm.user_id = auth.uid()
  )
);
