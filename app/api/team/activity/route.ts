import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

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

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const resolution = await resolveTeamDashboardMode(
      supabase as unknown as MinimalSupabaseClient,
      user.id,
      workspaceId
    );
    if (resolution.error || !resolution.workspaceId || resolution.mode !== 'team_owner') {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    const { start, end } = parseRange(searchParams.get('start'), searchParams.get('end'));
    const typeFilter = searchParams.get('type') || undefined;
    const memberId = searchParams.get('memberId') || undefined;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50));
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

    const rpcArgs = {
      p_workspace_id: resolution.workspaceId,
      p_start_ts: start,
      p_end_ts: end,
      p_type_filter: typeFilter ?? null,
      p_limit_count: limit,
      p_offset_count: offset,
      p_user_id: memberId ?? null,
    };

    let usedLegacySignature = false;
    let { data, error } = await authClient.rpc('get_team_activity_feed', rpcArgs);

    const missingUserFilterSignature =
      !!error &&
      typeof error.message === 'string' &&
      error.message.includes('get_team_activity_feed') &&
      error.message.includes('p_user_id');

    // Backward compatibility: older DBs had a 6-arg get_team_activity_feed without p_user_id.
    if (missingUserFilterSignature) {
      usedLegacySignature = true;
      const legacy = await authClient.rpc('get_team_activity_feed', {
        p_workspace_id: resolution.workspaceId,
        p_start_ts: start,
        p_end_ts: end,
        p_type_filter: typeFilter ?? null,
        p_limit_count: limit,
        p_offset_count: offset,
      });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) {
      console.error('[team/activity] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = data as { error?: string; events?: unknown[]; total?: number };
    if (result?.error === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let events = (result?.events ?? []) as Array<{ user_id?: string }>;
    let total = result?.total ?? 0;
    if (usedLegacySignature && memberId) {
      events = events.filter((event) => event.user_id === memberId);
      total = events.length;
    }

    return NextResponse.json({
      events,
      items: events,
      total,
      nextOffset: offset + events.length < total ? offset + events.length : null,
    });
  } catch (err) {
    console.error('[team/activity] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
