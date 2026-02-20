-- Add in-app feedback submissions with workspace-aware access controls.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text CHECK (role IS NULL OR role IN ('owner', 'admin', 'member')),
  page text,
  message text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 3000),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_workspace_created
  ON public.feedback_submissions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_created
  ON public.feedback_submissions(user_id, created_at DESC);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can insert own workspace feedback" ON public.feedback_submissions;
CREATE POLICY "users can insert own workspace feedback"
ON public.feedback_submissions
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND public.is_workspace_member(workspace_id)
);

DROP POLICY IF EXISTS "users can view own feedback submissions" ON public.feedback_submissions;
CREATE POLICY "users can view own feedback submissions"
ON public.feedback_submissions
FOR SELECT
USING (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS "workspace admins can view feedback submissions" ON public.feedback_submissions;
CREATE POLICY "workspace admins can view feedback submissions"
ON public.feedback_submissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = feedback_submissions.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  )
);

COMMIT;
