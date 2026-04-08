import { createAdminClient } from '@/lib/supabase/server';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type RouteAssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asPriority(value: unknown): 'low' | 'normal' | 'high' {
  if (value === 'low' || value === 'high' || value === 'normal') return value;
  return 'normal';
}

export async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WorkspaceRole | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.role) return null;
  if (data.role === 'owner' || data.role === 'admin' || data.role === 'member') {
    return data.role;
  }
  return null;
}

export function canManageRoutes(role: WorkspaceRole | null): boolean {
  return role === 'owner' || role === 'admin';
}
