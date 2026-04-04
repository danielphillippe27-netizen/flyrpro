import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getInviteMailerConfigError, sendWorkspaceInviteEmail } from '@/lib/email/resend';
import {
  buildJoinUrl,
  createWorkspaceInviteRecord,
  findPendingWorkspaceInviteByEmail,
  getSeatUsage,
  listPendingWorkspaceInvites,
  normalizeInviteEmail,
  normalizePendingInviteRole,
  resolveTeamManagementContext,
  updateWorkspaceInviteRecord,
} from '@/app/api/team/_lib/manage';

const INVITE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const context = await resolveTeamManagementContext(
    admin,
    requestUser.id,
    request.nextUrl.searchParams.get('workspaceId')
  );
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { data, error } = await listPendingWorkspaceInvites(
    admin,
    context.workspaceId,
    new Date().toISOString()
  );

  if (error) {
    console.error('[team/invites] list error:', error);
    return NextResponse.json({ error: 'Failed to load invites' }, { status: 500 });
  }

  return NextResponse.json({
    invites: (data ?? []).map((invite) => ({
      ...invite,
      join_url: buildJoinUrl(request, invite.token),
    })),
  });
}

export async function POST(request: NextRequest) {
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
    const email = normalizeInviteEmail(body?.email);
    if (!email) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const context = await resolveTeamManagementContext(
      admin,
      requestUser.id,
      workspaceId
    );
    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    const requestedRole = normalizePendingInviteRole(body?.role) ?? 'member';
    if (context.role === 'admin' && requestedRole !== 'member') {
      return NextResponse.json(
        { error: 'Only workspace owners can invite admins' },
        { status: 403 }
      );
    }

    const seatUsage = await getSeatUsage(admin, context.workspaceId);
    const inviteConsumesPaidSeat = requestedRole !== 'admin';
    if (inviteConsumesPaidSeat && seatUsage.seatsUsed >= seatUsage.maxSeats) {
      return NextResponse.json(
        { error: 'All paid seats are currently allocated. Increase seats before inviting another member.' },
        { status: 409 }
      );
    }

    const now = new Date();
    const { data: existingInvite, error: existingInviteError } =
      await findPendingWorkspaceInviteByEmail(
        admin,
        context.workspaceId,
        email
      );

    if (existingInviteError) {
      console.error('[team/invites] existing invite lookup error:', existingInviteError);
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
    }

    if (existingInvite?.id) {
      const existingInviteExpiresAt = existingInvite.expires_at
        ? new Date(existingInvite.expires_at)
        : null;

      if (
        existingInviteExpiresAt &&
        !Number.isNaN(existingInviteExpiresAt.getTime()) &&
        existingInviteExpiresAt > now
      ) {
        return NextResponse.json(
          {
            error: 'A pending invite already exists for that email',
            invite: {
              ...existingInvite,
              join_url: buildJoinUrl(request, existingInvite.token),
            },
          },
          { status: 409 }
        );
      }

      const recycledToken = crypto.randomUUID();
      const refreshedExpiresAt = new Date(now.getTime() + INVITE_WINDOW_MS).toISOString();
      const { data: refreshedInvite, error: refreshError } =
        await updateWorkspaceInviteRecord(admin, existingInvite.id, {
          role: requestedRole,
          token: recycledToken,
          invited_by: requestUser.id,
          expires_at: refreshedExpiresAt,
          last_sent_at: now.toISOString(),
          updated_at: now.toISOString(),
        });

      if (refreshError || !refreshedInvite) {
        console.error('[team/invites] refresh stale invite error:', refreshError);
        return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
      }

      const joinUrl = buildJoinUrl(request, refreshedInvite.token);
      const workspaceName = await getWorkspaceName(admin, context.workspaceId);
      let emailSent = false;
      let emailError: string | null = getInviteMailerConfigError();

      if (!emailError) {
        try {
          await sendWorkspaceInviteEmail({
            to: email,
            joinUrl,
            workspaceName,
            role: requestedRole,
            inviterEmail: requestUser.email,
            expiresAt: refreshedInvite.expires_at,
          });
          emailSent = true;
          emailError = null;
        } catch (sendError) {
          emailError =
            sendError instanceof Error ? sendError.message : 'Invite created, but email failed to send.';
          console.error('[team/invites] resend refreshed invite email error:', sendError);
        }
      }

      return NextResponse.json(
        {
          success: true,
          emailSent,
          emailError,
          invite: {
            ...refreshedInvite,
            join_url: joinUrl,
          },
        },
        { status: 200 }
      );
    }

    const expiresAt = new Date(now.getTime() + INVITE_WINDOW_MS).toISOString();
    const token = crypto.randomUUID();

    const { data: invite, error } = await createWorkspaceInviteRecord(admin, {
        workspace_id: context.workspaceId,
        email,
        role: requestedRole,
        token,
        status: 'pending',
        invited_by: requestUser.id,
        expires_at: expiresAt,
        last_sent_at: now.toISOString(),
      });

    if (error || !invite) {
      console.error('[team/invites] create error:', error);
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
    }

    const joinUrl = buildJoinUrl(request, invite.token);
    const workspaceName = await getWorkspaceName(admin, context.workspaceId);
    let emailSent = false;
    let emailError: string | null = getInviteMailerConfigError();

    if (!emailError) {
      try {
        await sendWorkspaceInviteEmail({
          to: email,
          joinUrl,
          workspaceName,
          role: requestedRole,
          inviterEmail: requestUser.email,
          expiresAt: invite.expires_at,
        });
        emailSent = true;
        emailError = null;
      } catch (sendError) {
        emailError =
          sendError instanceof Error ? sendError.message : 'Invite created, but email failed to send.';
        console.error('[team/invites] send invite email error:', sendError);
      }
    }

    return NextResponse.json({
      success: true,
      emailSent,
      emailError,
      invite: {
        ...invite,
        join_url: joinUrl,
      },
    });
  } catch (error) {
    console.error('[team/invites] create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
