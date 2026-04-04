import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  normalizePendingInviteRole,
  resolveTeamManagementContext,
} from '@/app/api/team/_lib/manage';

type MemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
};

async function getWorkspaceMember(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string
) {
  const { data, error } = await admin
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  return { member: (data ?? null) as MemberRow | null, error };
}

export async function PATCH(
  request: NextRequest,
  routeContext: { params: Promise<{ userId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const workspaceId =
      typeof body?.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : null;

    const admin = createAdminClient();
    const teamContext = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      workspaceId
    );
    if (!teamContext.ok) {
      return NextResponse.json({ error: teamContext.error }, { status: teamContext.status });
    }

    if (teamContext.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only workspace owners can change member roles' },
        { status: 403 }
      );
    }

    const nextRole = normalizePendingInviteRole(body?.role);
    if (!nextRole) {
      return NextResponse.json({ error: 'A valid role is required' }, { status: 400 });
    }

    const { userId } = await routeContext.params;
    if (userId === requestUser.id) {
      return NextResponse.json(
        { error: 'You cannot change your own workspace role here' },
        { status: 400 }
      );
    }

    const { member, error } = await getWorkspaceMember(admin, teamContext.workspaceId, userId);
    if (error || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (member.role === 'owner') {
      return NextResponse.json(
        { error: 'Owner roles cannot be changed from this screen' },
        { status: 400 }
      );
    }

    const { error: updateError } = await admin
      .from('workspace_members')
      .update({
        role: nextRole,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', teamContext.workspaceId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[team/members/:userId] role update error:', updateError);
      return NextResponse.json({ error: 'Failed to update member role' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[team/members/:userId] patch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  routeContext: { params: Promise<{ userId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const teamContext = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      request.nextUrl.searchParams.get('workspaceId')
    );
    if (!teamContext.ok) {
      return NextResponse.json({ error: teamContext.error }, { status: teamContext.status });
    }

    const { userId } = await routeContext.params;
    if (userId === requestUser.id) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from this workspace here' },
        { status: 400 }
      );
    }

    const { member, error } = await getWorkspaceMember(admin, teamContext.workspaceId, userId);
    if (error || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (member.role === 'owner') {
      return NextResponse.json(
        { error: 'Owners cannot be removed from this screen' },
        { status: 400 }
      );
    }

    if (teamContext.role === 'admin' && member.role !== 'member') {
      return NextResponse.json(
        { error: 'Admins can only remove members' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await admin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', teamContext.workspaceId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[team/members/:userId] remove error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[team/members/:userId] delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
