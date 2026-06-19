BEGIN;

CREATE TABLE IF NOT EXISTS public.salesperson_demo_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  salesperson_id uuid NOT NULL REFERENCES public.salespeople(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  dialler_lead_id uuid REFERENCES public.dialler_leads(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  referral_code text NOT NULL,
  recipient_email text,
  recipient_name text,
  source text,
  campaign text,
  destination_path text NOT NULL DEFAULT '/demo1',
  opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  follow_up_due_at timestamptz,
  follow_up_created_at timestamptz,
  converted_at timestamptz,
  converted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  converted_workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS salesperson_demo_links_salesperson_created_idx
  ON public.salesperson_demo_links(salesperson_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_demo_links_referral_created_idx
  ON public.salesperson_demo_links(referral_code, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_demo_links_recipient_email_idx
  ON public.salesperson_demo_links(lower(recipient_email))
  WHERE recipient_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS salesperson_demo_links_open_followup_idx
  ON public.salesperson_demo_links(opened_at, follow_up_created_at, converted_at)
  WHERE opened_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.salesperson_demo_links_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_demo_links_set_updated_at ON public.salesperson_demo_links;
CREATE TRIGGER salesperson_demo_links_set_updated_at
BEFORE UPDATE ON public.salesperson_demo_links
FOR EACH ROW
EXECUTE FUNCTION public.salesperson_demo_links_set_updated_at();

ALTER TABLE public.salesperson_click_events
  ADD COLUMN IF NOT EXISTS demo_link_id uuid REFERENCES public.salesperson_demo_links(id) ON DELETE SET NULL;

ALTER TABLE public.salesperson_demo_video_events
  ADD COLUMN IF NOT EXISTS demo_link_id uuid REFERENCES public.salesperson_demo_links(id) ON DELETE SET NULL;

ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS demo_link_follow_up_id uuid REFERENCES public.salesperson_demo_links(id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS demo_link_follow_up_id uuid REFERENCES public.salesperson_demo_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS salesperson_click_events_demo_link_idx
  ON public.salesperson_click_events(demo_link_id)
  WHERE demo_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS salesperson_demo_video_events_demo_link_idx
  ON public.salesperson_demo_video_events(demo_link_id)
  WHERE demo_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dialler_leads_demo_link_follow_up_idx
  ON public.dialler_leads(demo_link_follow_up_id)
  WHERE demo_link_follow_up_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_demo_link_follow_up_idx
  ON public.contacts(demo_link_follow_up_id)
  WHERE demo_link_follow_up_id IS NOT NULL;

ALTER TABLE public.salesperson_demo_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salesperson_demo_links_service_role_all" ON public.salesperson_demo_links;
CREATE POLICY "salesperson_demo_links_service_role_all"
  ON public.salesperson_demo_links
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.salesperson_demo_links IS 'Recipient-specific salesperson demo links for rep attribution, opens, follow-up scheduling, and conversion tracking.';
COMMENT ON COLUMN public.salesperson_demo_links.salesperson_id IS 'Sales rep who receives attribution for this tracked demo link.';
COMMENT ON COLUMN public.salesperson_demo_links.dialler_lead_id IS 'Dialer lead that received the tracked demo link.';
COMMENT ON COLUMN public.dialler_leads.demo_link_follow_up_id IS 'Auto-created demo-open follow-up source link. Used to clear the follow-up when the recipient converts.';
COMMENT ON COLUMN public.contacts.demo_link_follow_up_id IS 'Auto-created demo-open follow-up source link. Used to clear the follow-up when the recipient converts.';

COMMIT;
