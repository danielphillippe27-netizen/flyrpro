import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeInviteEmail, resolveTeamManagementContext } from '@/app/api/team/_lib/manage';
import { getInviteAppOrigin, sendWorkspaceInviteEmail } from '@/lib/email/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .maybeSingle();

  return typeof data?.name === 'string' && data.name.trim()
    ? data.name.trim()
    : 'your workspace';
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

    const admin = createAdminClient();
    const context = await resolveTeamManagementContext(admin, requestUser.id, workspaceId);
    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status });
    }

    const workspaceName = await getWorkspaceName(context.workspaceId);
    const appOrigin = getInviteAppOrigin(request.nextUrl.origin);
    const previewUrl = `${appOrigin}/join?preview=member-invite`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const rawPreviewTo =
      typeof body?.previewEmail === 'string'
        ? body.previewEmail
        : typeof body?.to === 'string'
          ? body.to
          : null;
    const normalizedPreviewTo = rawPreviewTo ? normalizeInviteEmail(rawPreviewTo) : null;
    if (rawPreviewTo?.trim() && !normalizedPreviewTo) {
      return NextResponse.json({ error: 'Enter a valid email address for the preview.' }, { status: 400 });
    }

    const accountEmail = requestUser.email ? normalizeInviteEmail(requestUser.email) : null;
    const toEmail = normalizedPreviewTo ?? accountEmail;
    if (!toEmail) {
      return NextResponse.json(
        { error: 'Enter an email in the field, or add an email to your account, to receive the preview.' },
        { status: 400 }
      );
    }

    const { id: resendEmailId } = await sendWorkspaceInviteEmail({
      to: toEmail,
      joinUrl: previewUrl,
      workspaceName,
      role: 'member',
      inviterEmail: requestUser.email ?? null,
      expiresAt,
      previewText: 'Preview email for development only. This does not create a real invite or grant workspace access.',
      subjectPrefix: 'Preview:',
    });

    console.info('[team/invites/test-email]', {
      to: toEmail,
      resendEmailId,
      previewUrl,
    });

    return NextResponse.json({
      success: true,
      email: toEmail,
      message: `Preview invite sent to ${toEmail}.`,
      resendEmailId: resendEmailId ?? null,
      previewUrl,
    });
  } catch (error) {
    console.error('[team/invites/test-email]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send preview invite' },
      { status: 500 }
    );
  }
}
