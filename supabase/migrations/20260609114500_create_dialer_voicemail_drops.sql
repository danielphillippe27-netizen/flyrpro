CREATE TABLE IF NOT EXISTS public.dialer_voicemail_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_bucket text NOT NULL DEFAULT 'dialer-voicemail-drops',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  filename text,
  content_type text,
  duration_seconds integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialer_voicemail_drops_workspace_active
  ON public.dialer_voicemail_drops(workspace_id, is_active, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_dialer_voicemail_drops_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_dialer_voicemail_drops_updated_at ON public.dialer_voicemail_drops;
CREATE TRIGGER set_dialer_voicemail_drops_updated_at
BEFORE UPDATE ON public.dialer_voicemail_drops
FOR EACH ROW
EXECUTE FUNCTION public.set_dialer_voicemail_drops_updated_at();

ALTER TABLE public.dialer_voicemail_drops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dialer_voicemail_drops_workspace_members_select ON public.dialer_voicemail_drops;
CREATE POLICY dialer_voicemail_drops_workspace_members_select
ON public.dialer_voicemail_drops
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_voicemail_drops.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialer_voicemail_drops_workspace_members_insert ON public.dialer_voicemail_drops;
CREATE POLICY dialer_voicemail_drops_workspace_members_insert
ON public.dialer_voicemail_drops
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_voicemail_drops.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS dialer_voicemail_drops_workspace_members_update ON public.dialer_voicemail_drops;
CREATE POLICY dialer_voicemail_drops_workspace_members_update
ON public.dialer_voicemail_drops
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_voicemail_drops.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = dialer_voicemail_drops.workspace_id
      AND wm.user_id = auth.uid()
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dialer-voicemail-drops',
  'dialer-voicemail-drops',
  true,
  10485760,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read dialer voicemail drops" ON storage.objects;
CREATE POLICY "Public read dialer voicemail drops"
ON storage.objects FOR SELECT
USING (bucket_id = 'dialer-voicemail-drops');

DROP POLICY IF EXISTS "Workspace members upload dialer voicemail drops" ON storage.objects;
CREATE POLICY "Workspace members upload dialer voicemail drops"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'dialer-voicemail-drops'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Workspace members update dialer voicemail drops" ON storage.objects;
CREATE POLICY "Workspace members update dialer voicemail drops"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'dialer-voicemail-drops'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'dialer-voicemail-drops'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Workspace members delete dialer voicemail drops" ON storage.objects;
CREATE POLICY "Workspace members delete dialer voicemail drops"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'dialer-voicemail-drops'
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id::text = (storage.foldername(name))[1]
      AND wm.user_id = auth.uid()
  )
);
