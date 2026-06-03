import { NextResponse, type NextRequest } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser } from '@/app/api/_utils/workspace';
import { normalizeCalendarEventPayload } from '@/lib/calendar/api';
import type { CalendarEventRow } from '@/lib/calendar/types';
import { createAdminClient } from '@/lib/supabase/server';

const SELECT_COLUMNS = [
  'id',
  'user_id',
  'workspace_id',
  'title',
  'start_at',
  'end_at',
  'is_all_day',
  'event_type',
  'contact_id',
  'contact_name',
  'contact_address',
  'source_kind',
  'source_id',
  'notes',
  'location',
  'color_key',
  'created_at',
  'updated_at',
  'deleted_at',
].join(',');

async function fetchAuthorizedEvent(request: NextRequest, id: string) {
  const user = await resolveUserFromRequest(request);
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('calendar_events')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!data) {
    return { error: NextResponse.json({ error: 'Calendar event not found' }, { status: 404 }) };
  }

  const event = data as unknown as CalendarEventRow;
  if (event.workspace_id) {
    const membership = await resolveWorkspaceMembershipForUser(admin, user.id, event.workspace_id);
    if (membership.error || !membership.workspaceId) {
      return { error: NextResponse.json({ error: 'Workspace access denied' }, { status: 403 }) };
    }
  } else if (event.user_id !== user.id) {
    return { error: NextResponse.json({ error: 'Calendar event access denied' }, { status: 403 }) };
  }

  return { admin, event };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const resolved = await fetchAuthorizedEvent(request, id);
  if (resolved.error) return resolved.error;

  const body = await request.json().catch(() => ({}));
  let normalized;
  try {
    normalized = normalizeCalendarEventPayload(body, resolved.event);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid calendar event' },
      { status: 400 }
    );
  }

  const { data, error } = await resolved.admin
    .from('calendar_events')
    .update({
      ...normalized,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    })
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ event: { ...(data as unknown as CalendarEventRow), kind: 'standalone' } });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const resolved = await fetchAuthorizedEvent(request, id);
  if (resolved.error) return resolved.error;

  const now = new Date().toISOString();
  const { error } = await resolved.admin
    .from('calendar_events')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
