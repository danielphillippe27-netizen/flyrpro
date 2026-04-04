import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveTeamManagementContext } from '@/app/api/team/_lib/manage';

type TeamGoalMemberPayload = {
  user_id: string;
  weekly_door_goal: number;
};

type TeamGoalsPayload = {
  workspaceId?: string | null;
  weekly_sessions_goal?: number | null;
  member_goals?: TeamGoalMemberPayload[];
};

type TeamGoalMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
  color: string;
  weekly_door_goal: number;
};

type TeamGoalsResponse = {
  weekly_door_goal: number;
  weekly_sessions_goal: number | null;
  source: 'workspace' | 'member_aggregate';
  members: TeamGoalMember[];
};

type WorkspaceGoalsRow = {
  weekly_door_goal: number | null;
  weekly_sessions_goal: number | null;
};

type ProfileGoalsRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  weekly_door_goal: number | null;
  weekly_sessions_goal: number | null;
};

function hasConfiguredWorkspaceGoals(goals: WorkspaceGoalsRow | null | undefined): boolean {
  return goals?.weekly_door_goal != null || goals?.weekly_sessions_goal != null;
}

type WorkspaceMemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | null;
  color: string | null;
  created_at: string;
};

function buildDisplayName(profile?: ProfileGoalsRow | null): string {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName || 'Member';
}

function roleSortValue(role: WorkspaceMemberRow['role']): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  return 2;
}

