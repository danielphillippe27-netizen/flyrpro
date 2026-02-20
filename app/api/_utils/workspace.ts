export type MinimalSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => unknown;
  };
};

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type TeamDashboardMode = 'team_owner' | 'default';
export type DashboardAccessLevel =
  | 'founder'
  | 'team_leader'
  | 'member'
  | 'solo_owner'
  | 'unassigned';

type ResolveTeamResult = {
  workspaceId: string | null;
  role: WorkspaceRole | null;
  error?: string;
  status?: number;
};

export type DashboardAccessResolution = {
  workspaceId: string | null;
  role: WorkspaceRole | null;
  memberCount: number;
  isFounder: boolean;
  level: DashboardAccessLevel;
  error?: string;
  status?: number;
};

function roleRank(role: string | null | undefined): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  if (role === 'member') return 2;
  return 3;
}

function classifyDashboardAccessLevel(
  isFounder: boolean,
  role: WorkspaceRole | null,
  memberCount: number
): DashboardAccessLevel {
  if (isFounder) return 'founder';
  if (role === 'member') return 'member';
  if (role === 'admin') return 'team_leader';
  if (role === 'owner') return memberCount > 1 ? 'team_leader' : 'solo_owner';
  return 'unassigned';
}

export async function resolveDashboardAccessLevel(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<DashboardAccessResolution> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;

  const { data: founderProfile } = await supabaseAny
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('is_founder', true)
    .maybeSingle();
  const isFounder = !!founderProfile?.user_id;

  const resolution = await resolveWorkspaceIdForUser(supabase, userId, requestedWorkspaceId);
  if (!resolution.workspaceId) {
    if (isFounder) {
      return {
        workspaceId: null,
        role: null,
        memberCount: 0,
        isFounder,
        level: 'founder',
        status: 200,
      };
    }
    return {
      workspaceId: null,
      role: null,
      memberCount: 0,
      isFounder,
      level: 'unassigned',
      error: resolution.error,
      status: resolution.status ?? 400,
    };
  }

  const { data: membership } = await supabaseAny
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', resolution.workspaceId)
    .maybeSingle();
  const role = (membership?.role as WorkspaceRole) ?? null;

  const { data: memberRows } = await supabaseAny
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', resolution.workspaceId);
  const memberCount = Array.isArray(memberRows) ? memberRows.length : 0;

  return {
    workspaceId: resolution.workspaceId,
    role,
    memberCount,
    isFounder,
    level: classifyDashboardAccessLevel(isFounder, role, memberCount),
    status: 200,
  };
}

/** Resolve workspace, role, and dashboard mode. mode === 'team_owner' only when (owner|admin) and memberCount > 1. */
export async function resolveTeamDashboardMode(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<{ workspaceId: string | null; role: WorkspaceRole | null; mode: TeamDashboardMode; error?: string; status?: number }> {
  const access = await resolveDashboardAccessLevel(supabase, userId, requestedWorkspaceId);
  const mode: TeamDashboardMode = access.level === 'team_leader' ? 'team_owner' : 'default';
  return {
    workspaceId: access.workspaceId,
    role: access.role,
    mode,
    error: access.error,
    status: access.status,
  };
}

/** Resolve workspace id and role for team dashboard; 403 if not owner/admin. */
export async function resolveWorkspaceAndRoleForTeam(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<ResolveTeamResult> {
  const access = await resolveDashboardAccessLevel(supabase, userId, requestedWorkspaceId);
  if (!access.workspaceId) {
    return {
      workspaceId: null,
      role: null,
      error: access.error ?? 'Workspace not found',
      status: access.status ?? 400,
    };
  }
  if (access.level !== 'team_leader') {
    return {
      workspaceId: access.workspaceId,
      role: access.role,
      error: 'Team dashboard is only available to workspace owners and admins',
      status: 403,
    };
  }
  return { workspaceId: access.workspaceId, role: access.role, status: 200 };
}

/** Resolve workspace for the current user (primary or requested). */
export async function resolveWorkspaceIdForUser(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<{ workspaceId: string | null; error?: string; status?: number }> {
  if (requestedWorkspaceId) {
    const { data: membership, error } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', requestedWorkspaceId)
      .maybeSingle();

    if (error || !membership?.workspace_id) {
      return { workspaceId: null, error: 'You are not a member of the selected workspace', status: 403 };
    }

    return { workspaceId: membership.workspace_id };
  }

  const { data: fallbackMembership, error: fallbackError } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const memberships = (fallbackMembership ?? []) as Array<{
    workspace_id: string;
    role?: string | null;
    created_at?: string | null;
  }>;

  if (fallbackError || memberships.length === 0) {
    return { workspaceId: null, error: 'No workspace membership found for this user', status: 400 };
  }

  const sorted = memberships
    .filter((row) => !!row.workspace_id)
    .sort((a, b) => {
      const byRole = roleRank(a.role) - roleRank(b.role);
      if (byRole !== 0) return byRole;
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });

  const primary = sorted[0];
  if (!primary?.workspace_id) {
    return { workspaceId: null, error: 'No workspace membership found for this user', status: 400 };
  }

  return { workspaceId: primary.workspace_id };
}
