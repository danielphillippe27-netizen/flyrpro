import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

function toBool(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseRange(start?: string | null, end?: string | null): { start: string; end: string } {
  const now = new Date();
  const endDate = end ? new Date(end) : now;
  let startDate: Date;
  if (start) {
    startDate = new Date(start);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
    startDate.setUTCHours(0, 0, 0, 0);
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

type SessionEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  event_time: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedWorkspaceId = searchParams.get('workspaceId') ?? undefined;
    const typeFilter = (searchParams.get('type') || '').trim() || null;
    const includeMembersRequested = toBool(searchParams.get('includeMembers'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10) || 30));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));

    const admin = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      requestedWorkspaceId
    );

    if (!access.workspaceId) {
      return NextResponse.json(
        { error: access.error ?? 'No workspace available' },
        { status: access.status ?? 400 }
      );
    }

    const canIncludeMembers = access.role === 'owner' || access.role === 'admin';
    const includeMembers = canIncludeMembers && includeMembersRequested;

    const { data: workspaceMembers } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', access.workspaceId);

    const workspaceUserIds = new Set<string>((workspaceMembers ?? []).map((m: { user_id: string }) => m.user_id));

    let query = admin
      .from('session_events')
      .select('id, user_id, event_type, event_time, payload, created_at', { count: 'exact' })
      .eq('workspace_id', access.workspaceId)
      .gte('event_time', start)
      .lte('event_time', end)
      .order('event_time', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!includeMembers) {
      query = query.eq('user_id', user.id);
    }

    if (typeFilter) {
      query = query.eq('event_type', typeFilter);
    }

    let { data: rows, error: rowsError, count } = await query;

    if (rowsError) {
      // Fallback for older DBs where session_events may not have workspace_id yet
      let fallback = admin
        .from('session_events')
        .select('id, user_id, event_type, event_time, payload, created_at', { count: 'exact' })
        .gte('event_time', start)
        .lte('event_time', end)
        .order('event_time', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!includeMembers) {
        fallback = fallback.eq('user_id', user.id);
      } else {
        const ids = Array.from(workspaceUserIds);
        if (ids.length === 0) {
          return NextResponse.json({ events: [], total: 0, nextOffset: null, canIncludeMembers, includeMembers });
        }
        fallback = fallback.in('user_id', ids);
      }
      if (typeFilter) {
        fallback = fallback.eq('event_type', typeFilter);
      }

      const fallbackResult = await fallback;
      rows = fallbackResult.data;
      rowsError = fallbackResult.error;
      count = fallbackResult.count;
    }

    if (rowsError) {
      console.error('[activity] Failed to load events:', rowsError);
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }

    const events = ((rows ?? []) as SessionEventRow[]).filter((row) => workspaceUserIds.has(row.user_id));

    const userIds = Array.from(new Set(events.map((row) => row.user_id)));
    const { data: profiles } = userIds.length
      ? await admin
          .from('user_profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', userIds)
      : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> };

    const profileMap = new Map(
      (profiles ?? []).map((profile: { user_id: string; first_name: string | null; last_name: string | null }) => {
        const fullName = [profile.first_name, profile.last_name]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join(' ')
          .trim();
        return [profile.user_id, fullName || 'Member'];
      })
    );

    const normalizedEvents = events.map((event) => ({
      ...event,
      display_name: profileMap.get(event.user_id) ?? 'Member',
      payload: event.payload ?? {},
    }));

    const total = count ?? normalizedEvents.length;

    return NextResponse.json({
      events: normalizedEvents,
      total,
      nextOffset: offset + normalizedEvents.length < total ? offset + normalizedEvents.length : null,
      canIncludeMembers,
      includeMembers,
      workspaceId: access.workspaceId,
    });
  } catch (error) {
    console.error('[activity] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
