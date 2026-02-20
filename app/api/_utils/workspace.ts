type MinimalSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => any;
  };
};

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type TeamDashboardMode = 'team_owner' | 'default';

type ResolveTeamResult = {
  workspaceId: string | null;
  role: WorkspaceRole | null;
  error?: string;
  status?: number;
};

/** Resolve workspace, role, and dashboard mode. mode === 'team_owner' only when (owner|admin) and memberCount > 1. */
export async function resolveTeamDashboardMode(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<{ workspaceId: string | null; role: WorkspaceRole | null; mode: TeamDashboardMode; error?: string; status?: number }> {
  const resolution = await resolveWorkspaceIdForUser(supabase, userId, requestedWorkspaceId);
  if (!resolution.workspaceId) {
    return { workspaceId: null, role: null, mode: 'default', error: resolution.error, status: resolution.status ?? 400 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;
  const { data: membership } = await supabaseAny
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', resolution.workspaceId)
    .maybeSingle();
  const role = (membership?.role as WorkspaceRole) ?? null;
  if (role !== 'owner' && role !== 'admin') {
    return { workspaceId: resolution.workspaceId, role, mode: 'default', status: 200 };
  }
  const { data: memberRows } = await supabaseAny
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', resolution.workspaceId);
  const memberCount = Array.isArray(memberRows) ? memberRows.length : 0;
  const mode: TeamDashboardMode = memberCount > 1 ? 'team_owner' : 'default';
  return { workspaceId: resolution.workspaceId, role, mode, status: 200 };
}

/** Resolve workspace id and role for team dashboard; 403 if not owner/admin. */
export async function resolveWorkspaceAndRoleForTeam(
  supabase: MinimalSupabaseClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<ResolveTeamResult> {
  const resolution = await resolveWorkspaceIdForUser(supabase, userId, requestedWorkspaceId);
  if (!resolution.workspaceId) {
    return { workspaceId: null, role: null, error: resolution.error ?? 'Workspace not found', status: resolution.status ?? 400 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;
  const { data: membership } = await supabaseAny
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', resolution.workspaceId)
    .maybeSingle();
  const role = (membership?.role as WorkspaceRole) ?? null;
  if (role !== 'owner' && role !== 'admin') {
    return { workspaceId: resolution.workspaceId, role, error: 'Team dashboard is only available to workspace owners and admins', status: 403 };
  }
  return { workspaceId: resolution.workspaceId, role, status: 200 };
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
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackError || !fallbackMembership?.workspace_id) {
    return { workspaceId: null, error: 'No workspace membership found for this user', status: 400 };
  }

  return { workspaceId: fallbackMembership.workspace_id };
}
