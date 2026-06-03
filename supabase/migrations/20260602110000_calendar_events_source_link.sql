CREATE TABLE IF NOT EXISTS public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
    event_type TEXT NOT NULL DEFAULT 'appointment',
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    contact_name TEXT,
    contact_address TEXT,
    source_kind TEXT,
    source_id UUID,
    notes TEXT,
    location TEXT,
    color_key TEXT NOT NULL DEFAULT 'red',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE public.calendar_events
    ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'appointment',
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contact_name TEXT,
    ADD COLUMN IF NOT EXISTS contact_address TEXT,
    ADD COLUMN IF NOT EXISTS source_kind TEXT,
    ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_range
    ON public.calendar_events(user_id, start_at, end_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_workspace_range
    ON public.calendar_events(workspace_id, start_at, end_at)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_contact_id
    ON public.calendar_events(contact_id)
    WHERE contact_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_source_unique
    ON public.calendar_events(source_kind, source_id, event_type)
    WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS reminder_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;

INSERT INTO public.calendar_events (
    user_id,
    workspace_id,
    title,
    start_at,
    end_at,
    is_all_day,
    event_type,
    contact_id,
    contact_name,
    contact_address,
    source_kind,
    source_id,
    notes,
    location,
    color_key,
    created_at,
    updated_at
)
SELECT
    c.user_id,
    c.workspace_id,
    'Follow up: ' || COALESCE(NULLIF(c.full_name, ''), 'Lead'),
    COALESCE(c.follow_up_at, c.reminder_date),
    COALESCE(c.follow_up_at, c.reminder_date) + INTERVAL '30 minutes',
    FALSE,
    'follow_up',
    c.id,
    c.full_name,
    c.address,
    'contact_follow_up',
    c.id,
    c.notes,
    c.address,
    'blue',
    NOW(),
    NOW()
FROM public.contacts c
WHERE COALESCE(c.follow_up_at, c.reminder_date) IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.calendar_events ce
      WHERE ce.source_kind = 'contact_follow_up'
        AND ce.source_id = c.id
        AND ce.event_type = 'follow_up'
  );

INSERT INTO public.calendar_events (
    user_id,
    workspace_id,
    title,
    start_at,
    end_at,
    is_all_day,
    event_type,
    contact_id,
    contact_name,
    contact_address,
    source_kind,
    source_id,
    notes,
    location,
    color_key,
    created_at,
    updated_at
)
SELECT
    c.user_id,
    c.workspace_id,
    'Appointment: ' || COALESCE(NULLIF(c.full_name, ''), 'Lead'),
    c.appointment_at,
    c.appointment_at + INTERVAL '1 hour',
    FALSE,
    'appointment',
    c.id,
    c.full_name,
    c.address,
    'contact_appointment',
    c.id,
    c.notes,
    c.address,
    'red',
    NOW(),
    NOW()
FROM public.contacts c
WHERE c.appointment_at IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.calendar_events ce
      WHERE ce.source_kind = 'contact_appointment'
        AND ce.source_id = c.id
        AND ce.event_type = 'appointment'
  );

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Calendar events are readable by owner or workspace members"
    ON public.calendar_events;
CREATE POLICY "Calendar events are readable by owner or workspace members"
    ON public.calendar_events
    FOR SELECT
    USING (
        auth.uid() = user_id
        OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    );

DROP POLICY IF EXISTS "Calendar events are insertable by owner or workspace members"
    ON public.calendar_events;
CREATE POLICY "Calendar events are insertable by owner or workspace members"
    ON public.calendar_events
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    );

DROP POLICY IF EXISTS "Calendar events are updatable by owner or workspace members"
    ON public.calendar_events;
CREATE POLICY "Calendar events are updatable by owner or workspace members"
    ON public.calendar_events
    FOR UPDATE
    USING (
        auth.uid() = user_id
        OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    )
    WITH CHECK (
        auth.uid() = user_id
        OR (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
    );