async function buildMemberAggregateGoals(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<TeamGoalsResponse> {
  const { data: memberRows, error: membersError } = await supabase
    .from('workspace_members')
    .select('user_id, role, color, created_at')
    .eq('workspace_id', workspaceId);

  if (membersError) {
    throw membersError;
  }

  const members = (memberRows ?? []) as WorkspaceMemberRow[];
  const userIds = members
    .map((row) => row.user_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (userIds.length === 0) {
    return {
      weekly_door_goal: 0,
      weekly_sessions_goal: null,
      source: 'member_aggregate',
      members: [],
    };
  }

  const { data: profileRows, error: profilesError } = await supabase
    .from('user_profiles')
    .select('user_id, first_name, last_name, weekly_door_goal, weekly_sessions_goal')
    .in('user_id', userIds);

  if (profilesError) {
    throw profilesError;
  }

  const profileByUserId = new Map(
    ((profileRows ?? []) as ProfileGoalsRow[]).map((row) => [row.user_id, row])
  );

  let weeklyDoorGoal = 0;
  let weeklySessionsGoal = 0;
  let hasSessionsGoal = false;

  for (const userId of userIds) {
    const profile = profileByUserId.get(userId);
    weeklyDoorGoal += Math.max(0, profile?.weekly_door_goal ?? 100);

    if (profile?.weekly_sessions_goal != null) {
      weeklySessionsGoal += Math.max(0, profile.weekly_sessions_goal);
      hasSessionsGoal = true;
    }
  }

  return {
    weekly_door_goal: weeklyDoorGoal,
    weekly_sessions_goal: hasSessionsGoal ? weeklySessionsGoal : null,
    source: 'member_aggregate',
    members: members
      .slice()
      .sort((left, right) => {
        const byRole = roleSortValue(left.role) - roleSortValue(right.role);
        if (byRole !== 0) return byRole;
        return left.created_at.localeCompare(right.created_at);
      })
      .map((member) => {
        const profile = profileByUserId.get(member.user_id);
        return {
          user_id: member.user_id,
          display_name: buildDisplayName(profile),
          role: member.role ?? 'member',
          color: member.color ?? '#3B82F6',
          weekly_door_goal: Math.max(0, profile?.weekly_door_goal ?? 100),
        };
      }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
    const context = await resolveTeamManagementContext(supabase, user.id, requestedWorkspaceId);

    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('weekly_door_goal, weekly_sessions_goal')
      .eq('id', context.workspaceId)
      .maybeSingle();

    if (error) {
      console.error('[team/goals] GET workspace error:', error);
      return NextResponse.json({ error: 'Failed to load team goals' }, { status: 500 });
    }

    const aggregateGoals = await buildMemberAggregateGoals(supabase, context.workspaceId);
    const workspaceGoals = (workspace ?? null) as WorkspaceGoalsRow | null;

    return NextResponse.json({
      ...aggregateGoals,
      weekly_sessions_goal:
        workspaceGoals?.weekly_sessions_goal != null
          ? workspaceGoals.weekly_sessions_goal
          : aggregateGoals.weekly_sessions_goal,
      source: hasConfiguredWorkspaceGoals(workspaceGoals) ? 'workspace' : 'member_aggregate',
    } satisfies TeamGoalsResponse);
  } catch (error) {
    console.error('[team/goals] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as TeamGoalsPayload;
    const supabase = createAdminClient();
    const context = await resolveTeamManagementContext(supabase, user.id, body.workspaceId ?? null);

    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    const updates: Record<string, number | null | string> = {
      updated_at: new Date().toISOString(),
    };

    if (body.weekly_sessions_goal !== undefined) {
      updates.weekly_sessions_goal =
        body.weekly_sessions_goal == null ? null : Math.max(0, Number(body.weekly_sessions_goal));
    }

    const memberGoals = Array.isArray(body.member_goals)
      ? body.member_goals.filter(
          (goal): goal is TeamGoalMemberPayload =>
            !!goal &&
            typeof goal.user_id === 'string' &&
            goal.user_id.length > 0 &&
            Number.isFinite(Number(goal.weekly_door_goal))
        )
      : [];

    if (memberGoals.length > 0) {
      const { data: workspaceMembers, error: workspaceMembersError } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', context.workspaceId);

      if (workspaceMembersError) {
        console.error('[team/goals] PATCH workspace members error:', workspaceMembersError);
        return NextResponse.json({ error: 'Failed to update team goals' }, { status: 500 });
      }

      const validUserIds = new Set(
        (workspaceMembers ?? [])
          .map((row) => row.user_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      );

      const updatesToApply = memberGoals.filter((goal) => validUserIds.has(goal.user_id));

      const updateResults = await Promise.all(
        updatesToApply.map((goal) =>
          supabase
            .from('user_profiles')
            .upsert(
              {
                user_id: goal.user_id,
                weekly_door_goal: Math.max(0, Number(goal.weekly_door_goal)),
              },
              { onConflict: 'user_id' }
            )
        )
      );

      const failedUpdate = updateResults.find((result) => result.error);
      if (failedUpdate?.error) {
        console.error('[team/goals] PATCH member goal error:', failedUpdate.error);
        return NextResponse.json({ error: 'Failed to update team member goals' }, { status: 500 });
      }

      updates.weekly_door_goal = updatesToApply.reduce(
        (sum, goal) => sum + Math.max(0, Number(goal.weekly_door_goal)),
        0
      );
    }

    if (Object.keys(updates).length === 1 && memberGoals.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (Object.keys(updates).length > 1) {
      const { error } = await supabase
        .from('workspaces')
        .update(updates)
        .eq('id', context.workspaceId);

      if (error) {
        console.error('[team/goals] PATCH error:', error);
        return NextResponse.json({ error: 'Failed to update team goals' }, { status: 500 });
      }
    }

    const refreshedGoals = await buildMemberAggregateGoals(supabase, context.workspaceId);
    const { data: savedWorkspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('weekly_sessions_goal')
      .eq('id', context.workspaceId)
      .maybeSingle();

    if (workspaceError) {
      console.error('[team/goals] PATCH reload error:', workspaceError);
      return NextResponse.json({ error: 'Failed to update team goals' }, { status: 500 });
    }

    return NextResponse.json({
      ...refreshedGoals,
      weekly_sessions_goal:
        savedWorkspace?.weekly_sessions_goal != null
          ? savedWorkspace.weekly_sessions_goal
          : refreshedGoals.weekly_sessions_goal,
      source: 'workspace',
    } satisfies TeamGoalsResponse);
  } catch (error) {
    console.error('[team/goals] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
