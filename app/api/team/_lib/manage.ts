import type { NextRequest } from 'next/server';
import type { WorkspaceRole } from '@/app/api/_utils/workspace';
import { resolveWorkspaceMembershipForUser } from '@/app/api/_utils/workspace';
import type { createAdminClient } from '@/lib/supabase/server';

export type TeamManagerRole = Extract<WorkspaceRole, 'owner' | 'admin'>;
export type PendingInviteRole = 'admin' | 'member';

export type TeamManagementContext =
  | {
      ok: true;
      workspaceId: string;
      role: TeamManagerRole;
    }
  | {
      ok: false;
      error: string;
      status: number;
      workspaceId?: string | null;
      role?: WorkspaceRole | null;
    };

type AdminClient = ReturnType<typeof createAdminClient>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_SEAT_ROLES: WorkspaceRole[] = ['admin'];
const INVITE_SELECT_BASE = 'id, email, role, status, token, created_at, expires_at';

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message.toLowerCase();
  }
  return '';
}

function isMissingRelation(error: unknown, relation: string): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes(`relation "${relation}" does not exist`) ||
    message.includes(`relation ${relation} does not exist`)
  );
}

function isMissingColumn(error: unknown, column: string): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes(`'${column}'`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`${column} does not exist`)
  );
}

export type TeamInviteRecord = {
  id: string;
  email: string;
  role: PendingInviteRole;
  status: string;
  token: string;
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  workspace_id?: string;
};

export type SeatUsage = {
  maxSeats: number;
  activeMembers: number;
  activePaidMembers: number;
  activeAdmins: number;
  pendingInvites: number;
  pendingPaidInvites: number;
  pendingAdminInvites: number;
  seatsUsed: number;
  seatsRemaining: number;
};

function inviteSelectColumns(options?: {
  includeWorkspaceId?: boolean;
  includeLastSentAt?: boolean;
}): string {
  const columns = [INVITE_SELECT_BASE];
  if (options?.includeWorkspaceId) {
    columns.push('workspace_id');
  }
  if (options?.includeLastSentAt !== false) {
    columns.push('last_sent_at');
  }
  return columns.join(', ');
}

function normalizeInviteRecord(row: Record<string, unknown> | null): TeamInviteRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    role: row.role === 'admin' ? 'admin' : 'member',
    status: String(row.status),
    token: String(row.token),
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
    last_sent_at:
      typeof row.last_sent_at === 'string' ? row.last_sent_at : null,
    workspace_id:
      typeof row.workspace_id === 'string' ? row.workspace_id : undefined,
  };
}

function normalizeInviteRecords(rows: Record<string, unknown>[] | null | undefined): TeamInviteRecord[] {
  return (rows ?? [])
    .map((row) => normalizeInviteRecord(row))
    .filter((row): row is TeamInviteRecord => !!row);
}

export function isMissingLastSentAtColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === 'PGRST204' &&
    typeof maybeError.message === 'string' &&
    maybeError.message.includes("'last_sent_at'")
  );
}

export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

export function normalizePendingInviteRole(value: unknown): PendingInviteRole | null {
  if (value === 'admin' || value === 'member') return value;
  return null;
}

export async function resolveTeamManagementContext(
  supabase: AdminClient,
  userId: string,
  requestedWorkspaceId?: string | null
): Promise<TeamManagementContext> {
  const membership = await resolveWorkspaceMembershipForUser(
    supabase,
    userId,
    requestedWorkspaceId
  );
  if (!membership.workspaceId) {
    return {
      ok: false,
      error: membership.error ?? 'Workspace not found',
      status: membership.status ?? 400,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return {
      ok: false,
      error: 'Only workspace owners and admins can manage team members',
      status: 403,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  return {
    ok: true,
    workspaceId: membership.workspaceId,
    role: membership.role,
  };
}

export async function getSeatUsage(
  supabase: AdminClient,
  workspaceId: string
): Promise<SeatUsage> {
  const nowIso = new Date().toISOString();
  const [workspaceResult, activeMembershipsResult, pendingInvitesResult] =
    await Promise.all([
      supabase
        .from('workspaces')
        .select('max_seats')
        .eq('id', workspaceId)
        .maybeSingle(),
      supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId),
      supabase
        .from('workspace_invites')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')
        .gt('expires_at', nowIso),
    ]);

  if (activeMembershipsResult.error) {
    throw activeMembershipsResult.error;
  }

  const workspace =
    workspaceResult.error && isMissingColumn(workspaceResult.error, 'max_seats')
      ? null
      : workspaceResult.data;
  const pendingInvites =
    pendingInvitesResult.error && isMissingRelation(pendingInvitesResult.error, 'workspace_invites')
      ? []
      : pendingInvitesResult.data ?? [];

  const maxSeats = Math.max(1, workspace?.max_seats ?? 1);
  const activeRoles = (activeMembershipsResult.data ?? []).map((row) => row.role as WorkspaceRole);
  const pendingRoles = (pendingInvites ?? []).map((row) => row.role as PendingInviteRole);
  const activeAdmins = activeRoles.filter((role) => FREE_SEAT_ROLES.includes(role)).length;
  const pendingAdminInvites = pendingRoles.filter((role) => role === 'admin').length;
  const activeCount = activeRoles.length;
  const pendingCount = pendingRoles.length;
  const activePaidMembers = activeCount - activeAdmins;
  const pendingPaidInvites = pendingCount - pendingAdminInvites;
  const seatsUsed = activePaidMembers + pendingPaidInvites;

  return {
    maxSeats,
    activeMembers: activeCount,
    activePaidMembers,
    activeAdmins,
    pendingInvites: pendingCount,
    pendingPaidInvites,
    pendingAdminInvites,
    seatsUsed,
    seatsRemaining: Math.max(0, maxSeats - seatsUsed),
  };
}

export function buildJoinUrl(request: NextRequest, token: string): string {
  return new URL(`/join?token=${encodeURIComponent(token)}`, request.url).toString();
}

export async function listPendingWorkspaceInvites(
  supabase: AdminClient,
  workspaceId: string,
  nowIso: string
): Promise<{ data: TeamInviteRecord[] | null; error: unknown }> {
  const withLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns())
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  if (!isMissingLastSentAtColumnError(withLastSentAt.error)) {
    if (isMissingRelation(withLastSentAt.error, 'workspace_invites')) {
      return {
        data: [],
        error: null,
      };
    }
    return {
      data: normalizeInviteRecords(withLastSentAt.data as Record<string, unknown>[] | null),
      error: withLastSentAt.error,
    };
  }

  const withoutLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns({ includeLastSentAt: false }))
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  return {
    data: isMissingRelation(withoutLastSentAt.error, 'workspace_invites')
      ? []
      : normalizeInviteRecords(withoutLastSentAt.data as Record<string, unknown>[] | null),
    error: isMissingRelation(withoutLastSentAt.error, 'workspace_invites')
      ? null
      : withoutLastSentAt.error,
  };
}

