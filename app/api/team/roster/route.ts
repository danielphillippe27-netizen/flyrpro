import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  buildJoinUrl,
  getSeatUsage,
  listPendingWorkspaceInvites,
  resolveTeamManagementContext,
} from '@/app/api/team/_lib/manage';

type PendingInviteRow =
  Awaited<ReturnType<typeof listPendingWorkspaceInvites>>['data'] extends Array<infer T> | null
    ? T
    : never;

type MembershipRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  color: string | null;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type SeatUsage = {
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
    message.includes(`relation ${relation} does not exist`) ||
    message.includes(`could not find the table '${relation}'`)
  );
}

function isMissingColumn(error: unknown, column: string): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes(`'${column}'`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`${column} does not exist`) ||
    (message.includes('column') && message.includes(column) && message.includes('not found'))
  );
}

async function loadWorkspaceMembers(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<MembershipRow[]> {
  const withColor = await admin
    .from('workspace_members')
    .select('user_id, role, color, created_at')
    .eq('workspace_id', workspaceId);

  if (!withColor.error) {
    return (withColor.data ?? []) as MembershipRow[];
  }

  if (!isMissingColumn(withColor.error, 'color')) {
    throw withColor.error;
  }

  const withoutColor = await admin
    .from('workspace_members')
    .select('user_id, role, created_at')
    .eq('workspace_id', workspaceId);

  if (withoutColor.error) {
    throw withoutColor.error;
  }

  return ((withoutColor.data ?? []) as Array<Omit<MembershipRow, 'color'> & { color?: string | null }>).map(
    (row) => ({
      ...row,
      color: null,
    })
  );
}

async function loadProfileRows(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<ProfileRow[]> {
  if (userIds.length === 0) {
    return [];
  }

  const profileQuery = await admin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);

  if (!profileQuery.error) {
    return (profileQuery.data ?? []) as ProfileRow[];
  }

  if (isMissingRelation(profileQuery.error, 'user_profiles')) {
    return [];
  }

  throw profileQuery.error;
}

function buildSeatUsageFallback(memberships: MembershipRow[]): SeatUsage {
  const activeAdmins = memberships.filter((row) => row.role === 'admin').length;
  const activeCount = memberships.length;
  const activePaidMembers = Math.max(0, activeCount - activeAdmins);

  return {
    maxSeats: Math.max(1, activePaidMembers || 1),
    activeMembers: activeCount,
    activePaidMembers,
    activeAdmins,
    pendingInvites: 0,
    pendingPaidInvites: 0,
    pendingAdminInvites: 0,
    seatsUsed: activePaidMembers,
    seatsRemaining: 0,
  };
}

function roleSortValue(role: MembershipRow['role']): number {
  if (role === 'owner') return 0;
  if (role === 'admin') return 1;
  return 2;
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
    const context = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      requestedWorkspaceId
    );
    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    const nowIso = new Date().toISOString();
    const [workspaceResult, membersResult, inviteResultSettled, seatUsageSettled] =
      await Promise.allSettled([
        admin
          .from('workspaces')
          .select('id, name, max_seats')
          .eq('id', context.workspaceId)
          .single(),
        loadWorkspaceMembers(admin, context.workspaceId),
        listPendingWorkspaceInvites(admin, context.workspaceId, nowIso),
        getSeatUsage(admin, context.workspaceId),
      ]);

    const workspace =
      workspaceResult.status === 'fulfilled' ? workspaceResult.value.data : null;
    if (workspaceResult.status === 'rejected') {
      console.warn('[team/roster] workspace lookup error; continuing with fallback workspace', workspaceResult.reason);
    }

    const memberships =
      membersResult.status === 'fulfilled' ? membersResult.value : [];
    if (membersResult.status === 'rejected') {
      console.warn('[team/roster] member list error; continuing with no members', membersResult.reason);
    }

    const inviteResult =
      inviteResultSettled.status === 'fulfilled'
        ? inviteResultSettled.value
        : { data: [] as PendingInviteRow[], error: inviteResultSettled.reason };
    if (inviteResultSettled.status === 'rejected') {
      console.warn('[team/roster] invite list error; continuing without invites', inviteResultSettled.reason);
    } else if (inviteResult.error) {
      console.warn('[team/roster] invite list error; continuing without invites', inviteResult.error);
    }

    const userIds = memberships.map((row) => row.user_id);
    const profiles = await loadProfileRows(admin, userIds).catch((error) => {
      console.warn('[team/roster] profile lookup error; continuing without names', error);
      return [] as ProfileRow[];
    });
    const profileByUserId = new Map(
      profiles.map((row) => [
        row.user_id,
        [row.first_name, row.last_name]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join(' ')
          .trim(),
      ])
    );

    const members = memberships
      .slice()
      .sort((a, b) => {
        const byRole = roleSortValue(a.role) - roleSortValue(b.role);
        if (byRole !== 0) return byRole;
        return a.created_at.localeCompare(b.created_at);
      })
      .map((row) => ({
        user_id: row.user_id,
        display_name: profileByUserId.get(row.user_id) || 'Member',
        role: row.role,
        color: row.color ?? '#3B82F6',
        joined_at: row.created_at,
        is_current_user: row.user_id === requestUser.id,
      }));

    const seatUsage =
      seatUsageSettled.status === 'fulfilled'
        ? seatUsageSettled.value
        : buildSeatUsageFallback(memberships);
    if (seatUsageSettled.status === 'rejected') {
      console.warn('[team/roster] seat usage error; continuing with fallback seat counts', seatUsageSettled.reason);
    }

    const pendingInvites = (inviteResult.data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      last_sent_at: row.last_sent_at,
      join_url: buildJoinUrl(request, row.token),
    }));

    return NextResponse.json({
      workspace: {
        id: workspace?.id ?? context.workspaceId,
        name: workspace?.name ?? 'Workspace',
        maxSeats: Math.max(1, workspace?.max_seats ?? seatUsage.maxSeats),
      },
      actorRole: context.role,
      seatUsage,
      members,
      pendingInvites,
    });
  } catch (error) {
    console.error('[team/roster] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
