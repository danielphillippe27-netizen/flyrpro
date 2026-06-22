ALTER TABLE public.dialler_leads
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

WITH latest_call AS (
  SELECT DISTINCT ON (dc.status_payload->>'diallerLeadId')
    dc.status_payload->>'diallerLeadId' AS lead_id,
    dc.user_id
  FROM public.dialer_calls dc
  WHERE dc.status_payload->>'diallerLeadId' IS NOT NULL
    AND dc.user_id IS NOT NULL
  ORDER BY dc.status_payload->>'diallerLeadId', dc.created_at DESC
)
UPDATE public.dialler_leads dl
SET user_id = latest_call.user_id
FROM latest_call
WHERE dl.id::text = latest_call.lead_id
  AND dl.user_id IS NULL;

UPDATE public.dialler_leads dl
SET user_id = sp.user_id
FROM public.salesperson_demo_links sdl
JOIN public.salespeople sp ON sp.id = sdl.salesperson_id
WHERE dl.id = sdl.dialler_lead_id
  AND dl.user_id IS NULL
  AND sp.user_id IS NOT NULL;

UPDATE public.dialler_leads dl
SET user_id = single_member.user_id
FROM (
  SELECT workspace_id, (array_agg(user_id ORDER BY created_at))[1] AS user_id
  FROM public.workspace_members
  GROUP BY workspace_id
  HAVING count(*) = 1
) single_member
WHERE dl.workspace_id = single_member.workspace_id
  AND dl.user_id IS NULL;

CREATE INDEX IF NOT EXISTS dialler_leads_workspace_user_created_idx
  ON public.dialler_leads(workspace_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS dialler_leads_user_created_idx
  ON public.dialler_leads(user_id, created_at);

DROP POLICY IF EXISTS dialler_leads_workspace_members_select ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_select
ON public.dialler_leads
FOR SELECT
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialler_leads_workspace_members_insert ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_insert
ON public.dialler_leads
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialler_leads_workspace_members_update ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_update
ON public.dialler_leads
FOR UPDATE
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialler_leads_workspace_members_delete ON public.dialler_leads;
CREATE POLICY dialler_leads_workspace_members_delete
ON public.dialler_leads
FOR DELETE
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialler_leads.workspace_id
      AND wm.user_id = auth.uid()
  )
);
