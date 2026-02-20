import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/invites/validate?token=...
 * Returns invite details if token is valid and pending. Does not require auth.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token?.trim()) {
    return NextResponse.json(
      { error: 'Token required' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from('workspace_invites')
    .select('id, workspace_id, email, role, status, expires_at')
    .eq('token', token.trim())
    .single();

  if (error || !invite) {
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

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, name')
    .eq('id', invite.workspace_id)
    .single();

  return NextResponse.json({
    valid: true,
    workspaceName: workspace?.name ?? null,
    email: invite.email,
    role: invite.role,
  });
}