export async function findPendingWorkspaceInviteByEmail(
  supabase: AdminClient,
  workspaceId: string,
  email: string
): Promise<{ data: TeamInviteRecord | null; error: unknown }> {
  const withLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns())
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .ilike('email', email)
    .maybeSingle();

  if (!isMissingLastSentAtColumnError(withLastSentAt.error)) {
    return {
      data: normalizeInviteRecord(withLastSentAt.data as Record<string, unknown> | null),
      error: withLastSentAt.error,
    };
  }

  const withoutLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns({ includeLastSentAt: false }))
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .ilike('email', email)
    .maybeSingle();

  return {
    data: normalizeInviteRecord(withoutLastSentAt.data as Record<string, unknown> | null),
    error: withoutLastSentAt.error,
  };
}

export async function getWorkspaceInviteRecord(
  supabase: AdminClient,
  inviteId: string
): Promise<{ data: TeamInviteRecord | null; error: unknown }> {
  const withLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns({ includeWorkspaceId: true }))
    .eq('id', inviteId)
    .maybeSingle();

  if (!isMissingLastSentAtColumnError(withLastSentAt.error)) {
    return {
      data: normalizeInviteRecord(withLastSentAt.data as Record<string, unknown> | null),
      error: withLastSentAt.error,
    };
  }

  const withoutLastSentAt = await supabase
    .from('workspace_invites')
    .select(inviteSelectColumns({ includeWorkspaceId: true, includeLastSentAt: false }))
    .eq('id', inviteId)
    .maybeSingle();

  return {
    data: normalizeInviteRecord(withoutLastSentAt.data as Record<string, unknown> | null),
    error: withoutLastSentAt.error,
  };
}

export async function createWorkspaceInviteRecord(
  supabase: AdminClient,
  values: {
    workspace_id: string;
    email: string;
    role: PendingInviteRole;
    token: string;
    status: 'pending';
    invited_by: string;
    expires_at: string;
    last_sent_at?: string;
  }
): Promise<{ data: TeamInviteRecord | null; error: unknown }> {
  const withLastSentAt = await supabase
    .from('workspace_invites')
    .insert(values)
    .select(inviteSelectColumns())
    .single();

  if (!isMissingLastSentAtColumnError(withLastSentAt.error)) {
    return {
      data: normalizeInviteRecord(withLastSentAt.data as Record<string, unknown> | null),
      error: withLastSentAt.error,
    };
  }

  const legacyValues = { ...values };
  delete legacyValues.last_sent_at;
  const withoutLastSentAt = await supabase
    .from('workspace_invites')
    .insert(legacyValues)
    .select(inviteSelectColumns({ includeLastSentAt: false }))
    .single();

  return {
    data: normalizeInviteRecord(withoutLastSentAt.data as Record<string, unknown> | null),
    error: withoutLastSentAt.error,
  };
}

export async function updateWorkspaceInviteRecord(
  supabase: AdminClient,
  inviteId: string,
  values: {
    role?: PendingInviteRole;
    token?: string;
    invited_by?: string;
    expires_at?: string;
    last_sent_at?: string;
    status?: 'pending' | 'accepted' | 'expired' | 'canceled';
    updated_at?: string;
  }
): Promise<{ data: TeamInviteRecord | null; error: unknown }> {
  const withLastSentAt = await supabase
    .from('workspace_invites')
    .update(values)
    .eq('id', inviteId)
    .select(inviteSelectColumns())
    .single();

  if (!isMissingLastSentAtColumnError(withLastSentAt.error)) {
    return {
      data: normalizeInviteRecord(withLastSentAt.data as Record<string, unknown> | null),
      error: withLastSentAt.error,
    };
  }

  const legacyValues = { ...values };
  delete legacyValues.last_sent_at;
  const withoutLastSentAt = await supabase
    .from('workspace_invites')
    .update(legacyValues)
    .eq('id', inviteId)
    .select(inviteSelectColumns({ includeLastSentAt: false }))
    .single();

  return {
    data: normalizeInviteRecord(withoutLastSentAt.data as Record<string, unknown> | null),
    error: withoutLastSentAt.error,
  };
}
