import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { callLeaderboardRpc } from '@/lib/supabase/leaderboard-rpc';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

type TeamLeaderboardRow = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  doors_knocked: number;
  conversations: number;
  leads: number;
  distance_meters?: number;
};

type TeamLeaderboardDiagnostics = {
  source: 'leaderboard_rollups';
  message: string | null;
  member_count: number;
  workspace_session_count: number | null;
  member_unscoped_session_count: number | null;
  member_other_workspace_session_count: number | null;
};

function toNumber(value: unknown): number {
  return Number(value) || 0;
}

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const authRpcClient = await getSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const resolution = await resolveTeamDashboardMode(
      supabase as unknown as MinimalSupabaseClient,
      user.id,
      workspaceId
    );
    if (resolution.error || !resolution.workspaceId || !resolution.role) {
      return NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      );
    }

    const { data, error } = await callLeaderboardRpc(authRpcClient, {
      p_metric: 'doorknocks',
      p_timeframe: 'all_time',
      p_workspace_id: resolution.workspaceId,
      p_limit: 100,
      p_offset: 0,
    });

    if (error) {
      console.error('[team/leaderboard] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      user_id: String((row as Record<string, unknown>).user_id ?? (row as Record<string, unknown>).id ?? ''),
      display_name: String((row as Record<string, unknown>).name ?? 'Member'),
      avatar_url: typeof (row as Record<string, unknown>).avatar_url === 'string'
        ? String((row as Record<string, unknown>).avatar_url)
        : null,
      doors_knocked: toNumber((row as Record<string, unknown>).doorknocks),
      conversations: toNumber((row as Record<string, unknown>).conversations),
      leads: toNumber((row as Record<string, unknown>).leads),
      distance_meters: Math.round(toNumber((row as Record<string, unknown>).distance) * 1000),
    })) as TeamLeaderboardRow[];

    const inactiveMembers = [] as TeamLeaderboardRow[];
    const summaryCards = rows.reduce(
      (acc, row) => {
        acc.doors += row.doors_knocked;
        acc.conversations += row.conversations;
        acc.leads += row.leads;
        acc.distance_meters += toNumber(row.distance_meters);
        return acc;
      },
      { doors: 0, conversations: 0, leads: 0, distance_meters: 0 }
    );

    const diagnostics: TeamLeaderboardDiagnostics = {
      source: 'leaderboard_rollups',
      message: null,
      member_count: rows.length,
      workspace_session_count: null,
      member_unscoped_session_count: null,
      member_other_workspace_session_count: null,
    };

    return NextResponse.json({
      rows,
      inactiveMembers,
      summaryCards,
      diagnostics,
      trend: null,
    });
  } catch (err) {
    console.error('[team/leaderboard] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
