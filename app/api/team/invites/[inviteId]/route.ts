import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getInviteMailerConfigError, sendWorkspaceInviteEmail } from '@/lib/email/resend';
import {
  buildJoinUrl,
  getWorkspaceInviteRecord,
  normalizePendingInviteRole,
  resolveTeamManagementContext,
  updateWorkspaceInviteRecord,
} from '@/app/api/team/_lib/manage';

const INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function getInviteForWorkspace(admin: ReturnType<typeof createAdminClient>, inviteId: string) {
  const { data, error } = await getWorkspaceInviteRecord(admin, inviteId);
  return { invite: data, error };
}

async function getWorkspaceName(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<string> {
  const { data } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  return typeof data?.name === 'string' && data.name.trim()
    ? data.name.trim()
    : 'your workspace';
}

export async function PATCH(
  request: NextRequest,
  contextParam: { params: Promise<{ inviteId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { inviteId } = await contextParam.params;
    const body = await request.json().catch(() => ({}));
    const workspaceId =
      typeof body?.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : null;
    const action = typeof body?.action === 'string' ? body.action : 'resend';

    const admin = createAdminClient();
    const teamContext = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      workspaceId
    );
    if (!teamContext.ok) {
      return NextResponse.json({ error: teamContext.error }, { status: teamContext.status });
    }

    const { invite, error } = await getInviteForWorkspace(admin, inviteId);
    if (error || !invite || invite.workspace_id !== teamContext.workspaceId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    if (invite.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending invites can be updated' }, { status: 400 });
    }

    if (action === 'role') {
      if (teamContext.role !== 'owner') {
        return NextResponse.json(
          { error: 'Only workspace owners can change invite roles' },
          { status: 403 }
        );
      }

      const nextRole = normalizePendingInviteRole(body?.role);
      if (!nextRole) {
        return NextResponse.json({ error: 'A valid invite role is required' }, { status: 400 });
      }

      const { data: updatedInvite, error: updateError } =
        await updateWorkspaceInviteRecord(admin, invite.id, {
          role: nextRole,
          updated_at: new Date().toISOString(),
        });

      if (updateError || !updatedInvite) {
        console.error('[team/invites/:inviteId] role update error:', updateError);
        return NextResponse.json({ error: 'Failed to update invite role' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        invite: {
          ...updatedInvite,
          join_url: buildJoinUrl(request, updatedInvite.token),
        },
      });
    }

    if (teamContext.role === 'admin' && invite.role !== 'member') {
      return NextResponse.json(
        { error: 'Admins can only resend member invites' },
        { status: 403 }
      );
    }

    const expiresAt = new Date(Date.now() + INVITE_WINDOW_MS).toISOString();
    const { data: updatedInvite, error: resendError } =
      await updateWorkspaceInviteRecord(admin, invite.id, {
        expires_at: expiresAt,
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (resendError || !updatedInvite) {
      console.error('[team/invites/:inviteId] resend error:', resendError);
      return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 });
    }

    const joinUrl = buildJoinUrl(request, updatedInvite.token);
    const workspaceName = await getWorkspaceName(admin, teamContext.workspaceId);
    let emailSent = false;
    let emailError: string | null = getInviteMailerConfigError();

    if (!emailError) {
      try {
        await sendWorkspaceInviteEmail({
          to: updatedInvite.email,
          joinUrl,
          workspaceName,
          role: updatedInvite.role,
          inviterEmail: requestUser.email,
          expiresAt: updatedInvite.expires_at,
        });
        emailSent = true;
        emailError = null;
      } catch (sendError) {
        emailError =
          sendError instanceof Error ? sendError.message : 'Invite refreshed, but email failed to send.';
        console.error('[team/invites/:inviteId] resend email error:', sendError);
      }
    }

    return NextResponse.json({
      success: true,
      emailSent,
      emailError,
      invite: {
        ...updatedInvite,
        join_url: joinUrl,
      },
    });
  } catch (error) {
    console.error('[team/invites/:inviteId] patch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  contextParam: { params: Promise<{ inviteId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { inviteId } = await contextParam.params;
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');
    const admin = createAdminClient();
    const teamContext = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      workspaceId
    );
    if (!teamContext.ok) {
      return NextResponse.json({ error: teamContext.error }, { status: teamContext.status });
    }

    const { invite, error } = await getInviteForWorkspace(admin, inviteId);
    if (error || !invite || invite.workspace_id !== teamContext.workspaceId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    if (invite.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending invites can be canceled' }, { status: 400 });
    }

    if (teamContext.role === 'admin' && invite.role !== 'member') {
      return NextResponse.json(
        { error: 'Admins can only cancel member invites' },
        { status: 403 }
      );
    }

    const { error: cancelError } = await admin
      .from('workspace_invites')
      .update({
        status: 'canceled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (cancelError) {
      console.error('[team/invites/:inviteId] cancel error:', cancelError);
      return NextResponse.json({ error: 'Failed to cancel invite' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[team/invites/:inviteId] delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
