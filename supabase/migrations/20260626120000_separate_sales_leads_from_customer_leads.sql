BEGIN;

-- Canonical sales/prospecting tables. These live in the same database as the
-- FLYR app tables, but keep internal sales data out of customer lead tables.

CREATE TABLE IF NOT EXISTS public.sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  legacy_salesperson_id uuid UNIQUE REFERENCES public.salespeople(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  role text,
  territory text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'inactive')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_rep_id uuid REFERENCES public.sales_reps(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_contact_id uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_sales_rep_id uuid REFERENCES public.sales_reps(id) ON DELETE SET NULL,
  assigned_salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  converted_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_id uuid,
  dialler_lead_id uuid,
  legacy_contact_id uuid,
  legacy_dialler_lead_id uuid,
  legacy_master_lead_id uuid,
  name text NOT NULL,
  company text,
  phone text,
  phone_e164 text,
  phone_country_code text,
  phone_area_code text,
  phone_area_label text,
  email text,
  email_normalized text,
  list_id uuid,
  list_name text,
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
  called_at timestamptz,
  last_attempted_at timestamptz,
  follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  follow_up_name text,
  demo_link_follow_up_id uuid,
  disposition text,
  is_starred boolean NOT NULL DEFAULT false,
  pipeline_stage text NOT NULL DEFAULT 'new_lead',
  pipeline_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pipeline_priority text NOT NULL DEFAULT 'normal',
  seat_count integer NOT NULL DEFAULT 1 CHECK (seat_count >= 1),
  estimated_monthly_value_cents integer NOT NULL DEFAULT 4000,
  next_task_title text,
  next_task_type text,
  last_touch_at timestamptz,
  last_touch_summary text,
  signed_up_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_up_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  match_confidence text,
  trial_status text,
  trial_started_at timestamptz,
  usage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  sales_contact_id uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_sales_rep_id uuid REFERENCES public.sales_reps(id) ON DELETE SET NULL,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'new',
  value_cents integer,
  currency text,
  expected_close_at timestamptz,
  closed_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  sales_contact_id uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  sales_deal_id uuid REFERENCES public.sales_deals(id) ON DELETE SET NULL,
  assigned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_sales_rep_id uuid REFERENCES public.sales_reps(id) ON DELETE SET NULL,
  task_type text NOT NULL DEFAULT 'follow_up',
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'dismissed')),
  due_at timestamptz,
  completed_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  sales_contact_id uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  sales_task_id uuid REFERENCES public.sales_tasks(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sales_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  IF TG_TABLE_NAME IN ('sales_contacts', 'sales_leads') THEN
    NEW.email_normalized = nullif(lower(trim(NEW.email)), '');
  END IF;
  IF TG_TABLE_NAME = 'sales_leads' THEN
    NEW.assigned_user_id = COALESCE(NEW.assigned_user_id, NEW.user_id);
    NEW.user_id = COALESCE(NEW.user_id, NEW.assigned_user_id);
    NEW.legacy_contact_id = COALESCE(NEW.legacy_contact_id, NEW.contact_id);
    NEW.contact_id = COALESCE(NEW.contact_id, NEW.legacy_contact_id);
    NEW.legacy_dialler_lead_id = COALESCE(NEW.legacy_dialler_lead_id, NEW.dialler_lead_id);
    NEW.dialler_lead_id = COALESCE(NEW.dialler_lead_id, NEW.legacy_dialler_lead_id);
    IF NEW.assigned_sales_rep_id IS NULL AND NEW.assigned_salesperson_id IS NOT NULL THEN
      SELECT sr.id
      INTO NEW.assigned_sales_rep_id
      FROM public.sales_reps sr
      WHERE sr.legacy_salesperson_id = NEW.assigned_salesperson_id
      LIMIT 1;
    END IF;
    IF NEW.assigned_salesperson_id IS NULL AND NEW.assigned_sales_rep_id IS NOT NULL THEN
      SELECT sr.legacy_salesperson_id
      INTO NEW.assigned_salesperson_id
      FROM public.sales_reps sr
      WHERE sr.id = NEW.assigned_sales_rep_id
      LIMIT 1;
    END IF;
    NEW.last_attempted_at = COALESCE(NEW.last_attempted_at, NEW.called_at);
    NEW.called_at = COALESCE(NEW.called_at, NEW.last_attempted_at);
    NEW.next_follow_up_at = COALESCE(NEW.next_follow_up_at, NEW.follow_up_at);
    NEW.follow_up_at = COALESCE(NEW.follow_up_at, NEW.next_follow_up_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_reps_set_updated_at ON public.sales_reps;
CREATE TRIGGER sales_reps_set_updated_at
BEFORE UPDATE ON public.sales_reps
FOR EACH ROW EXECUTE FUNCTION public.sales_set_updated_at();

DROP TRIGGER IF EXISTS sales_contacts_set_updated_at ON public.sales_contacts;
CREATE TRIGGER sales_contacts_set_updated_at
BEFORE INSERT OR UPDATE ON public.sales_contacts
FOR EACH ROW EXECUTE FUNCTION public.sales_set_updated_at();

DROP TRIGGER IF EXISTS sales_leads_set_updated_at ON public.sales_leads;
CREATE TRIGGER sales_leads_set_updated_at
BEFORE INSERT OR UPDATE ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public.sales_set_updated_at();

DROP TRIGGER IF EXISTS sales_deals_set_updated_at ON public.sales_deals;
CREATE TRIGGER sales_deals_set_updated_at
BEFORE UPDATE ON public.sales_deals
FOR EACH ROW EXECUTE FUNCTION public.sales_set_updated_at();

DROP TRIGGER IF EXISTS sales_tasks_set_updated_at ON public.sales_tasks;
CREATE TRIGGER sales_tasks_set_updated_at
BEFORE UPDATE ON public.sales_tasks
FOR EACH ROW EXECUTE FUNCTION public.sales_set_updated_at();

CREATE INDEX IF NOT EXISTS sales_reps_workspace_user_idx
  ON public.sales_reps(workspace_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_contacts_workspace_source_uidx
  ON public.sales_contacts(workspace_id, source, external_id)
  WHERE source IS NOT NULL AND source <> '' AND external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS sales_contacts_workspace_phone_idx
  ON public.sales_contacts(workspace_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND phone_e164 <> '';

CREATE INDEX IF NOT EXISTS sales_leads_workspace_assignee_idx
  ON public.sales_leads(workspace_id, assigned_user_id, lead_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_state_idx
  ON public.sales_leads(workspace_id, lead_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_created_idx
  ON public.sales_leads(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_user_created_idx
  ON public.sales_leads(workspace_id, assigned_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_user_starred_idx
  ON public.sales_leads(workspace_id, assigned_user_id, is_starred, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_salesperson_state_idx
  ON public.sales_leads(workspace_id, assigned_salesperson_id, lead_state, updated_at DESC)
  WHERE assigned_salesperson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_leads_workspace_pipeline_stage_idx
  ON public.sales_leads(workspace_id, pipeline_stage, next_follow_up_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS sales_leads_workspace_pipeline_owner_idx
  ON public.sales_leads(workspace_id, pipeline_owner_id, pipeline_stage, next_follow_up_at);

CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_legacy_contact_uidx
  ON public.sales_leads(legacy_contact_id)
  WHERE legacy_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_legacy_dialler_uidx
  ON public.sales_leads(legacy_dialler_lead_id)
  WHERE legacy_dialler_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_legacy_master_uidx
  ON public.sales_leads(legacy_master_lead_id)
  WHERE legacy_master_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_leads_workspace_phone_idx
  ON public.sales_leads(workspace_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND phone_e164 <> '';

CREATE INDEX IF NOT EXISTS sales_leads_workspace_email_idx
  ON public.sales_leads(workspace_id, email_normalized)
  WHERE email_normalized IS NOT NULL AND email_normalized <> '';

CREATE INDEX IF NOT EXISTS sales_leads_workspace_source_idx
  ON public.sales_leads(workspace_id, source, external_id)
  WHERE source IS NOT NULL AND source <> '' AND external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS sales_leads_workspace_fingerprint_idx
  ON public.sales_leads(workspace_id, lead_fingerprint)
  WHERE lead_fingerprint IS NOT NULL AND lead_fingerprint <> '';

CREATE INDEX IF NOT EXISTS sales_tasks_workspace_due_idx
  ON public.sales_tasks(workspace_id, status, due_at)
  WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_activities_lead_occurred_idx
  ON public.sales_activities(sales_lead_id, occurred_at DESC)
  WHERE sales_lead_id IS NOT NULL;

ALTER TABLE public.sales_reps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_reps_workspace_members_select ON public.sales_reps;
CREATE POLICY sales_reps_workspace_members_select
ON public.sales_reps FOR SELECT
USING (
  workspace_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_reps.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_reps_workspace_admin_manage ON public.sales_reps;
CREATE POLICY sales_reps_workspace_admin_manage
ON public.sales_reps FOR ALL
USING (
  user_id = auth.uid()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner_or_admin(workspace_id))
)
WITH CHECK (
  user_id = auth.uid()
  OR (workspace_id IS NOT NULL AND public.is_workspace_owner_or_admin(workspace_id))
);

DROP POLICY IF EXISTS sales_contacts_workspace_members_manage ON public.sales_contacts;
CREATE POLICY sales_contacts_workspace_members_manage
ON public.sales_contacts FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_contacts.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_contacts.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_leads_workspace_members_select ON public.sales_leads;
CREATE POLICY sales_leads_workspace_members_select
ON public.sales_leads FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_leads_assignee_manage ON public.sales_leads;
CREATE POLICY sales_leads_assignee_manage
ON public.sales_leads FOR ALL
USING (
  assigned_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  assigned_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_deals_workspace_members_manage ON public.sales_deals;
CREATE POLICY sales_deals_workspace_members_manage
ON public.sales_deals FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_deals.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_deals.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_tasks_workspace_members_manage ON public.sales_tasks;
CREATE POLICY sales_tasks_workspace_members_manage
ON public.sales_tasks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_tasks.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_tasks.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS sales_activities_workspace_members_manage ON public.sales_activities;
CREATE POLICY sales_activities_workspace_members_manage
ON public.sales_activities FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_activities.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = sales_activities.workspace_id
      AND wm.user_id = auth.uid()
  )
);

-- Seed canonical reps from the older salespeople table.
INSERT INTO public.sales_reps (
  workspace_id,
  user_id,
  legacy_salesperson_id,
  full_name,
  email,
  phone,
  role,
  territory,
  status,
  metadata,
  created_at,
  updated_at
)
SELECT
  s.workspace_id,
  s.user_id,
  s.id,
  s.full_name,
  s.email,
  s.phone,
  s.role,
  s.territory,
  s.status,
  jsonb_strip_nulls(jsonb_build_object(
    'referralCode', s.referral_code,
    'demoEmailHandle', s.demo_email_handle,
    'demoEmailReplyTo', s.demo_email_reply_to
  )),
  s.created_at,
  s.updated_at
FROM public.salespeople s
ON CONFLICT (legacy_salesperson_id) DO UPDATE
SET
  workspace_id = EXCLUDED.workspace_id,
  user_id = EXCLUDED.user_id,
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  role = EXCLUDED.role,
  territory = EXCLUDED.territory,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- Backfill from the previous master table first, preserving old identifiers.
INSERT INTO public.sales_leads (
  id,
  workspace_id,
  assigned_user_id,
  assigned_sales_rep_id,
  assigned_salesperson_id,
  created_by_user_id,
  legacy_contact_id,
  legacy_dialler_lead_id,
  legacy_master_lead_id,
  name,
  company,
  phone,
  phone_e164,
  email,
  email_normalized,
  list_id,
  list_name,
  website,
  website_domain,
  address,
  city,
  region,
  country_code,
  source,
  external_id,
  lead_fingerprint,
  lead_state,
  attempt_count,
  last_attempted_at,
  next_follow_up_at,
  disposition,
  pipeline_stage,
  pipeline_owner_id,
  pipeline_priority,
  seat_count,
  estimated_monthly_value_cents,
  next_task_title,
  next_task_type,
  last_touch_at,
  last_touch_summary,
  signed_up_user_id,
  signed_up_workspace_id,
  match_confidence,
  trial_status,
  trial_started_at,
  usage_summary,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  slm.id,
  slm.workspace_id,
  slm.assigned_user_id,
  sr.id,
  slm.assigned_salesperson_id,
  slm.created_by_user_id,
  slm.contact_id,
  slm.dialler_lead_id,
  slm.id,
  slm.name,
  slm.company,
  slm.phone,
  slm.phone_e164,
  slm.email,
  slm.email_normalized,
  CASE
    WHEN (slm.metadata->>'listId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (slm.metadata->>'listId')::uuid
    WHEN (slm.metadata->>'list_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (slm.metadata->>'list_id')::uuid
    ELSE NULL
  END,
  COALESCE(slm.metadata->>'listName', slm.metadata->>'list_name'),
  slm.website,
  slm.website_domain,
  slm.address,
  slm.city,
  slm.region,
  slm.country_code,
  COALESCE(NULLIF(slm.source, ''), 'salesperson_lead_master'),
  slm.external_id,
  slm.lead_fingerprint,
  slm.lead_state,
  slm.attempt_count,
  slm.last_attempted_at,
  slm.next_follow_up_at,
  slm.disposition,
  slm.pipeline_stage,
  slm.pipeline_owner_id,
  slm.pipeline_priority,
  slm.seat_count,
  slm.estimated_monthly_value_cents,
  slm.next_task_title,
  slm.next_task_type,
  slm.last_touch_at,
  slm.last_touch_summary,
  slm.signed_up_user_id,
  slm.signed_up_workspace_id,
  slm.match_confidence,
  slm.trial_status,
  slm.trial_started_at,
  COALESCE(slm.usage_summary, '{}'::jsonb),
  slm.notes,
  COALESCE(slm.metadata, '{}'::jsonb) || jsonb_build_object('legacySource', 'salesperson_lead_master'),
  slm.created_at,
  slm.updated_at
FROM public.salesperson_lead_master slm
LEFT JOIN public.sales_reps sr ON sr.legacy_salesperson_id = slm.assigned_salesperson_id
WHERE to_regclass('public.salesperson_lead_master') IS NOT NULL
ON CONFLICT (id) DO UPDATE
SET
  legacy_contact_id = COALESCE(public.sales_leads.legacy_contact_id, EXCLUDED.legacy_contact_id),
  legacy_dialler_lead_id = COALESCE(public.sales_leads.legacy_dialler_lead_id, EXCLUDED.legacy_dialler_lead_id),
  legacy_master_lead_id = COALESCE(public.sales_leads.legacy_master_lead_id, EXCLUDED.legacy_master_lead_id),
  updated_at = GREATEST(public.sales_leads.updated_at, EXCLUDED.updated_at);

-- Backfill dialer-only rows that never made it into the old master table.
INSERT INTO public.sales_leads (
  workspace_id,
  assigned_user_id,
  legacy_dialler_lead_id,
  name,
  company,
  phone,
  phone_e164,
  phone_country_code,
  phone_area_code,
  phone_area_label,
  email,
  email_normalized,
  source,
  external_id,
  lead_fingerprint,
  lead_state,
  next_follow_up_at,
  follow_up_name,
  demo_link_follow_up_id,
  disposition,
  is_starred,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  dl.workspace_id,
  dl.user_id,
  dl.id,
  COALESCE(NULLIF(trim(dl.name), ''), 'Lead'),
  dl.company,
  dl.phone,
  dl.phone_e164,
  dl.phone_country_code,
  dl.phone_area_code,
  dl.phone_area_label,
  dl.email,
  nullif(lower(trim(dl.email)), ''),
  'dialler_leads',
  dl.id::text,
  nullif(lower(concat_ws('|', NULLIF(trim(dl.name), ''), NULLIF(trim(dl.phone_e164), ''), NULLIF(trim(dl.email), ''))), ''),
  CASE
    WHEN dl.disposition = 'interested' THEN 'interested'
    WHEN dl.disposition = 'callback' THEN 'callback'
    WHEN dl.disposition = 'not_now' THEN 'not_now'
    WHEN dl.disposition = 'dnc' THEN 'dnc'
    WHEN dl.called_at IS NOT NULL THEN 'attempting'
    ELSE 'queued'
  END,
  dl.follow_up_at,
  dl.follow_up_name,
  dl.demo_link_follow_up_id,
  dl.disposition,
  COALESCE(dl.is_starred, false),
  dl.notes,
  jsonb_build_object('legacySource', 'dialler_leads'),
  dl.created_at,
  dl.updated_at
FROM public.dialler_leads dl
WHERE dl.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.sales_leads existing
    WHERE existing.legacy_dialler_lead_id = dl.id
       OR (
         existing.workspace_id = dl.workspace_id
         AND existing.phone_e164 IS NOT NULL
         AND existing.phone_e164 = dl.phone_e164
       )
  );

-- Backfill scraped/imported sales records that were previously stored in contacts.
INSERT INTO public.sales_leads (
  workspace_id,
  assigned_user_id,
  created_by_user_id,
  legacy_contact_id,
  name,
  phone,
  phone_e164,
  phone_country_code,
  phone_area_code,
  phone_area_label,
  email,
  email_normalized,
  address,
  source,
  external_id,
  lead_fingerprint,
  lead_state,
  next_follow_up_at,
  demo_link_follow_up_id,
  disposition,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  c.workspace_id,
  c.user_id,
  c.user_id,
  c.id,
  COALESCE(NULLIF(trim(c.full_name), ''), 'Lead'),
  c.phone,
  c.phone_e164,
  c.phone_country_code,
  c.phone_area_code,
  c.phone_area_label,
  c.email,
  nullif(lower(trim(c.email)), ''),
  c.address,
  COALESCE(NULLIF(c.source, ''), 'contacts_scraped'),
  c.id::text,
  nullif(lower(concat_ws('|', NULLIF(trim(c.full_name), ''), NULLIF(trim(c.phone_e164), ''), NULLIF(trim(c.email), ''), NULLIF(trim(c.address), ''))), ''),
  CASE
    WHEN c.status = 'hot' THEN 'interested'
    WHEN c.status = 'warm' THEN 'callback'
    WHEN c.status = 'cold' THEN 'not_now'
    ELSE 'assigned'
  END,
  COALESCE(c.follow_up_at, c.reminder_date),
  c.demo_link_follow_up_id,
  c.status,
  c.notes,
  jsonb_build_object(
    'legacySource', 'contacts',
    'tags', c.tags,
    'campaignId', c.campaign_id,
    'farmId', c.farm_id,
    'addressId', c.address_id,
    'gersId', c.gers_id
  ),
  c.created_at,
  c.updated_at
FROM public.contacts c
WHERE c.workspace_id IS NOT NULL
  AND c.user_id IS NOT NULL
  AND c.lead_kind = 'scraped'
ON CONFLICT (legacy_contact_id) DO NOTHING;

-- Preserve old contact activities on the matching sales lead before deleting
-- scraped contact rows.
INSERT INTO public.sales_activities (
  workspace_id,
  sales_lead_id,
  actor_user_id,
  activity_type,
  note,
  occurred_at,
  metadata,
  created_at
)
SELECT
  sl.workspace_id,
  sl.id,
  sl.assigned_user_id,
  ca.type,
  ca.note,
  COALESCE(ca.timestamp, ca.created_at, now()),
  jsonb_build_object('legacyContactActivityId', ca.id),
  COALESCE(ca.created_at, now())
FROM public.contact_activities ca
JOIN public.sales_leads sl ON sl.legacy_contact_id = ca.contact_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sales_activities existing
  WHERE existing.metadata->>'legacyContactActivityId' = ca.id::text
);

-- Attach sales leads to dialer history, then clear legacy contact FKs that would
-- otherwise keep scraped sales records in the customer contacts table.
ALTER TABLE public.dialer_session_leads
  ADD COLUMN IF NOT EXISTS sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL;

ALTER TABLE public.dialer_calls
  ADD COLUMN IF NOT EXISTS sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL;

ALTER TABLE public.dialer_sms_followups
  ADD COLUMN IF NOT EXISTS sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL;

ALTER TABLE public.dialer_inbound_messages
  ADD COLUMN IF NOT EXISTS sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL;

ALTER TABLE public.inbox_items
  ADD COLUMN IF NOT EXISTS sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dialer_session_leads_sales_lead_idx
  ON public.dialer_session_leads(sales_lead_id)
  WHERE sales_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dialer_calls_sales_lead_idx
  ON public.dialer_calls(sales_lead_id, created_at DESC)
  WHERE sales_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dialer_sms_followups_sales_lead_idx
  ON public.dialer_sms_followups(sales_lead_id, created_at DESC)
  WHERE sales_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dialer_inbound_messages_sales_lead_idx
  ON public.dialer_inbound_messages(sales_lead_id, received_at DESC)
  WHERE sales_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_items_sales_lead_occurred_idx
  ON public.inbox_items(sales_lead_id, occurred_at DESC)
  WHERE sales_lead_id IS NOT NULL;

UPDATE public.dialer_session_leads dsl
SET sales_lead_id = sl.id
FROM public.sales_leads sl
WHERE dsl.sales_lead_id IS NULL
  AND dsl.contact_id = sl.legacy_contact_id;

UPDATE public.dialer_calls dc
SET sales_lead_id = sl.id
FROM public.sales_leads sl
WHERE dc.sales_lead_id IS NULL
  AND (
    dc.contact_id = sl.legacy_contact_id
    OR dc.status_payload->>'diallerLeadId' = sl.legacy_dialler_lead_id::text
  );

UPDATE public.dialer_sms_followups dsf
SET sales_lead_id = sl.id
FROM public.sales_leads sl
WHERE dsf.sales_lead_id IS NULL
  AND dsf.contact_id = sl.legacy_contact_id;

UPDATE public.dialer_inbound_messages dim
SET sales_lead_id = sl.id
FROM public.sales_leads sl
WHERE dim.sales_lead_id IS NULL
  AND dim.contact_id = sl.legacy_contact_id;

UPDATE public.inbox_items ii
SET sales_lead_id = sl.id
FROM public.sales_leads sl
WHERE ii.sales_lead_id IS NULL
  AND ii.contact_id = sl.legacy_contact_id;

ALTER TABLE public.dialer_sms_followups
  ALTER COLUMN contact_id DROP NOT NULL;

UPDATE public.dialer_session_leads
SET contact_id = NULL
WHERE sales_lead_id IS NOT NULL
  AND contact_id IN (
    SELECT legacy_contact_id FROM public.sales_leads WHERE legacy_contact_id IS NOT NULL
  );

UPDATE public.dialer_calls
SET contact_id = NULL
WHERE sales_lead_id IS NOT NULL
  AND contact_id IN (
    SELECT legacy_contact_id FROM public.sales_leads WHERE legacy_contact_id IS NOT NULL
  );

UPDATE public.dialer_sms_followups
SET contact_id = NULL
WHERE sales_lead_id IS NOT NULL
  AND contact_id IN (
    SELECT legacy_contact_id FROM public.sales_leads WHERE legacy_contact_id IS NOT NULL
  );

UPDATE public.dialer_inbound_messages
SET contact_id = NULL
WHERE sales_lead_id IS NOT NULL
  AND contact_id IN (
    SELECT legacy_contact_id FROM public.sales_leads WHERE legacy_contact_id IS NOT NULL
  );

UPDATE public.inbox_items
SET contact_id = NULL
WHERE sales_lead_id IS NOT NULL
  AND contact_id IN (
    SELECT legacy_contact_id FROM public.sales_leads WHERE legacy_contact_id IS NOT NULL
  );

DELETE FROM public.contact_activities ca
USING public.sales_leads sl
WHERE ca.contact_id = sl.legacy_contact_id;

DELETE FROM public.contacts c
WHERE c.lead_kind = 'scraped'
  AND EXISTS (
    SELECT 1
    FROM public.sales_leads sl
    WHERE sl.legacy_contact_id = c.id
  );

-- Stop the old mixed-table sync. Regular FLYR app contacts must not
-- automatically appear in sales/prospecting tables.
DROP TRIGGER IF EXISTS sync_contact_to_salesperson_lead_master ON public.contacts;

COMMENT ON TABLE public.sales_leads IS
  'Canonical internal sales/prospecting leads. Regular FLYR customer leads remain in contacts/campaign_contacts.';

COMMENT ON COLUMN public.sales_leads.converted_contact_id IS
  'Regular FLYR contact created only by an explicit manual conversion from a sales lead.';

COMMENT ON COLUMN public.sales_leads.legacy_contact_id IS
  'Former contacts.id for migrated scraped/salesperson rows. Kept only for migration traceability.';

COMMENT ON TABLE public.salesperson_lead_master IS
  'Deprecated compatibility table. New code should use public.sales_leads.';

COMMENT ON TABLE public.dialler_leads IS
  'Deprecated compatibility table. New code should use public.sales_leads for dialer queues.';

COMMIT;
