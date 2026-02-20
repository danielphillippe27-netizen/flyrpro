import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/invites/accept
 * Body: { token: string }
 * Current user must be logged in; their email must match the invite.
 * Updates invite to accepted; trigger adds them to workspace_members.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : null;
    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: invite, error: inviteError } = await admin
      .from('workspace_invites')
      .select('id, workspace_id, email, role, status, expires_at')
      .eq('token', token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite' },
        { status: 404 }
      );
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: 'This invite has already been used' },
        { status: 400 }
      );
    }

    const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return NextResponse.json(
        { error: 'This invite has expired' },
        { status: 400 }
      );
    }

    const userEmail = (user.email ?? '').toLowerCase().trim();
    const inviteEmail = (invite.email ?? '').toLowerCase().trim();
    if (userEmail !== inviteEmail) {
      return NextResponse.json(
        { error: 'This invite was sent to a different email address' },
        { status: 403 }
      );
    }

    const { error: updateError } = await supabase
      .from('workspace_invites')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to accept invite' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      workspaceId: invite.workspace_id,
      redirect: '/home',
    });
  } catch (e) {
    console.error('Accept invite error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
